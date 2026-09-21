# GrowBot relay client — the Pico dials OUT to the relay as a WebSocket client.
# Runs as main.py on boot (battery, untethered) OR via `mpremote run`.
# OwlBot dog6 relay firmware. The relay carries compact drive intent while the
# Pico owns all six-servo timing locally.
#
# ===== OWLBOT DOG6 WIRE PROTOCOL =====
#   phone -> chip:
#     {"t":"attach","id","code"}                      handshake (sent by the app/tester)
#     {"t":"dog_drive","f","y","step_ms","stride"}    forward/yaw intent
#     {"t":"dog_routine","rid","name"}                 gentle local gesture
#     {"t":"dog_cal","rid","offsets":{...}}            persist us offsets
#     {"t":"dog_gait_save","rid","steps":[...]}          persist a taught one-channel gait
#     {"t":"dog_gait_test","rid"}                         play one taught gait cycle
#     {"t":"dog_pose","rid","role","delta_us"}         bounded channel nudge
#     {"t":"dog_rest"|"stop","rid"}                    stable rest and hold
#     {"t":"release","rid"}                             explicit limp
#     {"t":"gaze_config","rid",...}                     save bounds, no movement
#     {"t":"gaze","rid","pan","tilt"}                  bounded optional gimbal
#     {"t":"gaze_release"|"gaze_info","rid"}             release/query gimbal
#   chip -> phone:
#     {"t":"hello","id"}                               chip handshake to the relay
#     {"t":"ack","rid","ok","queued_ms"}               command reply
#     {"t":"status","awake"}                           emitted by the RELAY (chip presence), not the chip
#   (a pose carrying "seq"/"ts" gets a {"t":"ack","seq","ts"} echo — latency tools only.)
#
# ===== LINK SELF-HEAL =====
# Field failure: a servo-current brownout can kill the WiFi/relay link while the Pico
# keeps running — LED lit, robot deaf, only a power cycle brought it back. The link now
# heals itself, in escalating layers:
#   1. every socket op carries a timeout — no connect/read/write can block forever
#   2. link heartbeat: at a fixed cadence the chip PINGs the relay (Cloudflare's
#      edge pongs back on its own; the traffic also keeps home-router NAT entries alive);
#      nothing received for LINK_DEAD_MS -> tear down and re-dial
#   3. wifi watch: WLAN drop -> reassociate + re-dial, exponential backoff between tries
#   4. escalation: every WIFI_RESET_EVERY straight failures power-cycle the radio
#      (active False/True); after HARD_RESET_AFTER failures, machine.reset() = an
#      automatic power cycle (boot skips the calibration stretch on self-heal resets)
#   5. a hardware watchdog covers initial connection as well as later sessions;
#      normal Wi-Fi waiting feeds it, a stuck DNS/TLS operation cannot freeze boot.
# The walk dead-man below is a FEATURE (limp on pose silence) and is separate from this.
import network, socket, ssl, os, json, time, binascii, select, machine, gc
import PicoRobotics
from dog_engine import DogEngine, normalize_role
from gimbal_engine import GimbalEngine, normalize_axis
from servo_channels import ServoChannels
from named_gait import NamedGait
from named_turn import NamedTurn
from pico_head import PicoHead
from shared_body import SharedBody
from stock_body import StockBody
from stock_commands import StockCommands

HOST = "growbot-relay.growbot.workers.dev"
# Each board self-assigns a stable, unique pairing code from its hardware id, so two
# robots never collide on the relay. To pin a custom code, set DEVID = "yourcode" instead.
DEVID = "gb-" + binascii.hexlify(machine.unique_id()).decode()[-6:]
PATH = "/d/" + DEVID

print("\n========================================")
print("  PAIRING CODE:  " + DEVID)
print("  Enter this code in the GrowBot app.")
print("========================================\n")

board = PicoRobotics.KitronikPicoRobotics(profile="dog6")
dog = DogEngine(board)
gaze = GimbalEngine(board)  # loads limits only; sends no PWM at boot
channels = ServoChannels(board, dog, gaze)
named_walk = NamedGait(channels)
named_turn = NamedTurn(channels)
pico_head = PicoHead(channels, gaze.ports_dict)
shared_body = SharedBody(channels, pico_head)
channels.stop_head = pico_head.stop
stock_fanout = StockBody(channels, named_walk)
channels.stop_stock = stock_fanout.stop
try:
    with open('stock_commands.json') as _f:
        _stock_config = json.load(_f)
except (OSError, ValueError):
    _stock_config = {}  # opt-in; existing two-servo installations are unchanged
stock_commands = StockCommands(channels, named_walk, named_turn, pico_head,
                               shared_body, _stock_config)
pico_head.hold_enabled = _stock_config.get('head_hold_enabled') is True

# The phone labels Waveshare sockets 0..15.  Keep one authoritative, persisted
# eight-servo map here so a role cannot be accidentally assigned to the same
# physical socket as another role.  The engines convert to their driver's
# one-based servo index internally.
ALL_SERVO_ROLES = ("front_left", "rear_right", "front_right", "rear_left",
                   "slider", "rotation", "gimbal_tilt", "gimbal_pan")

def _all_ports():
    ports = dog.ports_dict()
    ports.update(gaze.ports_dict())
    return ports

def _set_all_ports(values):
    """Validate the whole map before writing either calibration file."""
    if not isinstance(values, dict):
        return False
    candidate = _all_ports()
    try:
        for role in ALL_SERVO_ROLES:
            if role in values:
                port = int(values[role])
                if port < 0 or port > 15:
                    return False
                candidate[role] = port
    except Exception:
        return False
    if len(set(candidate.values())) != len(ALL_SERVO_ROLES):
        return False
    body = {role: candidate[role] for role in dog.ports_dict()}
    head = {role: candidate[role] for role in gaze.ports_dict()}
    if not dog.set_ports(body, save=False) or not gaze.set_ports(head, save=False):
        return False
    # Only persist after all eight channel assignments are valid.
    return dog.save_calibration() and gaze.save()
DEADMAN_MS = 700          # settle and hold if drive intent goes quiet
POLL_MS = 20              # main-loop cadence: ticks the act engine ~50Hz and polls for frames
BOOT_MS = time.ticks_ms()

NET_TIMEOUT_S = 6         # bound on every socket op; must stay well under WDT_MS
PING_MS = 10000           # fixed cadence; incoming motor traffic must not starve pings
HEARTBEAT_MS = 5000       # application proof-of-life visible to existing browser onAck
LINK_DEAD_MS = 25000      # quiet this long (= 2 unanswered pings) -> wedged, re-dial
LINK_START_MS = 10000     # a new socket is not healthy until something comes back
WIFI_RESET_EVERY = 3      # straight failures between radio power-cycles
HARD_RESET_AFTER = 10     # straight failures before machine.reset() (~3-5 min of trying)
WDT_MS = 8000             # hardware watchdog period (rp2 hardware caps near 8.3s)
MAX_FRAME_BYTES = 32768   # control/calibration JSON, never camera or model payloads
MAX_HANDSHAKE_BYTES = 4096
NET_STAGE_MS = 6000       # total progress budget, in addition to socket-op timeout
LINK_DIAG = {"stage": "boot", "connections": 0, "failures": 0,
             "last_error": "", "last_error_stage": "",
             "heartbeats_sent": 0, "pings_sent": 0, "io": "idle",
             "last_error_io": "", "close_code": None, "faults": [],
             "reset_radio": False, "radio_resets": 0}

wlan = network.WLAN(network.STA_IF)

_wdt = None               # armed once in main(); machine.WDT can NEVER be disarmed after
                          # that, so every path below must keep the feed()s flowing

def feed():
    if _wdt:
        _wdt.feed()

def sleep_fed(ms):        # sleep that keeps the hardware watchdog fed
    while ms > 0:
        feed(); time.sleep_ms(min(ms, 200)); ms -= 200

def ensure_wifi():
    wlan.active(True)
    # A failed CYW43 association needs a fresh radio, not another connect()
    # piled onto its failed state. Keep power saving off on this control link.
    # This function is called serially, after the previous bounded attempt
    # ended. CYW43 can remain in CONNECTING after that attempt has stalled;
    # do not keep waiting on it or skip submitting our saved credentials.
    if not wlan.isconnected() and wlan.status() != 0:
        wifi_reset()
    try:
        pm_none = getattr(network.WLAN, 'PM_NONE', None)
        if pm_none is not None: wlan.config(pm=pm_none)
    except Exception:
        print('wifi: power mode unavailable')
    if not wlan.isconnected():
        try:
            import secrets
            # field secrets.py (written by the build page + all existing robots) says WIFI_PASS;
            # newer secrets.example.py says WIFI_PASSWORD — accept both, or cold boots crash here.
            _pw = getattr(secrets, 'WIFI_PASSWORD', None) or getattr(secrets, 'WIFI_PASS', '')
            print("wifi: starting a fresh association")
            wlan.connect(secrets.WIFI_SSID, _pw)
        except Exception as e:
            print("wifi err", e)
        for _ in range(150):                            # up to ~15s (cold-boot radio is slow)
            if wlan.isconnected():
                break
            feed(); time.sleep_ms(100)
    ok = wlan.isconnected()
    # distinct one-line tokens the build-page flasher scans for, so "flashed OK" never masks "Wi-Fi didn't join"
    if ok:
        print("WIFI_OK", wlan.ifconfig()[0])
    else:
        print("WIFI_FAIL", wlan.status())
    print("wifi:", ok, wlan.ifconfig()[0] if ok else "-")
    return ok

def wifi_reset():
    # power the radio down and back up — recovers a brownout-wedged CYW43 that still
    # CLAIMS to be associated (or won't reassociate) without a full chip reset
    print("wifi: bouncing the radio")
    LINK_DIAG["radio_resets"] += 1
    try:
        wlan.disconnect()
    except Exception:
        pass
    try:
        wlan.active(False)
    except Exception:
        pass
    sleep_fed(1000)
    wlan.active(True)

def ws_open():
    LINK_DIAG["io"] = "connect"
    LINK_DIAG["stage"] = "dns"
    gc.collect()         # leave contiguous heap for TLS after the preceding session
    feed()
    ai = socket.getaddrinfo(HOST, 443)[0][-1]
    raw = socket.socket()
    raw.settimeout(NET_TIMEOUT_S)   # lwIP timeout rides under the SSL layer too: every later
    feed()                          # read/write errors out instead of blocking forever
    s = None
    try:
        LINK_DIAG["stage"] = "tcp"
        raw.connect(ai)
        feed()
        LINK_DIAG["stage"] = "tls"
        s = ssl.wrap_socket(raw, server_hostname=HOST)  # SNI required by Cloudflare
        LINK_DIAG["stage"] = "websocket_upgrade"
        key = binascii.b2a_base64(os.urandom(16)).strip().decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n") % (PATH, HOST, key)
        write_all(s, req.encode())
        resp = bytearray()
        started = time.ticks_ms()
        while not resp.endswith(b"\r\n\r\n"):
            check_net_budget(started)
            if len(resp) >= MAX_HANDSHAKE_BYTES:
                raise OSError("WebSocket upgrade header too large")
            c = s.read(1)
            if not c:
                raise OSError("WebSocket upgrade ended early")
            resp.extend(c)
        ok = bytes(resp).split(b"\r\n", 1)[0].startswith(b"HTTP/1.1 101 ")
        if not ok:
            raise OSError("WebSocket upgrade rejected")
        print("handshake: OK")
        return (s, raw)
    except Exception:
        # Until return, main() does not own either socket. A TLS or HTTP
        # exception used to leak them on each reconnect attempt.
        for x in (s, raw):
            try:
                if x: x.close()
            except Exception:
                pass
        raise

def check_net_budget(started):
    if time.ticks_diff(time.ticks_ms(), started) >= NET_STAGE_MS:
        raise OSError("network progress deadline exceeded")
    feed()

def write_all(s, data):
    previous_io = LINK_DIAG["io"]
    LINK_DIAG["io"] = "write"
    started = time.ticks_ms()
    view = memoryview(data)
    offset = 0
    while offset < len(view):
        check_net_budget(started)
        count = s.write(view[offset:])
        if not count:
            raise OSError("network write made no progress")
        offset += count
    LINK_DIAG["io"] = previous_io

def send_frame(s, op, p=b""):
    n = len(p)
    if n > MAX_FRAME_BYTES or (op >= 8 and n > 125):
        raise ValueError("WebSocket frame too large")
    mask = os.urandom(4)
    if n < 126:
        hdr = bytes([0x80 | op, 0x80 | n])
    else:
        hdr = bytes([0x80 | op, 0x80 | 126, (n >> 8) & 0xFF, n & 0xFF])
    mp = bytearray(n)
    for i in range(n):
        mp[i] = p[i] ^ mask[i & 3]
    write_all(s, hdr + mask + bytes(mp))

def send_text(s, txt):
    send_frame(s, 1, txt.encode())

def recvn(s, n, started=None):
    LINK_DIAG["io"] = "frame_read"
    if started is None: started = time.ticks_ms()
    b = bytearray()
    while len(b) < n:
        check_net_budget(started)
        c = s.read(n - len(b))
        if not c:
            raise OSError("WebSocket frame ended early")
        b.extend(c)
    return bytes(b)

def _frame_after(s, b0):                # read the rest of a frame given its already-read first byte (blocking)
    started = time.ticks_ms()
    b1 = recvn(s, 1, started)
    op = b0[0] & 0x0F
    ln = b1[0] & 0x7F
    if ln == 126:
        e = recvn(s, 2, started); ln = (e[0] << 8) | e[1]
    elif ln == 127:
        e = recvn(s, 8, started); ln = 0
        for b in e:
            ln = (ln << 8) | b
    if ln > MAX_FRAME_BYTES or (op >= 8 and ln > 125):
        raise OSError("WebSocket frame too large")
    # This control protocol uses complete text messages. Do not execute the
    # first part of a fragmented command as if it were a complete command.
    if b0[0] & 0x70 or not b0[0] & 0x80 or op not in (1, 8, 9, 10):
        raise OSError("unsupported WebSocket frame")
    masked = b1[0] & 0x80
    mask = recvn(s, 4, started) if masked else None
    pl = recvn(s, ln, started) if ln else b""
    if masked and pl:
        pl = bytes(pl[i] ^ mask[i & 3] for i in range(ln))
    return (op, pl)

# ---- dog6 motion lane ----
def _ack(s, message, ok=True, **extra):
    payload = {"t": "ack", "rid": message.get("rid"), "ok": 1 if ok else 0}
    payload.update(extra)
    send_text(s, json.dumps(payload))


def _controller_diagnostics():
    """Report only states the Pico can actually observe; never imply servo feedback."""
    result = {
        "host": "Pico 2 W",
        "board": "Waveshare Pico Servo Driver",
        "firmware": "owlbot-pico-7.14",
        "servo_channels": 16,
        "protocol": 2,
        "uptime_ms": time.ticks_diff(time.ticks_ms(), BOOT_MS),
        "link": dict(LINK_DIAG),
        "reset_cause": machine.reset_cause(),
        "micropython": os.uname().release,
    }
    try:
        result["memory_free_bytes"] = gc.mem_free()
    except Exception:
        pass
    try:
        result["wifi_rssi_dbm"] = wlan.status("rssi")
    except Exception:
        pass
    return result

def link_fault(reason):
    LINK_DIAG["last_error_io"] = LINK_DIAG["io"]
    LINK_DIAG["last_error_stage"] = LINK_DIAG["stage"]
    LINK_DIAG["last_error"] = str(reason)[:120]
    # Keep the ORIGINAL fault even if subsequent TCP retries fail differently.
    # Bounded RAM only; no flash writes, identities, commands or camera data.
    faults = LINK_DIAG["faults"]
    faults.append(dict(at_ms=time.ticks_diff(time.ticks_ms(), BOOT_MS),
        stage=LINK_DIAG["stage"], io=LINK_DIAG["io"],
        error=LINK_DIAG["last_error"]))
    if len(faults) > 4:
        del faults[0]


def radio_reset_required(fails):
    # A socket that accepts writes but receives nothing can have a stale CYW43
    # association. Recover after the receive deadline, not after three TCP retries.
    # Ordinary remote closes retain the existing graduated retry policy.
    return LINK_DIAG["reset_radio"] or fails % WIFI_RESET_EVERY == 0

def apply_pose(l, r):
    """Unmodified GrowBot L/R input; chip-side posture/stepping interpretation."""
    return stock_fanout.pose(l, r)


def _handle(s, pl):
    """Dispatch one text frame. Returns the lane kind so serve() can manage the dead-man."""
    try:
        m = json.loads(pl)
    except Exception:
        return None
    if not isinstance(m, dict):
        return None
    t = m.get("t")
    commands = globals().get('stock_commands')
    head = globals().get('pico_head')
    # STOP is also sent before each GrowBot action: freeze head motion but
    # retain support. Explicit release and calibration stop remain all-off.
    if head and t in ('release', 'gaze_release'):
        head.stop(force=True)
    if commands and t in ('act', 'routine'):
        try:
            # Explicit spin/turn aliases share the tested saved-turn executor.
            # Never infer their intent from unlabelled stock L/R pose streams.
            op = commands.decode(m.get('steps')) if t == 'act' else commands.named_opcode(m.get('name'))
            if op is not None:
                if stock_fanout.active:
                    raise ValueError('stop_stock_motion_before_saved_command')
                state = commands.start(op, m.get('mode', 'replace'))
                queued = sum(x['ms'] for x in m['steps']) if t == 'act' else state['command_window_ms']
                _ack(s, m, True, queued_ms=queued, saved_body_command=state,
                     physical_feedback=False)
                return 'routine'
        except Exception as error:
            _ack(s, m, False, err=str(error), physical_feedback=False)
            return 'routine'  # never interpolate a broken command as leg angles
    if commands and commands.active:
        read_only = t in ('ping', 'dog_info', 'gaze_info') or (t == 'dog_cal' and
            (m.get('channel_action') in ('info', 'head_info', 'turn_keepalive') or
             m.get('body_action') in ('status', 'keepalive')))
        if not read_only:
            commands.cancel()
    if t in ('pose','act','routine'):
        try:
            if named_walk.running or named_turn.running:
                raise ValueError('stop_named_motion_before_stock_pose')
            if t=='pose':
                raw=m.get('lr')
                if not isinstance(raw,str) or len(raw)>80:raise ValueError('invalid_lr_pose')
                values=raw.split(',')
                if len(values)!=2:raise ValueError('invalid_lr_pose')
                state=apply_pose(float(values[0]),float(values[1]))
                if head: head.support()
                if m.get('rid') is not None or 'seq' in m:
                    _ack(s,m,True,seq=m.get('seq'),ts=m.get('ts'),stock_pose=state,physical_feedback=False)
            else:
                steps=m.get('steps')
                if t=='routine':
                    if m.get('name')!='wiggle':raise ValueError('unknown_stock_routine')
                    steps=[{'l':60,'r':120,'ms':400},{'l':120,'r':60,'ms':400},
                           {'l':60,'r':120,'ms':400},{'l':90,'r':90,'ms':300}]
                queued=stock_fanout.enqueue(steps,m.get('mode','replace'))
                if head: head.support()
                _ack(s,m,True,queued_ms=queued,stock_pose=stock_fanout.status(),physical_feedback=False)
        except Exception as error:
            stock_fanout.stop()
            _ack(s,m,False,err=str(error),physical_feedback=False)
        return 'stock'
    shared_request = t == 'dog_cal' and 'body_action' in m
    if shared_request:
        try:
            m = shared_body.resolve(m)
        except Exception as error:
            _ack(s,m,False,err=str(error))
            return 'cal'
    # Keep the established relay envelope; new channel commands also work
    # through relays that only forward existing dog_cal message types.
    action=m.get("channel_action") if t=="dog_cal" else None
    if action:
        try:
            if action in ('save','walk_save'):
                stock_fanout.stop()
            if named_turn.running and action not in ('info','stop','turn_halt','turn_keepalive','head_move','head_info','head_stop'):
                raise ValueError('stop_turn_before_other_movement')
            if action in ('head_move','head_info','head_stop'):
                if action == 'head_move':
                    if channels.active is not None or channels.queue:
                        if not (named_walk.running or named_turn.running):
                            raise ValueError('finish_manual_adjustment_first')
                    used = set(step['channel'] for step in (named_walk.plan or {}).get('steps', []))
                    used.update(c['channel'] for c in channels.channels if c['enabled'] and c['name'].lower() in ('turn','body turn','rotation'))
                    state = pico_head.move(m, used)
                else:
                    if action == 'head_stop': pico_head.stop(force=True)
                    state = pico_head.status()
                _ack(s,m,True,state=state)
            elif action=="info":
                extra = {'body_contract': shared_body.capabilities()} if shared_request else {}
                extra['stock_pose'] = stock_fanout.status()
                if commands: extra['saved_body_command'] = commands.status()
                _ack(s,m,True,channel_state=channels.status(),named_walk=named_walk.status(),walk_plan=named_walk.plan,named_turn=named_turn.status(),**extra)
            elif action=='turn_run':
                if named_walk.running: raise ValueError('stop_walk_before_turning')
                state=named_turn.start_turn(named_walk.plan,m.get('turn_channel'),m.get('binding'),m.get('pattern','a'),m.get('fraction',1))
                if head: head.support()
                _ack(s,m,True,named_turn=state,physical_feedback=False)
            elif action=='turn_halt':
                named_turn.cancel(release=False)
                _ack(s,m,True,named_turn=named_turn.status())
            elif action=='turn_keepalive':
                _ack(s,m,True,named_turn=named_turn.keepalive(m.get('run_id')))
            elif action=="walk_save":
                saved=named_walk.save(m.get("plan"))
                _ack(s,m,True,walk_plan=saved,named_walk=named_walk.status(),moved=False)
            elif action=="walk_run":
                if shared_request and named_walk.running:
                    # A repeated identical request is idempotent. A changed
                    # direction/pace must never ACK an old run as the new one.
                    speeds = {'creep':200, 'slow':600, 'fast':1000, 'run':1600}
                    if (m.get('direction','forward') != named_walk.direction or
                        m.get('continuous',False) != named_walk.continuous or
                        (m.get('pace') is not None and speeds.get(m['pace']) != named_walk.run_speed) or
                        (m.get('cycles') is not None and m['cycles'] != named_walk.run_cycles)):
                        raise ValueError('stop_walk_before_changing_parameters')
                state=named_walk.start(m.get("direction","forward"),m.get("path_clear",False),m.get("bench",False),m.get('continuous',False),m.get('pace'),m.get('cycles'))
                if head: head.support()
                _ack(s,m,True,named_walk=state,physical_feedback=False)
            elif action=='walk_keepalive':
                _ack(s,m,True,named_walk=named_walk.keepalive(m.get('run_id')),physical_feedback=False)
            elif action=="walk_continue":
                state=named_walk.continue_after_vision(m.get("run_id"),m.get("completed_cycles"),m.get("path_clear"))
                _ack(s,m,True,named_walk=state,physical_feedback=False)
            elif action=="walk_preview":
                state=named_walk.preview_next_cycle(m.get('run_id'),m.get('next_cycle'),m.get('path_clear'),m.get('capture_offset_ms'))
                _ack(s,m,True,named_walk=state,physical_feedback=False)
            elif action=="walk_halt":
                named_walk.cancel(release=False)
                _ack(s,m,True,named_walk=named_walk.status(),holding=channels.owning)
            elif action=="save":
                if named_walk.running:raise ValueError("stop_walk_before_changing_channels")
                pico_head.stop(force=True)
                saved=channels.configure(m.get("config",{}))
                _ack(s,m,True,saved_channel=saved,moved=False)
            elif action=="move":
                pico_head.stop(force=True)
                if named_walk.running:named_walk.cancel()
                count=channels.move(m.get("targets",[]),m.get("calibration",False),m.get("speed_us_s",100))
                _ack(s,m,True,accepted=count,physical_feedback=False)
            elif action=="stop":
                if head: head.stop(force=True)
                named_turn.cancel();named_walk.cancel();channels.stop();_ack(s,m,True,holding=False)
            else:raise ValueError("unknown_channel_action")
        except Exception as error:
            _ack(s,m,False,err=str(error))
        return "cal"
    # Forward intent from either voice or agent tools uses the same saved,
    # named-channel walk. Never silently fall back if its bindings are stale.
    if t in ("dog_cycle","dog_drive") and (named_walk.plan or named_walk.error):
        try:
            f=float(m.get("f",0));y=float(m.get("y",0))
            if abs(f)>0.08 and abs(f)>=abs(y):
                raise ValueError("use_vision_gated_named_walk")
            if t=="dog_drive" and abs(f)<0.08 and abs(y)<0.08 and named_walk.running:
                # A bounded walk finishes its feet-down cycle. Explicit stop,
                # release, disconnect and manual override still cancel immediately.
                _ack(s,m,True,named_walk=named_walk.status())
                return "routine"
        except Exception as error:
            _ack(s,m,False,err=str(error));return "routine"
    if named_turn.running and t in ("stop","release","gaze_release","dog_drive","dog_cycle","dog_posture","dog_routine","routine","dog_set","dog_pose","gaze","gaze_set","dog_gait_test","servo_test","dog_rest"):
        named_turn.cancel()
    if named_walk.running and t in ("stop","release","gaze_release","dog_drive","dog_cycle","dog_posture","dog_routine","routine","dog_set","dog_pose","gaze","gaze_set","dog_gait_test","servo_test","dog_rest"):
        named_walk.cancel()
    if channels.owning and t in ("stop","release","gaze_release"):
        channels.stop();_ack(s,m,True,holding=bool(head and head.targets));return "stop"
    if channels.owning and t in ("dog_drive","dog_cycle","dog_posture","dog_routine","routine","dog_set","dog_pose","gaze","gaze_set","dog_gait_test","servo_test","dog_rest"):
        channels.stop()
    if t == "ping":
        # Keep the phone's controller lease warm: bodyLastSeenAt refreshes on
        # ack/info/pong/status, and a silent body is declared stale after 15s.
        send_text(s, json.dumps({"t": "pong", "id": m.get("id"), "tms": time.ticks_ms()}))
        return "ping"
    if t == "dog_drive":
        try:
            ok = dog.drive(m.get("f", 0), m.get("y", 0),
                           m.get("step_ms", 200), m.get("stride", 1.0))
        except Exception:
            ok = False
        if m.get("rid") is not None:
            _ack(s, m, ok, mode=dog.mode)
        return "drive"
    if t == "dog_cycle":
        try:
            queued = dog.play_cycle(m.get("f", 0), m.get("y", 0),
                                    m.get("step_ms", 300), m.get("stride", 1.0))
        except Exception:
            queued = 0
        _ack(s, m, queued > 0, queued_ms=queued, mode=dog.mode,
             phases=dog._stage_count() if queued else 0)
        return "routine"
    if t == "dog_posture":
        try:
            queued = dog.play_posture(m.get("name", "stand_full"), m.get("step_ms", 350))
        except Exception:
            queued = 0
        _ack(s, m, queued > 0, queued_ms=queued, mode=dog.mode,
             phases=len(dog._posture_steps) if queued else 0, name=m.get("name", ""))
        return "routine"
    if t in ("dog_routine", "routine"):
        q = dog.play_routine(m.get("name", ""))
        _ack(s, m, q > 0, queued_ms=q, name=m.get("name", ""))
        return "routine"
    if t == "dog_cal":
        if head: head.stop(force=True)
        stock_fanout.stop()
        # Configuration never emits PWM.  The full channel map is checked for
        # duplicates before it is committed, then the ACK echoes the values
        # actually retained by the Pico.
        ok = True
        if m.get("offsets"):
            ok = dog.set_calibration(m.get("offsets", {}), save=False)
        if m.get("limits"):
            ok = dog.set_limits(m.get("limits", {}), save=False) and ok
        if m.get("lift_endpoints"):
            ok = dog.set_lift_endpoints(m.get("lift_endpoints", {}), save=False) and ok
        if m.get("ports"):
            ok = _set_all_ports(m.get("ports", {})) and ok
        if m.get("locks"):
            locks = m.get("locks", {})
            body_locks = {role: locks[role] for role in dog.locks_dict() if role in locks}
            gaze_locks = {role: locks[role] for role in gaze.locks_dict() if role in locks}
            ok = dog.set_locks(body_locks, save=False) and gaze.set_locks(gaze_locks, save=False) and ok
        if ok and not m.get("ports"):
            ok = dog.save_calibration() and gaze.save()
        _ack(s, m, ok, cal=dog.calibration(), limits=dog.limits_dict(), lift_endpoints=dog.lift_endpoints_dict(),
             ports=_all_ports(), locks=dict(dog.locks_dict(), **gaze.locks_dict()), gaze=gaze.status(), moved=False,
             err=None if ok else "invalid_or_unsaved_calibration")
        return "cal"
    if t == "dog_gait_save":
        ok = dog.save_custom_gait(m.get("steps", []))
        _ack(s, m, ok, steps=len(dog.custom_gait),
             queued_ms=dog.custom_gait_duration(), err=None if ok else "invalid_gait")
        return "cal"
    if t == "dog_gait_clear":
        ok = dog.clear_custom_gait()
        _ack(s, m, ok, steps=0)
        return "cal"
    if t == "dog_gait_test":
        queued = dog.play_custom_cycle()
        _ack(s, m, queued > 0, steps=len(dog.custom_gait), queued_ms=queued,
             err=None if queued else "no_taught_gait")
        return "routine"
    if t == "dog_pose":
        ok = dog.test_servo(m.get("role", ""), m.get("delta_us", 0))
        _ack(s, m, ok, role=m.get("role", ""))
        return "cal"
    if t == "dog_set":
        ok = dog.set_servo_us(m.get("role", ""), m.get("pulse_us", 1500), bool(m.get("slow", False)))
        _ack(s, m, ok, role=m.get("role", ""), pulse_us=m.get("pulse_us", 1500))
        return "cal"
    if t == "dog_release":
        ok = dog.release_servo(m.get("role", ""))
        _ack(s, m, ok, role=m.get("role", ""))
        return "cal"
    if t == "servo_test":
        requested_role = m.get("role", "")
        role = normalize_axis(requested_role)
        if role in ("gimbal_pan", "gimbal_tilt"):
            # Old loose-servo tests can snap the mounted phone. Require the
            # authoritative paced head lane instead of legacy calibration.
            _ack(s,m,False,err='use_paced_head_move');return 'gaze'
        else:
            role = normalize_role(requested_role)
            ok = dog.test_servo(role, m.get("delta_us", 0))
        _ack(s, m, ok, role=role, requested_role=requested_role,
             delta_us=m.get("delta_us", 0))
        return "cal"
    if t == "dog_rest":
        dog.stop(hold=True)
        _ack(s, m, True, holding=True)
        return "stop"
    if t == "release":
        dog.release()
        _ack(s, m, True, holding=False)
        return "stop"
    if t == "dog_info":
        _ack(s, m, True, profile="dog6", ports=_all_ports(), status=dog.status(), gaze=gaze.status(),
             named_walk=named_walk.status(),stock_pose=stock_fanout.status(),
             controller=_controller_diagnostics(), observability={
                 "pico_software_state": True,
                 "channel_map": True,
                 "servo_power_rail": False,
                 "servo_presence": False,
                 "servo_position_feedback": False,
                 "physical_motion": False,
             })
        return "info"
    if t == "gaze_config":
        if head: head.stop(force=True)
        gaze_values = dict(m)
        gaze_values.pop("ports", None)
        gaze_values.pop("locks", None)
        ok = gaze.configure(gaze_values, save=True)
        if m.get("ports"):
            ok = _set_all_ports(m.get("ports", {})) and ok
        if m.get("locks"):
            locks = m.get("locks", {})
            ok = gaze.set_locks({role: locks[role] for role in gaze.locks_dict() if role in locks}, save=True) and ok
        _ack(s, m, ok, ports=_all_ports(), locks=dict(dog.locks_dict(), **gaze.locks_dict()), gaze=gaze.status(), moved=False,
             err=None if ok else "invalid_or_unsaved_gaze_calibration")
        return "gaze_info"
    if t == "gaze_set":
        _ack(s,m,False,err='use_paced_head_move')
        return "gaze"
    if t == "gaze_release_axis":
        axis = normalize_axis(m.get("axis", ""))
        if head: head.release_axis('pan' if axis == 'gimbal_pan' else 'tilt' if axis == 'gimbal_tilt' else None)
        ok = gaze.release_axis(axis)
        _ack(s, m, ok, axis=axis)
        return "gaze"
    if t == "gaze":
        _ack(s,m,False,err='use_paced_head_move')
        return "gaze"
    if t == "gaze_release":
        ok = gaze.release()
        _ack(s, m, ok, gaze=gaze.status())
        return "gaze"
    if t == "gaze_info":
        _ack(s, m, True, gaze=gaze.status())
        return "gaze_info"
    if t == "stop":
        # An idle/repeated STOP must not re-engage the obsolete dog's resting
        # pose. GrowBot sends STOP before preparing its neutral walk stance.
        dog.release();gaze.release();channels.stop()
        _ack(s, m, True, queued_ms=0, holding=bool(head and head.targets))
        return "stop"
    return None

def serve(s, raw):
    global _wdt
    LINK_DIAG["stage"] = "serving"
    LINK_DIAG["connections"] += 1
    LINK_DIAG["io"] = "hello"
    LINK_DIAG["reset_radio"] = False
    poll = select.poll(); poll.register(s, select.POLLIN)
    send_text(s, json.dumps({"t": "hello", "id": DEVID}))
    LINK_DIAG["io"] = "ping"
    send_frame(s, 0x9)  # ask for receipt now, not ten seconds into a stale session
    LINK_DIAG["pings_sent"] += 1
    print("hello sent; dog6 intent + calibration lanes ready (dead-man %dms)" % DEADMAN_MS)
    if _wdt is None:
        _wdt = machine.WDT(timeout=WDT_MS)              # last-resort self-heal: reboots a truly frozen
        print("hw watchdog armed (%dms)" % WDT_MS)      # chip; from here on every path must feed()
    drive_on = False
    now = time.ticks_ms()
    last_pose = now; last_rx = now; last_ping = now; last_heartbeat = now
    received = False
    n = 0; nlast = 0; last = now
    while True:
        feed()
        # wait up to POLL_MS for a frame to START (so the act engine keeps ticking between frames).
        # Poll the TLS stream, not its underlying raw socket. TLS may already
        # have consumed an entire record containing several WebSocket frames;
        # raw readability then goes false although decrypted frames remain.
        b0 = None
        try:
            LINK_DIAG["io"] = "poll"
            if poll.poll(POLL_MS):
                LINK_DIAG["io"] = "first_byte_read"
                b0 = s.read(1)
        except OSError as e:                            # a real socket/ssl error → drop & let main() re-dial
            link_fault(e)
            print("read err:", e); return
        if b0 == b"":                                   # empty read = relay closed the socket
            link_fault("relay closed the stream")
            print("conn closed by relay"); return
        if b0:
            op, pl = _frame_after(s, b0)                # rest of the frame: blocking (s is always blocking now)
            if op is None or op == 0x8:
                LINK_DIAG["close_code"] = ((pl[0] << 8) | pl[1]) if len(pl) >= 2 else None
                link_fault("relay sent WebSocket close")
                print("conn closed by relay"); return
            last_rx = time.ticks_ms()                   # any frame (incl. pongs) proves the link is alive
            received = True
            if op == 0x9:                               # ping -> pong
                send_frame(s, 0xA, pl)                 # RFC6455: echo the ping payload exactly
            elif op == 0x1:
                LINK_DIAG["io"] = "dispatch"
                kind = _handle(s, pl)
                if kind == "drive":
                    drive_on = dog.mode in ("forward", "backward", "left", "right")
                    last_pose = time.ticks_ms()
                    n += 1
                    now = time.ticks_ms()
                    if time.ticks_diff(now, last) >= 1000:
                        print("poses", n, "rate", n - nlast, "Hz"); nlast = n; last = now
                elif kind in ("routine", "stop", "stock"):
                    drive_on = False
        LINK_DIAG["io"] = "actuator_tick"
        dog.step()
        gaze.step()
        channels.step()
        named_walk.step()
        stock_commands.step()
        named_turn.step()
        pico_head.step()
        stock_fanout.step()
        if drive_on and time.ticks_diff(time.ticks_ms(), last_pose) > DEADMAN_MS:
            dog.stop(hold=True); drive_on = False
            print("dead-man: dog settled to stable rest (silence)")
        # Link supervision runs on BOTH busy and quiet ticks. Sending is never
        # proof of receipt: only a received frame refreshes last_rx. Heartbeats
        # do not touch a movement lease, command run, or servo output.
        now = time.ticks_ms()
        LINK_DIAG["io"] = "link_check"
        if not wlan.isconnected():
            link_fault("Wi-Fi association lost")
            print("wifi dropped"); return
        deadline = LINK_DEAD_MS if received else LINK_START_MS
        if time.ticks_diff(now, last_rx) > deadline:
            LINK_DIAG["reset_radio"] = True
            link_fault("relay heartbeat deadline exceeded")
            print("link dead: nothing heard for %ds, re-dialing" % (deadline // 1000)); return
        if time.ticks_diff(now, last_ping) >= PING_MS:
            LINK_DIAG["io"] = "ping"
            send_frame(s, 0x9)  # pongs refresh receive liveness, not motor authority
            last_ping = time.ticks_ms()
            LINK_DIAG['pings_sent'] += 1
        if time.ticks_diff(now, last_heartbeat) >= HEARTBEAT_MS:
            LINK_DIAG["io"] = "heartbeat"
            # Existing GrowBot clients observe ACKs but ignore generic pong/info.
            # Null rid and an explicit event prevent this unsolicited health
            # frame from acknowledging any particular motion request.
            send_text(s, json.dumps(dict(t='ack', rid=None, ok=1, event='heartbeat',
                uptime_ms=time.ticks_diff(now, BOOT_MS), physical_feedback=False)))
            last_heartbeat = time.ticks_ms()
            LINK_DIAG['heartbeats_sent'] += 1

def main():
    global _wdt
    if _wdt is None:
        _wdt = machine.WDT(timeout=WDT_MS)
        print("hw watchdog armed before network startup (%dms)" % WDT_MS)
    sleep_fed(2000)                                     # let the WiFi radio settle on cold boot
    fails = 0
    while True:                                         # never give up: re-ensure wifi, re-dial the relay
        s = raw = None
        t0 = time.ticks_ms()
        try:
            LINK_DIAG["stage"] = "wifi_association"
            if ensure_wifi():
                s, raw = ws_open()
                if s:
                    serve(s, raw)                       # only returns when the link died
                    if time.ticks_diff(time.ticks_ms(), t0) > 30000:
                        fails = 0                       # a session that lived a while = healthy link
            else:
                link_fault("Wi-Fi association did not complete")
        except Exception as e:
            link_fault(e)
            print("loop err:", e)
        for x in (s, raw):                              # re-dialing is routine now — never leak sockets
            try:
                if x:
                    x.close()
            except Exception:
                pass
        try:
            stock_commands.cancel()
            pico_head.stop()  # lost link freezes the head at its last output
            stock_fanout.stop()
            named_turn.cancel()
            named_walk.cancel()
            if channels.owning:channels.stop()
            if dog._enabled:
                dog.stop(hold=True)                     # offline = stable stance, not a collapse
        except Exception:
            pass
        fails += 1
        LINK_DIAG["failures"] += 1
        LINK_DIAG["stage"] = "backoff"
        if fails >= HARD_RESET_AFTER:
            print("self-heal: machine.reset()")         # = the power cycle users did by hand
            sleep_fed(200)
            machine.reset()
        if radio_reset_required(fails):
            try:
                wifi_reset()
                LINK_DIAG["reset_radio"] = False
            except Exception as e:
                print("wifi reset err:", e)
        wait = min(30000, 1000 << min(fails, 5))        # backoff 2s,4s,8s,16s,30s cap
        print("re-dial in %ds (fail %d)" % (wait // 1000, fails))
        sleep_fed(wait)

def boot_calibration():
    # One-firmware build aid: a quick leg-check that ENDS with both legs at 90 (straight),
    # so on a first build you can glue the legs on straight. Confirms both legs move + the
    # L/R mapping, then leaves them at 90. Runs once on boot, before we dial the relay
    # (~8s; harmless on an already-built robot — it just stretches on power-up).
    board.servoWrite(L_PORT, 90); board.servoWrite(R_PORT, 90); sleep_fed(500)           # center
    for _ in range(2):                                                                   # RIGHT leg only
        board.servoWrite(R_PORT, 60); sleep_fed(220); board.servoWrite(R_PORT, 120); sleep_fed(220)
    board.servoWrite(R_PORT, 90)
    for _ in range(2):                                                                   # LEFT leg only
        board.servoWrite(L_PORT, 60); sleep_fed(220); board.servoWrite(L_PORT, 120); sleep_fed(220)
    board.servoWrite(L_PORT, 90)
    for _ in range(2):                                                                   # BOTH at once
        board.servoWrite(L_PORT, 55); board.servoWrite(R_PORT, 55); sleep_fed(260)
        board.servoWrite(L_PORT, 125); board.servoWrite(R_PORT, 125); sleep_fed(260)
    board.servoWrite(L_PORT, 90); board.servoWrite(R_PORT, 90); sleep_fed(2000)          # show straight (2s glue window on a first build)
    board.release(L_PORT); board.release(R_PORT)                                          # then LIMP — no held torque = no idle battery drain while it dials the relay

def _cold_boot():
    # machine.reset() and the hardware watchdog BOTH report WDT_RESET on rp2, so this
    # skips the calibration stretch on self-heal reboots and keeps it for real power-ups.
    try:
        return machine.reset_cause() != machine.WDT_RESET
    except Exception:
        return True

# Disabled for dog6: assembled linkages must never full-sweep at boot.
if False and _cold_boot():
    boot_calibration()
main()

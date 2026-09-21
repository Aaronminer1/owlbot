"""Actual serving loop, fake clock/socket: heartbeat must not renew motion."""
import ast
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

SOURCE=(Path(__file__).resolve().parents[1]/'firmware/pico/main.py').read_text()
FN=next(n for n in ast.parse(SOURCE).body if isinstance(n,ast.FunctionDef) and n.name=='serve')

class Done(Exception):pass

def simulate(mode='busy', duration=40000, wifi_drop=None, write_error=False):
    clock=[0];frames=[];messages=[];faults=[];ticks=[0];pongs=[];handled=[]
    class Poll:
        def register(self,*a):pass
        def poll(self,ms):
            clock[0]+=ms
            return [(1,1)] if mode=='busy' or (pongs and pongs[0]<=clock[0]) else []
    class Stream:
        def read(self,n):return b'\x81'
    def feed():
        if clock[0]>=duration:raise Done()
    def frame(s,b):
        if pongs and pongs[0]<=clock[0]:
            pongs.pop(0);return 10,b''
        return 1,b'{}'
    def send_frame(s,op,p=b''):
        if write_error is True:raise OSError('test network write failure')
        frames.append((clock[0],op))
        if (mode=='quiet_pongs' or (mode=='one_pong' and clock[0]==0)) and op==9:pongs.append(clock[0]+20)
    def send_text(s,text):
        m=json.loads(text)
        if write_error and m['t']=='ack':raise OSError('test network write failure')
        messages.append((clock[0],m))
    def step():ticks[0]+=1
    engine=SimpleNamespace(step=step,mode='idle')
    env=dict(_wdt=object(),LINK_DIAG={'connections':0,'pings_sent':0,'heartbeats_sent':0},
        select=SimpleNamespace(poll=Poll,POLLIN=1),
        time=SimpleNamespace(ticks_ms=lambda:clock[0],ticks_diff=lambda a,b:a-b),
        send_text=send_text,send_frame=send_frame,json=json,DEVID='test',BOOT_MS=0,
        DEADMAN_MS=500,POLL_MS=20,PING_MS=10000,HEARTBEAT_MS=5000,LINK_DEAD_MS=25000,LINK_START_MS=10000,
        feed=feed,_frame_after=frame,_handle=lambda s,p:handled.append(clock[0]) or 'stock',
        link_fault=faults.append,wlan=SimpleNamespace(isconnected=lambda:wifi_drop is None or clock[0]<wifi_drop),
        print=lambda *a:None,**{k:engine for k in ('dog','gaze','channels','named_walk',
            'stock_commands','named_turn','pico_head','stock_fanout')})
    exec(compile(ast.Module(body=[FN],type_ignores=[]),'actual serve','exec'),env)
    error=None
    try:env['serve'](Stream(),object())
    except Done:pass
    except OSError as e:error=str(e)
    return dict(now=clock[0],frames=frames,messages=messages,faults=faults,
                ticks=ticks[0],handled=handled,diag=env['LINK_DIAG'],error=error)

class RelayHeartbeatTests(unittest.TestCase):
    def test_busy_stream_keeps_fixed_heartbeats_and_motor_ticks(self):
        r=simulate()
        self.assertEqual([t for t,op in r['frames'] if op==9],[0,10000,20000,30000,40000])
        beats=[(t,m) for t,m in r['messages'] if m['t']=='ack']
        self.assertEqual([t for t,m in beats],list(range(5000,40001,5000)))
        for _,m in beats:
            self.assertIsNone(m['rid']);self.assertEqual(m['event'],'heartbeat')
            self.assertFalse(m['physical_feedback'])
            self.assertNotIn('completed',m)
        self.assertEqual(r['ticks'],2000*8)
        self.assertEqual(len(r['handled']),2000)
        self.assertEqual(r['faults'],[])
        self.assertEqual(r['diag']['heartbeats_sent'],8)

    def test_quiet_with_pongs_stays_alive_without_motion_requests(self):
        r=simulate('quiet_pongs')
        self.assertEqual(r['now'],40000)
        self.assertEqual(r['faults'],[])
        self.assertEqual(r['handled'],[])
        self.assertEqual(r['diag']['heartbeats_sent'],8)

    def test_sent_heartbeats_do_not_hide_a_dead_link(self):
        r=simulate('quiet_no_reply')
        self.assertEqual(r['now'],10020)
        self.assertEqual(r['faults'],['relay heartbeat deadline exceeded'])
        self.assertEqual(r['diag']['heartbeats_sent'],2)
        self.assertTrue(r['diag']['reset_radio'])

    def test_established_session_keeps_normal_deadline(self):
        r=simulate('one_pong')
        self.assertEqual(r['now'],25040)
        self.assertEqual(r['diag']['heartbeats_sent'],5)
        self.assertTrue(r['diag']['reset_radio'])

    def test_wifi_loss_detected_even_when_input_is_buffered(self):
        r=simulate(wifi_drop=6000)
        self.assertEqual(r['now'],6000)
        self.assertEqual(r['faults'],['Wi-Fi association lost'])

    def test_send_failure_propagates_to_existing_reconnect_handler(self):
        r=simulate(write_error=True)
        self.assertEqual(r['now'],0)
        self.assertEqual(r['error'],'test network write failure')
        self.assertEqual(r['diag']['heartbeats_sent'],0)

    def test_new_session_starts_fresh_cadence(self):
        a=simulate(duration=12000);b=simulate(duration=12000)
        self.assertEqual(a['frames'],b['frames'])
        self.assertEqual(a['diag']['connections'],1)
        self.assertEqual(b['diag']['heartbeats_sent'],2)

    def test_heartbeat_write_failure_also_propagates(self):
        r=simulate(write_error='heartbeat')
        self.assertEqual(r['now'],5000)
        self.assertEqual(r['error'],'test network write failure')
        self.assertEqual(r['diag']['heartbeats_sent'],0)

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""Temporary OwlBot laptop body controller for a Pololu Mini Maestro.

The phone sends bounded, high-level commands over an authenticated WebSocket.
This process owns every trajectory and is the only component that emits Maestro
targets.  Dry-run is the default; live serial output requires ``--live``.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hmac
import json
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import serial
from websockets.asyncio.server import ServerConnection, serve


LOG = logging.getLogger("owlbot.maestro")
COMMANDS = {
    "walk", "turn", "look_left", "look_right", "look_center",
    "look_up", "look_down", "rest", "release", "stop",
}
LEG_ROLES = (
    "front_left_hip", "front_left_knee",
    "front_right_hip", "front_right_knee",
    "rear_left_hip", "rear_left_knee",
    "rear_right_hip", "rear_right_knee",
)


def clamp(value: float, low: float, high: float) -> float:
    return low if value < low else high if value > high else value


@dataclass(frozen=True)
class Joint:
    role: str
    channel: int
    center_us: int
    min_us: int
    max_us: int
    travel_us: int
    invert: bool = False
    enabled: bool = True

    def target(self, normalized: float) -> int:
        direction = -1.0 if self.invert else 1.0
        pulse = self.center_us + direction * clamp(normalized, -1.0, 1.0) * self.travel_us
        return int(round(clamp(pulse, self.min_us, self.max_us)))


class MaestroOutput:
    def __init__(self, port: str, baud: int, live: bool) -> None:
        self.port = port
        self.baud = baud
        self.live = live
        self.serial: serial.Serial | None = None
        self.last_targets: dict[int, int] = {}

    def open(self) -> None:
        if not self.live:
            LOG.warning("DRY RUN: no bytes will be written to the Maestro")
            return
        self.serial = serial.Serial(self.port, self.baud, timeout=0.1, write_timeout=0.25)
        LOG.warning("LIVE OUTPUT ARMED on %s", self.port)

    def close(self) -> None:
        self.release_all()
        if self.serial is not None:
            self.serial.close()
            self.serial = None

    @staticmethod
    def packet(channel: int, pulse_us: int) -> bytes:
        target = int(clamp(pulse_us * 4, 0, 16383))
        return bytes((0x84, channel & 0x7F, target & 0x7F, (target >> 7) & 0x7F))

    def set_targets(self, targets: dict[int, int]) -> None:
        changed = {ch: pulse for ch, pulse in targets.items() if self.last_targets.get(ch) != pulse}
        if not changed:
            return
        if self.live:
            if self.serial is None:
                raise RuntimeError("Maestro serial port is not open")
            payload = b"".join(self.packet(ch, pulse) for ch, pulse in sorted(changed.items()))
            self.serial.write(payload)
            self.serial.flush()
        LOG.info("targets %s", " ".join(f"ch{ch}={pulse}us" for ch, pulse in sorted(changed.items())))
        self.last_targets.update(changed)

    def release_all(self) -> None:
        channels = sorted(self.last_targets)
        if self.live and self.serial is not None and channels:
            self.serial.write(b"".join(self.packet(ch, 0) for ch in channels))
            self.serial.flush()
        if channels:
            LOG.warning("released channels %s", ",".join(map(str, channels)))
        self.last_targets.clear()


class MotionEngine:
    def __init__(self, output: MaestroOutput, joints: dict[str, Joint], frame_ms: int) -> None:
        self.output = output
        self.joints = joints
        self.frame_ms = max(20, frame_ms)
        self.active: asyncio.Task[None] | None = None
        self.command_name = "idle"

    def require(self, roles: tuple[str, ...]) -> None:
        missing = [role for role in roles if role not in self.joints or not self.joints[role].enabled]
        if missing:
            raise ValueError("unconfigured joints: " + ", ".join(missing))

    def pose(self, values: dict[str, float]) -> None:
        targets = {
            joint.channel: joint.target(values.get(role, 0.0))
            for role, joint in self.joints.items() if joint.enabled
        }
        self.output.set_targets(targets)

    async def interpolate(self, start: dict[str, float], end: dict[str, float], duration_ms: int) -> None:
        frames = max(1, int(duration_ms / self.frame_ms))
        for index in range(1, frames + 1):
            x = index / frames
            smooth = x * x * (3.0 - 2.0 * x)
            values = {
                role: start.get(role, 0.0) + (end.get(role, 0.0) - start.get(role, 0.0)) * smooth
                for role in set(start) | set(end)
            }
            self.pose(values)
            await asyncio.sleep(self.frame_ms / 1000.0)

    async def play(self, poses: list[dict[str, float]], duration_ms: int) -> None:
        current = {role: 0.0 for role in self.joints}
        for wanted in poses:
            await self.interpolate(current, wanted, duration_ms)
            current = dict(wanted)
        await self.interpolate(current, {role: 0.0 for role in self.joints}, duration_ms)

    def walk_poses(self, backward: bool, steps: int) -> list[dict[str, float]]:
        self.require(LEG_ROLES)
        direction = -1.0 if backward else 1.0
        poses: list[dict[str, float]] = []
        for _ in range(steps):
            poses.extend((
                {
                    "front_left_hip": 0.42 * direction, "front_left_knee": -0.38,
                    "rear_right_hip": -0.42 * direction, "rear_right_knee": -0.38,
                    "front_right_hip": -0.28 * direction, "rear_left_hip": 0.28 * direction,
                },
                {
                    "front_left_hip": -0.28 * direction, "rear_right_hip": 0.28 * direction,
                    "front_right_hip": 0.42 * direction, "front_right_knee": -0.38,
                    "rear_left_hip": -0.42 * direction, "rear_left_knee": -0.38,
                },
            ))
        return poses

    def turn_poses(self, right: bool, cycles: int) -> list[dict[str, float]]:
        self.require(LEG_ROLES)
        sign = 1.0 if right else -1.0
        poses: list[dict[str, float]] = []
        for _ in range(cycles):
            poses.extend((
                {
                    "front_left_hip": 0.38 * sign, "front_left_knee": -0.34,
                    "rear_left_hip": -0.38 * sign,
                    "front_right_hip": 0.38 * sign,
                    "rear_right_hip": -0.38 * sign, "rear_right_knee": -0.34,
                },
                {
                    "front_left_hip": -0.38 * sign,
                    "rear_left_hip": 0.38 * sign, "rear_left_knee": -0.34,
                    "front_right_hip": -0.38 * sign, "front_right_knee": -0.34,
                    "rear_right_hip": 0.38 * sign,
                },
            ))
        return poses

    async def execute(self, message: dict[str, Any]) -> None:
        name = str(message.get("name", "")).lower()
        if name not in COMMANDS:
            raise ValueError(f"unsupported command: {name}")
        self.command_name = name
        if name in {"stop", "release"}:
            self.output.release_all()
            return
        if name == "rest":
            self.pose({})
            return
        if name == "walk":
            steps = int(clamp(float(message.get("steps", 2)), 1, 8))
            speed = clamp(float(message.get("speed", 0.5)), 0.15, 1.0)
            duration = int(520 - speed * 300)
            await self.play(self.walk_poses(str(message.get("direction", "forward")) == "backward", steps), duration)
            return
        if name == "turn":
            amount = clamp(float(message.get("amount", 30)), 10, 180)
            speed = clamp(float(message.get("speed", 0.45)), 0.15, 1.0)
            duration = int(540 - speed * 300)
            cycles = max(1, round(amount / 30))
            await self.play(self.turn_poses(str(message.get("direction", "left")) == "right", cycles), duration)
            return

        self.require(("head_pan", "head_tilt"))
        positions = {
            "look_left": {"head_pan": -1.0, "head_tilt": 0.0},
            "look_right": {"head_pan": 1.0, "head_tilt": 0.0},
            "look_center": {"head_pan": 0.0, "head_tilt": 0.0},
            "look_up": {"head_pan": 0.0, "head_tilt": 1.0},
            "look_down": {"head_pan": 0.0, "head_tilt": -1.0},
        }
        self.pose(positions[name])

    async def stop(self) -> None:
        if self.active is not None and not self.active.done():
            self.active.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.active
        self.active = None
        self.command_name = "idle"
        self.output.release_all()


class BodyServer:
    def __init__(self, engine: MotionEngine, token: str, dry_run: bool) -> None:
        self.engine = engine
        self.token = token
        self.dry_run = dry_run
        self.owner: ServerConnection | None = None
        self.last_message_at = time.monotonic()

    async def watchdog(self, stop_event: asyncio.Event, timeout_s: float = 5.0) -> None:
        while not stop_event.is_set():
            await asyncio.sleep(0.25)
            owner = self.owner
            if owner is None or time.monotonic() - self.last_message_at <= timeout_s:
                continue
            LOG.error("application heartbeat expired; stopping motion and closing control lease")
            await self.engine.stop()
            self.owner = None
            with contextlib.suppress(Exception):
                await owner.close(code=1011, reason="body heartbeat expired")

    async def send(self, ws: ServerConnection, message: dict[str, Any]) -> None:
        await ws.send(json.dumps(message, separators=(",", ":")))

    async def run_command(self, ws: ServerConnection, message: dict[str, Any]) -> None:
        rid = message.get("rid")
        name = str(message.get("name", "")).lower()
        try:
            await self.engine.execute(message)
            await self.send(ws, {"t": "ack", "of": "command", "rid": rid, "ok": 1,
                                 "name": name, "phase": "completed", "dry_run": self.dry_run})
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await self.send(ws, {"t": "ack", "of": "command", "rid": rid, "ok": 0,
                                     "name": name, "phase": "stopped", "err": "preempted"})
            raise
        except Exception as exc:
            LOG.exception("command failed")
            self.engine.output.release_all()
            await self.send(ws, {"t": "ack", "of": "command", "rid": rid, "ok": 0,
                                 "name": name, "phase": "fault", "err": str(exc)})

    async def handler(self, ws: ServerConnection) -> None:
        if ws.request is None or ws.request.path.split("?", 1)[0] != "/ws":
            await ws.close(code=1008, reason="use /ws")
            return
        authenticated = False
        try:
            async for raw in ws:
                self.last_message_at = time.monotonic()
                try:
                    message = json.loads(raw)
                except Exception:
                    await self.send(ws, {"t": "error", "err": "JSON object required"})
                    continue
                if not isinstance(message, dict):
                    continue
                msg_type = str(message.get("t", message.get("type", ""))).lower()
                if not authenticated:
                    supplied = str(message.get("token", "")) if msg_type == "auth" else ""
                    if not hmac.compare_digest(supplied, self.token):
                        await self.send(ws, {"t": "ack", "of": "auth", "ok": 0})
                        await ws.close(code=1008, reason="authentication failed")
                        return
                    if self.owner is not None and self.owner is not ws:
                        await self.send(ws, {"t": "ack", "of": "auth", "ok": 0, "err": "controller busy"})
                        await ws.close(code=1013, reason="controller busy")
                        return
                    self.owner = ws
                    authenticated = True
                    await self.send(ws, {"t": "ack", "of": "auth", "ok": 1})
                    continue
                if msg_type in {"info", "quad8_info"}:
                    await self.send(ws, {"t": "info", "id": "laptop-maestro", "fw": "owlbot-laptop-bridge-0.1",
                                         "board": "windows", "profile": "quad8", "transport": "usb-command-port",
                                         "dry_run": self.dry_run, "commands": sorted(COMMANDS)})
                    continue
                if msg_type == "ping":
                    await self.send(ws, {"t": "pong", "id": message.get("id"), "tms": int(time.monotonic() * 1000)})
                    continue
                if msg_type == "stop" or (msg_type == "command" and message.get("name") == "stop"):
                    await self.engine.stop()
                    await self.send(ws, {"t": "ack", "of": "stop", "rid": message.get("rid"), "ok": 1})
                    continue
                if msg_type == "command":
                    await self.engine.stop()
                    self.engine.active = asyncio.create_task(self.run_command(ws, message))
                    continue
                await self.send(ws, {"t": "ack", "of": msg_type or "unknown", "rid": message.get("rid"),
                                     "ok": 0, "err": "unsupported message"})
        finally:
            if self.owner is ws:
                self.owner = None
                await self.engine.stop()
                LOG.warning("controller disconnected; outputs released")


def load_joints(path: Path) -> tuple[dict[str, Joint], int]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    joints: dict[str, Joint] = {}
    for role, item in raw.get("joints", {}).items():
        joints[role] = Joint(
            role=role,
            channel=int(item["channel"]),
            center_us=int(item.get("center_us", 1500)),
            min_us=int(item.get("min_us", 1000)),
            max_us=int(item.get("max_us", 2000)),
            travel_us=int(item.get("travel_us", 250)),
            invert=bool(item.get("invert", False)),
            enabled=bool(item.get("enabled", True)),
        )
    channels = [joint.channel for joint in joints.values() if joint.enabled]
    if len(channels) != len(set(channels)):
        raise ValueError("enabled joints must use unique Maestro channels")
    return joints, int(raw.get("frame_ms", 40))


def parse_args() -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--ws-port", type=int, default=8765)
    parser.add_argument("--serial-port", default="COM6")
    parser.add_argument("--baud", type=int, default=9600,
                        help="Virtual command-port baud; ignored by the Maestro USB transport")
    parser.add_argument("--config", type=Path, default=here / "quad8.example.json")
    parser.add_argument("--live", action="store_true", help="Actually write Maestro targets")
    parser.add_argument("--token", default=os.environ.get("OWLBOT_BODY_TOKEN", ""))
    return parser.parse_args()


async def async_main(args: argparse.Namespace) -> None:
    if len(args.token) < 16:
        raise SystemExit("Set OWLBOT_BODY_TOKEN or --token to at least 16 characters; it is never stored")
    joints, frame_ms = load_joints(args.config)
    output = MaestroOutput(args.serial_port, args.baud, args.live)
    output.open()
    engine = MotionEngine(output, joints, frame_ms)
    body = BodyServer(engine, args.token, dry_run=not args.live)
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signame in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, signame, None)
        if sig is not None:
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, stop_event.set)
    LOG.info("listening on ws://%s:%d/ws profile=quad8 live=%s", args.host, args.ws_port, args.live)
    watchdog = asyncio.create_task(body.watchdog(stop_event))
    try:
        async with serve(body.handler, args.host, args.ws_port, ping_interval=20, ping_timeout=20,
                         max_size=64 * 1024):
            await stop_event.wait()
    finally:
        watchdog.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watchdog
        await engine.stop()
        output.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        LOG.error("bridge failed: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()

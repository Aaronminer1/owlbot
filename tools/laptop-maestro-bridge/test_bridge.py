#!/usr/bin/env python3
"""Network/trajectory smoke test. Never opens a serial port."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from bridge import BodyServer, MaestroOutput, MotionEngine, load_joints


async def main() -> None:
    here = Path(__file__).resolve().parent
    joints, frame_ms = load_joints(here / "quad8.example.json")
    output = MaestroOutput("unused", 9600, live=False)
    output.open()
    engine = MotionEngine(output, joints, frame_ms)
    body = BodyServer(engine, "temporary-test-token", dry_run=True)

    assert MaestroOutput.packet(2, 1500) == bytes((0x84, 0x02, 0x70, 0x2E))
    async with serve(body.handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        async with connect(f"ws://127.0.0.1:{port}/ws") as ws:
            await ws.send(json.dumps({"t": "auth", "token": "temporary-test-token"}))
            assert json.loads(await ws.recv())["ok"] == 1
            await ws.send(json.dumps({"t": "info"}))
            info = json.loads(await ws.recv())
            assert info["profile"] == "quad8" and info["dry_run"] is True
            await ws.send(json.dumps({"t": "command", "name": "walk", "steps": 1,
                                      "speed": 1, "rid": 7}))
            done = json.loads(await asyncio.wait_for(ws.recv(), 5))
            assert done["rid"] == 7 and done["ok"] == 1 and done["phase"] == "completed"
            await ws.send(json.dumps({"t": "stop", "rid": 8}))
            assert json.loads(await ws.recv())["ok"] == 1

    assert output.serial is None
    print("Laptop bridge smoke test passed without opening a serial port.")


if __name__ == "__main__":
    asyncio.run(main())

"""
framework/server.py — FastAPI 服务器入口。
启动: uvicorn framework.server:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations
import asyncio, json, threading
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .core.protocol import MsgType, ErrorCode
from .room import RoomRegistry
from .games import get_game_class, list_games
from .net_bridge import NetBridge

app = FastAPI(title='GamePlatform')
_registry = RoomRegistry()
_STATIC = Path(__file__).parent / 'static'

if _STATIC.exists():
    app.mount('/static', StaticFiles(directory=str(_STATIC), html=True), name='static')

@app.get('/')
async def index():
    return FileResponse(str(_STATIC / 'index.html'))

@app.websocket('/ws')
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_event_loop()
    room = None
    member = None

    async def send(msg):
        try: await ws.send_json(msg)
        except Exception: pass

    async def err(code, msg):
        await send({'type': MsgType.ERROR, 'code': code, 'msg': msg})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                await err(ErrorCode.INVALID_MSG, 'JSON 解析失败')
                continue

            t = data.get('type', '')

            if t == MsgType.PING:
                await send({'type': MsgType.PONG})

            elif t == MsgType.LIST:
                await send({'type': MsgType.GAME_LIST, 'games': list_games()})

            elif t == MsgType.CREATE:
                gid   = data.get('game', '')
                count = int(data.get('player_count', 4))
                pwd   = data.get('password', '')
                name  = data.get('name', 'Player')
                try:
                    get_game_class(gid)
                except ValueError as e:
                    await err(ErrorCode.INVALID_MSG, str(e))
                    continue
                room   = _registry.create(gid, count, pwd)
                member = room.add_player(ws, name)
                await send({'type': MsgType.ROOM, **room.to_dict(), 'your_idx': member.player_idx})

            elif t == MsgType.JOIN:
                code     = data.get('room', '').upper()
                name     = data.get('name', 'Player')
                pwd      = data.get('password', '')
                spectate = bool(data.get('spectate', False))
                room = _registry.get(code)
                if room is None:
                    await err(ErrorCode.ROOM_NOT_FOUND, f'房间 {code} 不存在')
                    room = None; continue
                if room.password and room.password != pwd:
                    await err(ErrorCode.WRONG_PASSWORD, '密码错误')
                    room = None; continue
                if not spectate and room.is_full():
                    await err(ErrorCode.ROOM_FULL, '房间已满')
                    room = None; continue
                if not spectate and room.started:
                    await err(ErrorCode.GAME_STARTED, '游戏已开始')
                    room = None; continue
                member   = room.add_spectator(ws, name) if spectate else room.add_player(ws, name)
                your_idx = -1 if spectate else member.player_idx
                room_msg = {'type': MsgType.ROOM, **room.to_dict(), 'your_idx': your_idx}
                for m in room.members:
                    if m.connected:
                        try: await m.ws.send_json(room_msg)
                        except Exception: pass
                if not room.started and not spectate and room.is_full():
                    await _start_game(room, loop)

            elif t == MsgType.RESPONSE:
                if room is None or member is None:
                    await err(ErrorCode.INVALID_MSG, '尚未加入房间'); continue
                if member.is_spectator:
                    continue
                bridge = getattr(room, '_bridge', None)
                if bridge:
                    bridge.receive_response(member.player_idx,
                                            data.get('kind',''), data.get('value'))

    except WebSocketDisconnect:
        pass
    finally:
        if room and member:
            room.remove_member(ws)
            bridge = getattr(room, '_bridge', None)
            if bridge and not member.is_spectator:
                bridge._handle_disconnect(member)

async def _start_game(room, loop):
    room.started = True
    game_cls = get_game_class(room.game_id)
    game     = game_cls()
    bridge   = NetBridge(room=room, loop=loop)
    bridge.set_game(game)
    game.bridge  = bridge
    room._bridge = bridge

    names  = [m.name for m in room.players]
    flags  = [True] * len(names)
    for i in range(room.player_count - len(names)):
        names.append(f'AI-{i+1}'); flags.append(False)

    game.setup(names, flags)
    asyncio.create_task(bridge.broadcast_loop())

    def _run():
        try: game.run()
        except Exception as e: bridge.log(f'⚠ 游戏异常: {e}', 'warn')

    t = threading.Thread(target=_run, daemon=True)
    room.game_thread = t
    t.start()
    bridge.log('游戏开始！', 'header')
    bridge.broadcast_state()

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


# ── 广播工具 ──────────────────────────────────────────────────────────────────

async def _broadcast_room(room):
    """向房间内所有已连接的真人成员广播最新房间状态（含各自 your_idx）。"""
    base = {'type': MsgType.ROOM, **room.to_dict()}
    for m in list(room.members):
        if not m.connected or m.is_ai:
            continue
        try:
            await m.ws.send_json({**base, 'your_idx': m.player_idx if not m.is_spectator else -1})
        except Exception:
            pass


async def _broadcast_raw(room, msg: dict):
    """向房间内所有已连接的真人成员广播任意消息。"""
    for m in list(room.members):
        if not m.connected or m.is_ai:
            continue
        try:
            await m.ws.send_json(msg)
        except Exception:
            pass


# ── 倒计时 ────────────────────────────────────────────────────────────────────

_COUNTDOWN_SECS = 15

async def _start_countdown(room, loop):
    """满员后 15s 倒计时，到 0 时自动开始游戏。"""
    try:
        for remaining in range(_COUNTDOWN_SECS, 0, -1):
            await _broadcast_raw(room, {'type': MsgType.COUNTDOWN, 'seconds': remaining})
            await asyncio.sleep(1)
        if not room.started:
            await _start_game(room, loop)
    except asyncio.CancelledError:
        # 被房主手动开始或房间解散取消
        pass


async def _trigger_full(room, loop):
    """当房间满员时触发（或重置）倒计时。"""
    if room._countdown_task and not room._countdown_task.done():
        room._countdown_task.cancel()
    room._countdown_task = asyncio.create_task(_start_countdown(room, loop))


# ── WebSocket 路由 ────────────────────────────────────────────────────────────

@app.websocket('/ws')
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_event_loop()
    room = None
    member = None

    async def send(msg):
        try: await ws.send_json(msg)
        except Exception: pass

    async def err(code, msg_text):
        await send({'type': MsgType.ERROR, 'code': code, 'msg': msg_text})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                await err(ErrorCode.INVALID_MSG, 'JSON 解析失败')
                continue

            t = data.get('type', '')

            # ── PING ──────────────────────────────────────────────────────
            if t == MsgType.PING:
                await send({'type': MsgType.PONG})

            # ── LIST ──────────────────────────────────────────────────────
            elif t == MsgType.LIST:
                await send({'type': MsgType.GAME_LIST, 'games': list_games()})

            # ── CREATE ────────────────────────────────────────────────────
            elif t == MsgType.CREATE:
                gid     = data.get('game', '')
                count   = int(data.get('player_count', 4))
                pwd     = data.get('password', '')
                name    = data.get('name', 'Player')
                timeout = int(data.get('turn_timeout', 30))
                try:
                    get_game_class(gid)
                except ValueError as e:
                    await err(ErrorCode.INVALID_MSG, str(e))
                    continue
                room   = _registry.create(gid, count, pwd, turn_timeout=timeout)
                member = room.add_player(ws, name)   # 创建者自动成为房主
                await send({'type': MsgType.ROOM, **room.to_dict(),
                            'your_idx': member.player_idx})

            # ── JOIN ──────────────────────────────────────────────────────
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
                # 广播给全房间
                await _broadcast_room(room)
                # 新加入者也单独收到含 your_idx 的消息（broadcast_room 已涵盖）

                # 满员则触发倒计时
                if not room.started and not spectate and room.is_full():
                    await _trigger_full(room, loop)

            # ── ADD_AI（房主专属） ─────────────────────────────────────────
            elif t == MsgType.ADD_AI:
                if room is None or member is None or member.is_spectator:
                    continue
                if room.host_ws is not ws:
                    await err(ErrorCode.FORBIDDEN, '只有房主可以添加 AI')
                    continue
                if room.is_full():
                    await err(ErrorCode.ROOM_FULL, '房间已满，无法添加 AI')
                    continue
                if room.started:
                    continue
                ai_member = room.add_ai()
                if ai_member is None:
                    await err(ErrorCode.ROOM_FULL, '房间已满')
                    continue
                await _broadcast_room(room)
                if room.is_full() and not room.started:
                    await _trigger_full(room, loop)

            # ── START_GAME（房主专属） ─────────────────────────────────────
            elif t == MsgType.START_GAME:
                if room is None or member is None or member.is_spectator:
                    continue
                if room.host_ws is not ws:
                    await err(ErrorCode.FORBIDDEN, '只有房主可以开始游戏')
                    continue
                if room.started:
                    continue
                # 取消倒计时后立即开始
                if room._countdown_task and not room._countdown_task.done():
                    room._countdown_task.cancel()
                    room._countdown_task = None
                # 广播取消倒计时
                await _broadcast_raw(room, {'type': MsgType.COUNTDOWN, 'seconds': 0})
                await _start_game(room, loop)

            # ── RESPONSE ──────────────────────────────────────────────────
            elif t == MsgType.RESPONSE:
                if room is None or member is None:
                    await err(ErrorCode.INVALID_MSG, '尚未加入房间'); continue
                if member.is_spectator:
                    continue
                bridge = getattr(room, '_bridge', None)
                if bridge:
                    bridge.receive_response(member.player_idx,
                                            data.get('kind', ''), data.get('value'))

            # ── LEAVE_GAME ────────────────────────────────────────────────
            elif t == MsgType.LEAVE_GAME:
                if room is None or member is None or member.is_spectator:
                    continue
                if not room.started:
                    continue
                bridge = getattr(room, '_bridge', None)
                if bridge:
                    bridge.handle_leave(member.player_idx)
                room.remove_member(ws)
                room = None
                member = None

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
    await _broadcast_room(room)  # 通知所有客户端游戏已开始 → initGameUI
    game_cls = get_game_class(room.game_id)
    game     = game_cls()
    bridge   = NetBridge(room=room, loop=loop)
    bridge.set_game(game)
    game.bridge  = bridge
    room._bridge = bridge

    # 按照 room.players 的顺序构建 names / flags
    # AI RoomMember 已由房主提前加入，is_ai=True
    names = [m.name for m in room.players]
    flags = [not m.is_ai for m in room.players]
    # 若总人数仍不足 player_count（房主没填满就手动开始），剩余由 AI 补齐
    while len(names) < room.player_count:
        names.append(f'AI-{len(names) + 1}')
        flags.append(False)

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

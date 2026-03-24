"""
framework/server.py — FastAPI 服务器入口。
启动: uvicorn framework.server:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations
import asyncio, json, logging, threading, time
from collections import deque
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

_logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.WARNING)

MAX_ROOMS = 50              # 全局最大房间数
_MAX_CONNS_PER_IP = 10      # 每 IP 最多同时在线连接数
_MAX_CREATES_PER_MIN = 5    # 每 IP 每分钟最多创建房间数
_ip_connections: dict = {}  # ip -> 当前在线连接数
_ip_creates: dict = {}      # ip -> deque of create timestamps

if _STATIC.exists():
    app.mount('/static', StaticFiles(directory=str(_STATIC), html=False), name='static')

@app.get('/')
async def index():
    return FileResponse(str(_STATIC / 'index.html'))


@app.get('/favicon.ico', include_in_schema=False)
async def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)


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
    client_ip = ws.client.host
    _ip_connections[client_ip] = _ip_connections.get(client_ip, 0) + 1
    if _ip_connections[client_ip] > _MAX_CONNS_PER_IP:
        _ip_connections[client_ip] -= 1
        await ws.close(code=1008, reason='连接数超限')
        return
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
                gid  = str(data.get('game', ''))[:32]
                name = str(data.get('name', 'Player')).strip()[:20]
                pwd  = str(data.get('password', ''))[:64]
                ginfo_map = {g['id']: g for g in list_games()}
                if gid not in ginfo_map:
                    await err(ErrorCode.INVALID_MSG, f'未知游戏 {gid!r}')
                    continue
                gi = ginfo_map[gid]
                try:
                    count = int(data.get('player_count', gi['min_players']))
                    if not (gi['min_players'] <= count <= gi['max_players']):
                        raise ValueError
                except (ValueError, TypeError):
                    await err(ErrorCode.INVALID_MSG,
                              f'游戏 {gi["name"]} 需要 {gi["min_players"]}–{gi["max_players"]} 人')
                    continue
                try:
                    timeout = int(data.get('turn_timeout', 30))
                    if not (0 <= timeout <= 600):
                        raise ValueError
                except (ValueError, TypeError):
                    await err(ErrorCode.INVALID_MSG, 'turn_timeout 须为 0-600 秒')
                    continue
                if not name:
                    await err(ErrorCode.INVALID_MSG, '玩家名不能为空')
                    continue
                if len(_registry._rooms) >= MAX_ROOMS:
                    await err(ErrorCode.INVALID_MSG, '服务器房间数已达上限，请稍后再试')
                    continue
                now = time.monotonic()
                creates = _ip_creates.setdefault(client_ip, deque())
                while creates and now - creates[0] > 60:
                    creates.popleft()
                if len(creates) >= _MAX_CREATES_PER_MIN:
                    await err(ErrorCode.INVALID_MSG, '创建太频繁，请稍后再试')
                    continue
                creates.append(now)
                room   = _registry.create(gid, count, pwd, turn_timeout=timeout)
                member = room.add_player(ws, name)
                await send({'type': MsgType.ROOM, **room.to_dict(),
                            'your_idx': member.player_idx})

            # ── JOIN ──────────────────────────────────────────────────────
            elif t == MsgType.JOIN:
                code     = str(data.get('room', '')).upper()[:6]
                name     = str(data.get('name', 'Player')).strip()[:20]
                pwd      = str(data.get('password', ''))[:64]
                spectate = bool(data.get('spectate', False))
                if not name:
                    await err(ErrorCode.INVALID_MSG, '玩家名不能为空')
                    continue

                room = _registry.get(code)
                if room is None:
                    await err(ErrorCode.ROOM_NOT_FOUND, f'房间 {code} 不存在')
                    room = None; continue
                if not room.check_password(pwd):
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

            # ── CHANGE_GAME（等待室切换游戏，房主专属） ─────────────────
            elif t == MsgType.CHANGE_GAME:
                if room is None or member is None or member.is_spectator:
                    continue
                if room.host_ws is not ws:
                    await err(ErrorCode.FORBIDDEN, '只有房主可以更换游戏')
                    continue
                if room.started:
                    continue
                new_gid = str(msg.get('game_id', ''))[:32]
                ginfo_map = {g['id']: g for g in list_games()}
                if new_gid not in ginfo_map:
                    await err(ErrorCode.INVALID_MSG, '未知游戏')
                    continue
                gi = ginfo_map[new_gid]
                if not (gi['min_players'] <= room.player_count <= gi['max_players']):
                    await err(ErrorCode.INVALID_MSG,
                              f'当前人数 {room.player_count} 不适合游戏 {gi["name"]}'
                              f'（需要 {gi["min_players"]}–{gi["max_players"]} 人）')
                    continue
                room.game_id = new_gid
                # 可选地同时更新人数
                new_count = data.get('player_count')
                if new_count is not None:
                    try:
                        new_count = int(new_count)
                        if not (gi['min_players'] <= new_count <= gi['max_players']):
                            raise ValueError
                        if new_count < len(room.players):
                            new_count = len(room.players)  # 不允许低于已有玩家数
                        room.player_count = new_count
                    except (ValueError, TypeError):
                        pass  # 忽略无效的 player_count
                await _broadcast_room(room)

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

            # ── RESTART_VOTE ──────────────────────────────────────────────
            elif t == MsgType.RESTART_VOTE:
                if room is None or member is None or member.is_spectator:
                    continue
                if not room.started or not room._game_ended:
                    continue
                all_voted = room.vote_restart(member.player_idx)
                voted, total = room.restart_vote_count()
                await _broadcast_raw(room, {
                    'type': MsgType.RESTART_STATUS,
                    'voted': voted,
                    'total': total,
                })
                if all_voted:
                    # 等待游戏线程退出（正常情况下已结束）
                    gt = getattr(room, 'game_thread', None)
                    if gt and gt.is_alive():
                        await asyncio.get_event_loop().run_in_executor(
                            None, lambda: gt.join(timeout=3)
                        )
                    room.clear_restart_state()
                    await _start_game(room, loop)

            # ── SWITCH_GAME ───────────────────────────────────────────────
            elif t == MsgType.SWITCH_GAME:
                if room is None or member is None or member.is_spectator:
                    continue
                if not room.started or not room._game_ended:
                    continue
                if member.player_idx != room.host_player_idx():
                    await _send(ws, {'type': MsgType.ERROR,
                                     'msg': '只有房主可以切换游戏',
                                     'code': ErrorCode.FORBIDDEN})
                    continue
                new_game_id = str(msg.get('game_id', ''))
                games_index = {g['id']: g for g in list_games()}
                if new_game_id not in games_index:
                    await _send(ws, {'type': MsgType.ERROR,
                                     'msg': '未知游戏',
                                     'code': ErrorCode.INVALID_MSG})
                    continue
                ginfo = games_index[new_game_id]
                if not (ginfo['min_players'] <= room.player_count <= ginfo['max_players']):
                    await _send(ws, {'type': MsgType.ERROR,
                                     'msg': (f'当前玩家数 {room.player_count} 不适合游戏'
                                             f' {ginfo["name"]}'
                                             f'（需要 {ginfo["min_players"]}–{ginfo["max_players"]} 人）'),
                                     'code': ErrorCode.INVALID_MSG})
                    continue
                room.game_id = new_game_id
                gt = getattr(room, 'game_thread', None)
                if gt and gt.is_alive():
                    await asyncio.get_event_loop().run_in_executor(
                        None, lambda: gt.join(timeout=3)
                    )
                room.clear_restart_state()
                await _start_game(room, loop)

    except WebSocketDisconnect:
        pass
    finally:
        _ip_connections[client_ip] = max(0, _ip_connections.get(client_ip, 0) - 1)
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
    # 取消旧的 broadcast 循环（restart 场景）
    old_bt = getattr(room, '_broadcast_task', None)
    if old_bt and not old_bt.done():
        old_bt.cancel()
    room._broadcast_task = asyncio.create_task(bridge.broadcast_loop())

    def _run():
        try: game.run()
        except Exception:
            _logger.exception('游戏线程崩溃 room=%s', room.code)
            bridge.log('⚠ 游戏遇到意外错误，请联系管理员', 'warn')

    t = threading.Thread(target=_run, daemon=True)
    room.game_thread = t
    t.start()
    bridge.log('游戏开始！', 'header')
    bridge.broadcast_state()

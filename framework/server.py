"""
framework/server.py — FastAPI 服务器入口。
启动: uvicorn framework.server:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations
import asyncio, json, logging, os, threading, time
from collections import deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from websockets.exceptions import ConnectionClosed

from .core.protocol import MsgType, ErrorCode
from .room import RoomRegistry
from .games import get_game_class, list_games
from .net_bridge import GameStopped, NetBridge
from .db import init_db, close_db
from .blog import blog_router, admin_router
from .blog.pages import router as blog_pages, metadata, page_response, public_base_url

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
RECONNECT_GRACE_SECONDS = float(os.environ.get('ROOM_RECONNECT_GRACE_SECONDS', '30'))
if not 0 <= RECONNECT_GRACE_SECONDS <= 600:
    raise ValueError('ROOM_RECONNECT_GRACE_SECONDS must be between 0 and 600')

if _STATIC.exists():
    app.mount('/static', StaticFiles(directory=str(_STATIC), html=False), name='static')

_DIST = _STATIC / 'dist'
if _DIST.exists():
    app.mount('/assets', StaticFiles(directory=str(_DIST / 'assets')), name='dist_assets')

# ── 生命周期事件 + 博客路由 ────────────────────────────────────────────────────

@app.on_event("startup")
async def _startup():
    public_base_url()
    await init_db()

@app.on_event("shutdown")
async def _shutdown():
    for room in list(_registry._rooms.values()):
        await _close_room(room)
    await close_db()

app.include_router(blog_router)
app.include_router(admin_router)
app.include_router(blog_pages)


@app.get('/favicon.ico', include_in_schema=False)
async def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)


@app.get('/favicon.svg', include_in_schema=False)
async def svg_favicon():
    path = _DIST / 'favicon.svg'
    if not path.is_file():
        raise HTTPException(404, 'Favicon not built')
    return FileResponse(path, media_type='image/svg+xml')


# ── REST API ──────────────────────────────────────────────────────────────────
_WORKSPACE = Path(__file__).resolve().parent.parent.parent

@app.get('/api/games')
async def api_games():
    return list_games()

@app.get('/api/rules/{game_id}')
async def api_rules(game_id: str):
    from fastapi.responses import JSONResponse
    from .games import _GAME_REGISTRY
    entry = _GAME_REGISTRY.get(game_id)
    if not entry or 'rules_file' not in entry:
        return JSONResponse({'error': 'not found'}, status_code=404)
    rules_path = _WORKSPACE / entry['rules_file']
    if not rules_path.is_file():
        return JSONResponse({'error': 'rules file missing'}, status_code=404)
    md = rules_path.read_text(encoding='utf-8')
    return {'game_id': game_id, 'name': entry['name'], 'markdown': md}


# ── 广播工具 ──────────────────────────────────────────────────────────────────

async def _broadcast_room(room):
    """向房间内所有已连接的真人成员广播最新房间状态（含各自 your_idx）。"""
    base = {'type': MsgType.ROOM, **room.to_dict()}
    for m in list(room.members):
        if not m.connected or m.is_ai:
            continue
        try:
            await asyncio.wait_for(m.ws.send_json({
                **base, 'your_idx': m.player_idx if not m.is_spectator else -1,
                'resume_token': m.resume_token,
                'reconnect_grace_seconds': RECONNECT_GRACE_SECONDS,
            }), timeout=10)
        except (OSError, RuntimeError, ConnectionClosed, asyncio.TimeoutError):
            _logger.info('Room broadcast connection lost room=%s', room.code)
            asyncio.create_task(_disconnect_member(room, m, m.ws))


async def _broadcast_raw(room, msg: dict):
    """向房间内所有已连接的真人成员广播任意消息。"""
    for m in list(room.members):
        if not m.connected or m.is_ai:
            continue
        try:
            await asyncio.wait_for(m.ws.send_json(msg), timeout=10)
        except (OSError, RuntimeError, ConnectionClosed, asyncio.TimeoutError):
            _logger.info('Room broadcast connection lost room=%s', room.code)
            asyncio.create_task(_disconnect_member(room, m, m.ws))


def _cancel_countdown(room):
    task = room._countdown_task
    room._countdown_task = None
    if task and task is not asyncio.current_task() and not task.done():
        task.cancel()


async def _close_room(room):
    _registry.remove(room.code)
    _cancel_countdown(room)
    if room._bridge:
        room._bridge.terminate()
    tasks = list(room._disconnect_tasks.values())
    room._disconnect_tasks.clear()
    if room._broadcast_task:
        tasks.append(room._broadcast_task)
    for task in tasks:
        if task is not asyncio.current_task() and not task.done():
            task.cancel()
    await asyncio.gather(
        *(task for task in tasks if task is not asyncio.current_task()),
        return_exceptions=True,
    )
    for member in list(room.members):
        if member.connected and member.is_spectator:
            try:
                await member.ws.send_json({
                    'type': MsgType.ERROR, 'code': 'room_closed', 'msg': '房间已关闭',
                })
                await member.ws.close()
            except (OSError, RuntimeError, ConnectionClosed):
                _logger.info('Spectator disconnected during room cleanup room=%s', room.code)
        member.connected = False
    thread = room.game_thread
    if thread and thread.is_alive():
        await asyncio.to_thread(thread.join, 1)
        if thread.is_alive():
            _logger.warning('Game thread has not stopped after room cleanup room=%s', room.code)


async def _finalize_departure(room, member):
    task = room._disconnect_tasks.pop(member.resume_token, None)
    if task and task is not asyncio.current_task():
        task.cancel()
    try:
        if room._bridge and not member.is_spectator:
            room._bridge._handle_disconnect(member)
        else:
            member.disconnect_handled = True
    except Exception:
        _logger.exception('Game disconnect callback failed room=%s', room.code)
    finally:
        room.remove_member(member.ws)
        member.disconnect_handled = True
    if not room.has_humans():
        await _close_room(room)
    else:
        await _broadcast_room(room)


async def _disconnect_member(room, member, ws, *, immediate=False):
    if member.ws is not ws or member.disconnect_handled:
        return
    if not immediate and member.disconnect_deadline is not None:
        return
    _cancel_countdown(room)
    member.connected = False
    member.disconnect_deadline = time.monotonic() + RECONNECT_GRACE_SECONDS
    if not room.started:
        await _broadcast_raw(room, {'type': MsgType.COUNTDOWN, 'seconds': 0})
    if immediate or member.is_spectator or RECONNECT_GRACE_SECONDS == 0:
        await _finalize_departure(room, member)
        return
    async def expire():
        await asyncio.sleep(RECONNECT_GRACE_SECONDS)
        if member.ws is ws and not member.connected:
            await _finalize_departure(room, member)

    room._disconnect_tasks[member.resume_token] = asyncio.create_task(expire())
    await _broadcast_room(room)


# ── 倒计时 ────────────────────────────────────────────────────────────────────

_COUNTDOWN_SECS = 15

async def _start_countdown(room, loop):
    """满员后 15s 倒计时，到 0 时自动开始游戏。"""
    try:
        for remaining in range(_COUNTDOWN_SECS, 0, -1):
            await _broadcast_raw(room, {'type': MsgType.COUNTDOWN, 'seconds': remaining})
            await asyncio.sleep(1)
        if not room.started and room.ready():
            await _start_game(room, loop)
    except asyncio.CancelledError:
        # 被房主手动开始或房间解散取消
        pass


async def _trigger_full(room, loop):
    """当房间满员时触发（或重置）倒计时。"""
    _cancel_countdown(room)
    if room.ready():
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
        await ws.send_json(msg)

    async def err(code, msg_text):
        await send({'type': MsgType.ERROR, 'code': code, 'msg': msg_text})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await err(ErrorCode.INVALID_MSG, 'JSON 解析失败')
                continue
            if not isinstance(data, dict):
                await err(ErrorCode.INVALID_MSG, '消息必须是 JSON 对象')
                continue

            t = data.get('type', '')
            if t in (MsgType.CREATE, MsgType.JOIN, MsgType.RESUME) and member is not None:
                await err(ErrorCode.INVALID_MSG, '请先离开当前房间')
                continue
            if room is not None and member is not None and member.ws is not ws:
                await ws.close(code=4001, reason='连接已恢复到另一页面')
                break

            if t == MsgType.RESUME:
                code = str(data.get('room', '')).upper()[:6]
                token = str(data.get('token', ''))
                candidate = _registry.get(code)
                previous = None
                if candidate and token.isascii() and len(token) <= 128:
                    previous = next((m.ws for m in candidate.members
                                     if m.resume_token == token), None)
                    resumed = candidate.resume_member(token, ws, time.monotonic())
                else:
                    resumed = None
                if resumed is None:
                    await err(ErrorCode.RESUME_EXPIRED, '恢复已过期，请重新进入大厅')
                    continue
                room, member = candidate, resumed
                task = room._disconnect_tasks.pop(member.resume_token, None)
                if task:
                    task.cancel()
                if previous is not None and previous is not ws:
                    try:
                        await previous.close(code=4001, reason='连接已恢复')
                    except (OSError, RuntimeError, ConnectionClosed):
                        _logger.info('Previous connection already closed room=%s', room.code)
                await _broadcast_room(room)
                if room._bridge:
                    await send(room._bridge.state_for(member.player_idx))
                    pending = room._bridge.pending_for(member.player_idx)
                    if pending:
                        await send(pending)
                if room._game_ended:
                    await send({'type': MsgType.GAME_OVER, 'game_id': room.game_id,
                                'result': room.result})
                if not room.started and room.ready():
                    await _trigger_full(room, loop)
                continue

            if t in (MsgType.LEAVE_ROOM, MsgType.LEAVE_GAME):
                if room is not None and member is not None:
                    await _disconnect_member(room, member, ws, immediate=True)
                    room, member = None, None
                await send({'type': 'left_room'})
                continue

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
                if len(pwd.encode()) > 72:
                    await err(ErrorCode.INVALID_MSG, '密码最多 72 字节')
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
                try:
                    room = await asyncio.to_thread(
                        _registry.create, gid, count, pwd, timeout, MAX_ROOMS,
                    )
                except ValueError:
                    await err(ErrorCode.INVALID_MSG, '服务器房间数已达上限')
                    continue
                member = room.add_player(ws, name)
                await _broadcast_room(room)

            # ── JOIN ──────────────────────────────────────────────────────
            elif t == MsgType.JOIN:
                code     = str(data.get('room', '')).upper()[:6]
                name     = str(data.get('name', 'Player')).strip()[:20]
                pwd      = str(data.get('password', ''))[:64]
                spectate = bool(data.get('spectate', False))
                if not name:
                    await err(ErrorCode.INVALID_MSG, '玩家名不能为空')
                    continue

                candidate = _registry.get(code)
                if candidate is None:
                    await err(ErrorCode.ROOM_NOT_FOUND, f'房间 {code} 不存在')
                    continue
                if len(pwd.encode()) > 72:
                    await err(ErrorCode.INVALID_MSG, '密码最多 72 字节')
                    continue
                if not await asyncio.to_thread(candidate.check_password, pwd):
                    await err(ErrorCode.WRONG_PASSWORD, '密码错误')
                    continue
                if _registry.get(code) is not candidate:
                    await err(ErrorCode.ROOM_NOT_FOUND, '房间已关闭')
                    continue
                if not spectate and candidate.is_full():
                    await err(ErrorCode.ROOM_FULL, '房间已满')
                    continue
                if not spectate and (candidate.started or candidate.starting):
                    await err(ErrorCode.GAME_STARTED, '游戏已开始')
                    continue

                room = candidate
                member   = room.add_spectator(ws, name) if spectate else room.add_player(ws, name)
                # 广播给全房间
                await _broadcast_room(room)
                if spectate and room._bridge:
                    await send(room._bridge.state_for(-1))
                    if room._game_ended:
                        await send({'type': MsgType.GAME_OVER, 'game_id': room.game_id,
                                    'result': room.result})
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
                if room.started or room.starting:
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
                if room.started or room.starting:
                    continue
                # 取消倒计时后立即开始
                _cancel_countdown(room)
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
                if room.started or room.starting:
                    continue
                new_gid = str(data.get('game_id', ''))[:32]
                ginfo_map = {g['id']: g for g in list_games()}
                if new_gid not in ginfo_map:
                    await err(ErrorCode.INVALID_MSG, '未知游戏')
                    continue
                gi = ginfo_map[new_gid]
                # 先确定新人数：客户端发来的 player_count 优先，否则沿用当前值
                # 若当前值不在新游戏范围内则自动夹到边界
                try:
                    req_count = int(data.get('player_count', room.player_count))
                except (ValueError, TypeError):
                    req_count = room.player_count
                new_count = max(gi['min_players'],
                                min(gi['max_players'], req_count))
                new_count = max(new_count, len(room.players))  # 不低于已有玩家数
                if new_count > gi['max_players']:
                    await err(ErrorCode.INVALID_MSG,
                              f'当前玩家数 {len(room.players)} 超过游戏 {gi["name"]}'
                              f' 上限 {gi["max_players"]} 人')
                    continue
                room.game_id = new_gid
                room.player_count = new_count
                _cancel_countdown(room)
                await _broadcast_raw(room, {'type': MsgType.COUNTDOWN, 'seconds': 0})
                await _broadcast_room(room)
                if room.ready():
                    await _trigger_full(room, loop)

            # ── RESPONSE ──────────────────────────────────────────────────
            elif t == MsgType.RESPONSE:
                if room is None or member is None:
                    await err(ErrorCode.INVALID_MSG, '尚未加入房间'); continue
                if member.is_spectator:
                    continue
                bridge = getattr(room, '_bridge', None)
                accepted = bool(bridge and bridge.receive_response(
                    member.player_idx, data.get('kind', ''), data.get('value'),
                    data.get('request_id', ''),
                ))
                await send({
                    'type': MsgType.RESPONSE_ACK, 'request_id': data.get('request_id', ''),
                    'accepted': accepted, 'msg': '' if accepted else '操作已过期，请等待最新状态',
                })

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
                    await _start_game(room, loop)

            # ── RETURN_ROOM ───────────────────────────────────────────────
            elif t == MsgType.RETURN_ROOM:
                if room is None or member is None or member.is_spectator:
                    continue
                if not room.started or not room._game_ended:
                    continue
                # 取消广播循环
                old_bt = getattr(room, '_broadcast_task', None)
                if old_bt and not old_bt.done():
                    old_bt.cancel()
                room._broadcast_task = None
                room.started = False
                if room._bridge:
                    room._bridge.terminate()
                room._bridge = None
                room.clear_ai_players()
                room.clear_restart_state()
                await _broadcast_room(room)

            # ── SWITCH_GAME ───────────────────────────────────────────────
            elif t == MsgType.SWITCH_GAME:
                if room is None or member is None or member.is_spectator:
                    continue
                if not room.started or not room._game_ended:
                    continue
                if member.player_idx != room.host_player_idx():
                    await send({'type': MsgType.ERROR,
                                     'msg': '只有房主可以切换游戏',
                                     'code': ErrorCode.FORBIDDEN})
                    continue
                new_game_id = str(data.get('game_id', ''))
                games_index = {g['id']: g for g in list_games()}
                if new_game_id not in games_index:
                    await send({'type': MsgType.ERROR,
                                     'msg': '未知游戏',
                                     'code': ErrorCode.INVALID_MSG})
                    continue
                ginfo = games_index[new_game_id]
                room.clear_ai_players()
                human_count = len(room.players)
                if human_count > ginfo['max_players']:
                    await send({'type': MsgType.ERROR,
                                     'msg': (f'当前真人玩家数 {human_count} 超过游戏'
                                             f' {ginfo["name"]}'
                                             f' 上限 {ginfo["max_players"]} 人'),
                                     'code': ErrorCode.INVALID_MSG})
                    continue
                room.game_id = new_game_id
                room.player_count = max(ginfo['min_players'], human_count)
                gt = getattr(room, 'game_thread', None)
                if gt and gt.is_alive():
                    await asyncio.get_event_loop().run_in_executor(
                        None, lambda: gt.join(timeout=3)
                    )
                await _start_game(room, loop)

            else:
                await err(ErrorCode.INVALID_MSG, '未知消息类型')

    except (WebSocketDisconnect, OSError, ConnectionClosed):
        _logger.info('WebSocket connection closed')
    finally:
        _ip_connections[client_ip] = max(0, _ip_connections.get(client_ip, 0) - 1)
        if not _ip_connections[client_ip]:
            _ip_connections.pop(client_ip, None)
        if room and member:
            await _disconnect_member(room, member, ws)


async def _start_game(room, loop):
    if room.starting or (room.started and not room._game_ended):
        return False
    if any(not m.connected and not m.is_ai and not m.disconnect_handled for m in room.players):
        await _broadcast_raw(room, {
            'type': MsgType.ERROR, 'code': 'player_reconnecting',
            'msg': '有玩家正在重连，请稍后开始',
        })
        return False
    old_thread = room.game_thread
    if old_thread and old_thread.is_alive():
        await asyncio.to_thread(old_thread.join, 3)
        if old_thread.is_alive():
            await _broadcast_raw(room, {
                'type': MsgType.ERROR, 'code': 'game_busy', 'msg': '上一局尚未结束，请稍后重试',
            })
            return False
    room.starting = True
    _cancel_countdown(room)
    bridge = NetBridge(
        room, loop, on_disconnect=lambda member: _disconnect_member(room, member, member.ws),
    )
    try:
        game_cls = get_game_class(room.game_id)
        game = game_cls()
        bridge.set_game(game)
        game.bridge = bridge
        original_players = list(room.players)
        names = [m.name for m in room.players]
        flags = [not m.is_ai and not m.disconnect_handled for m in room.players]
        while len(names) < room.player_count:
            names.append(f'AI-{len(names) + 1}')
            flags.append(False)
        await asyncio.to_thread(game.setup, names, flags)
        if room.players != original_players or any(
                not m.connected and not m.is_ai for m in original_players):
            raise RuntimeError('Room membership changed during game initialization')
        for member in room.members:
            if member.connected and not member.is_ai:
                bridge.state_for(member.player_idx)
        if _registry.get(room.code) is not room:
            bridge.terminate()
            return False
    except Exception:
        bridge.terminate()
        _logger.exception('Game initialization failed room=%s', room.code)
        await _broadcast_raw(room, {
            'type': MsgType.ERROR, 'code': 'game_start_failed',
            'msg': '游戏初始化失败，请联系管理员或切换游戏',
        })
        return False
    finally:
        room.starting = False

    old_bridge = room._bridge
    if old_bridge:
        old_bridge.terminate()
    old_task = room._broadcast_task
    if old_task and not old_task.done():
        old_task.cancel()
        await asyncio.gather(old_task, return_exceptions=True)
    room._bridge = bridge
    while len(room.players) < room.player_count:
        room.add_ai()
    room.started = True
    room.clear_restart_state()
    room._broadcast_task = asyncio.create_task(bridge.broadcast_loop())
    await _broadcast_room(room)
    bridge.log('游戏开始！', 'header')
    bridge.broadcast_state()

    def run():
        try:
            game.run()
            if not room._game_ended and not bridge._terminated:
                bridge.broadcast_game_over({})
        except GameStopped:
            return
        except Exception:
            _logger.exception('游戏线程崩溃 room=%s', room.code)
            if not bridge._terminated:
                bridge.broadcast_game_over({'error': '游戏发生错误，请返回等待室重试'})

    room.game_thread = threading.Thread(target=run, daemon=True)
    room.game_thread.start()
    return True


# ── SPA catch-all (must be last) ─────────────────────────────────────────────

@app.api_route('/{path:path}', methods=['GET'], include_in_schema=False)
async def spa_fallback(path: str):
    """Fallback: serve Vue SPA index.html for client-side routes."""
    # Skip API and WebSocket paths
    if path.startswith(('api/', 'ws', 'static/', 'assets/')):
        from fastapi.responses import JSONResponse
        return JSONResponse({'error': 'not found'}, status_code=404)
    return page_response(metadata(
        title="游戏大厅 | Dy's Blog" if path == 'game' else "Dy's Game Room",
        path='/' + path, noindex=True,
    ))

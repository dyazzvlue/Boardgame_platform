from __future__ import annotations
import asyncio, threading
from typing import Any, TYPE_CHECKING
from .core.base_bridge import AbstractBridge
from .core.protocol import MsgType
if TYPE_CHECKING:
    from .room import Room

class NetBridge(AbstractBridge):
    def __init__(self, room: 'Room', loop: asyncio.AbstractEventLoop):
        self._room = room
        self._loop = loop
        self._game = None
        self._pending_player_idx = -1
        self._pending_kind = ''
        self._response_event = threading.Event()
        self._response_value = None
        self._ask_lock = threading.Lock()
        self._broadcast_q: asyncio.Queue = asyncio.Queue()
        self._terminated = False

    def set_game(self, game):
        self._game = game

    # ── AbstractBridge ────────────────────────────────────────────────────

    def ask(self, player_idx: int, kind: str, data: dict) -> Any:
        if self._terminated:
            return None
        member = self._room.get_player_by_idx(player_idx)
        if member is None or not member.connected or member.is_ai:
            return None
        with self._ask_lock:
            if self._terminated:
                return None
            self._pending_player_idx = player_idx
            self._pending_kind = kind
            self._response_event.clear()
            self._response_value = None
            timeout = self._room.turn_timeout if self._room.turn_timeout > 0 else None
            self._schedule({'type': MsgType.REQUEST, 'player_idx': player_idx,
                            'kind': kind, 'data': data,
                            'turn_timeout': self._room.turn_timeout})
            timed_out = not self._response_event.wait(timeout=timeout)
            if timed_out and self._response_value is None:
                self.log(f'⏱ {member.name} 操作超时，自动跳过', 'warn')
            self._pending_player_idx = -1
            self._pending_kind = ''
            return self._response_value

    def receive_response(self, player_idx: int, kind: str, value: Any):
        if player_idx == self._pending_player_idx and kind == self._pending_kind:
            self._response_value = value
            self._response_event.set()

    def log(self, text: str, style: str = 'normal'):
        self._schedule({'type': MsgType.LOG, 'text': text, 'style': style})

    def broadcast_state(self):
        if self._game is None:
            return
        self._schedule({'type': MsgType.STATE, 'game_id': self._room.game_id,
                        'context': self._game.get_state()})

    def broadcast_game_over(self, result: dict):
        self._schedule({'type': MsgType.GAME_OVER, 'game_id': self._room.game_id,
                        'result': result})

    def handle_leave(self, player_idx: int):
        """玩家主动离开游戏，其位置由 AI 接管。"""
        member = self._room.get_player_by_idx(player_idx)
        if member is None or member.is_spectator:
            return
        if not member.connected:
            return
        member.connected = False
        if self._game is not None:
            self._game.on_player_disconnected(player_idx)
        self.log(f'🚪 {member.name} 离开游戏，由 AI 接管', 'warn')
        self._schedule({'type': MsgType.ROOM, **self._room.to_dict()})
        # 若当前正在等待该玩家响应，立即解除阻塞
        if self._pending_player_idx == player_idx:
            self._response_event.set()
        self._check_terminate_if_all_ai()

    # ── Internal ──────────────────────────────────────────────────────────

    def _check_terminate_if_all_ai(self):
        """若房间内已无在线人类玩家，自动终止游戏。"""
        humans = [m for m in self._room.players if not m.is_ai and m.connected]
        if not humans:
            self._terminated = True
            self.log('所有人类玩家已离线，游戏自动结束', 'warn')
            self._response_event.set()  # 解除任何挂起的 ask()

    def _schedule(self, msg: dict):
        asyncio.run_coroutine_threadsafe(self._broadcast_q.put(msg), self._loop)

    async def broadcast_loop(self):
        while True:
            msg = await self._broadcast_q.get()
            for member in list(self._room.members):
                # 跳过 AI 占位（无 WS）和已断线成员
                if not member.connected or member.is_ai:
                    continue
                try:
                    await member.ws.send_json(msg)
                except Exception:
                    self._handle_disconnect(member)

    def _handle_disconnect(self, member):
        if not member.connected:
            return  # 防止重复处理
        member.connected = False
        if not member.is_spectator and self._game is not None:
            self._game.on_player_disconnected(member.player_idx)
        tag = '' if member.is_spectator else '，由 AI 接管'
        self.log(f'⚠ {member.name} 已断线{tag}', 'warn')
        self._schedule({'type': MsgType.ROOM, **self._room.to_dict()})
        if not member.is_spectator:
            if self._pending_player_idx == member.player_idx:
                self._response_event.set()
            self._check_terminate_if_all_ai()

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

    def set_game(self, game):
        self._game = game

    # ── AbstractBridge ────────────────────────────────────────────────────

    def ask(self, player_idx: int, kind: str, data: dict) -> Any:
        member = self._room.get_player_by_idx(player_idx)
        if member is None or not member.connected:
            return None
        with self._ask_lock:
            self._pending_player_idx = player_idx
            self._pending_kind = kind
            self._response_event.clear()
            self._response_value = None
            self._schedule({'type': MsgType.REQUEST, 'player_idx': player_idx,
                            'kind': kind, 'data': data})
            self._response_event.wait()
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

    # ── Internal ──────────────────────────────────────────────────────────

    def _schedule(self, msg: dict):
        asyncio.run_coroutine_threadsafe(self._broadcast_q.put(msg), self._loop)

    async def broadcast_loop(self):
        while True:
            msg = await self._broadcast_q.get()
            for member in list(self._room.members):
                if not member.connected:
                    continue
                try:
                    await member.ws.send_json(msg)
                except Exception:
                    self._handle_disconnect(member)

    def _handle_disconnect(self, member):
        member.connected = False
        if not member.is_spectator and self._game is not None:
            self._game.on_player_disconnected(member.player_idx)
        tag = '' if member.is_spectator else '，由 AI 接管'
        self.log(f'⚠ {member.name} 已断线{tag}', 'warn')
        self._schedule({'type': MsgType.ROOM, **self._room.to_dict()})

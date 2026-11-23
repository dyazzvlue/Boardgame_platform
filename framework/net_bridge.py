from __future__ import annotations

import asyncio
import copy
import logging
import threading
import time
import uuid
from typing import Any, TYPE_CHECKING

from websockets.exceptions import ConnectionClosed

from .core.base_bridge import AbstractBridge
from .core.protocol import MsgType

if TYPE_CHECKING:
    from .room import Room

_logger = logging.getLogger(__name__)


class GameStopped(Exception):
    """Cooperative cancellation of a room's game thread."""


class NetBridge(AbstractBridge):
    def __init__(self, room: 'Room', loop: asyncio.AbstractEventLoop, on_disconnect=None):
        self._room = room
        self._loop = loop
        self._game = None
        self._pending_player_idx = -1
        self._pending_kind = ''
        self._pending_request = None
        self._last_response = None
        self._response_event = threading.Event()
        self._response_value = None
        self._ask_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._broadcast_q: asyncio.Queue = asyncio.Queue()
        self._terminated = False
        self._on_disconnect = on_disconnect

    def set_game(self, game):
        self._game = game

    def ask(self, player_idx: int, kind: str, data: dict) -> Any:
        if self._terminated:
            raise GameStopped()
        member = self._room.get_player_by_idx(player_idx)
        if member is None or member.disconnect_handled or member.is_ai:
            return None
        with self._ask_lock:
            if self._terminated:
                raise GameStopped()
            timeout = self._room.turn_timeout or None
            with self._state_lock:
                self._pending_player_idx = player_idx
                self._pending_kind = kind
                self._response_event.clear()
                self._response_value = None
                self._pending_request = {
                    'type': MsgType.REQUEST, 'request_id': uuid.uuid4().hex,
                    'player_idx': player_idx, 'kind': kind, 'data': copy.deepcopy(data),
                    'turn_timeout': self._room.turn_timeout,
                    'expires_at': time.time() + timeout if timeout else None,
                }
                request = self._pending_request.copy()
            self._schedule(request)
            timed_out = not self._response_event.wait(timeout=timeout)
            with self._state_lock:
                value = self._response_value
                self._pending_player_idx = -1
                self._pending_kind = ''
                self._pending_request = None
            if self._terminated:
                raise GameStopped()
            if timed_out:
                self.log(f'⏱ {member.name} 操作超时，自动跳过', 'warn')
            return value

    def receive_response(self, player_idx: int, kind: str, value: Any, request_id: str) -> bool:
        with self._state_lock:
            key = (player_idx, kind, request_id)
            if self._last_response == key:
                return True
            if (self._terminated or not self._pending_request or not request_id
                    or player_idx != self._pending_player_idx or kind != self._pending_kind
                    or request_id != self._pending_request['request_id']
                    or self._response_event.is_set()):
                return False
            expires = self._pending_request['expires_at']
            if expires is not None and time.time() >= expires:
                return False
            self._response_value = value
            self._last_response = key
            self._response_event.set()
            return True

    def pending_for(self, player_idx):
        with self._state_lock:
            if (self._pending_player_idx != player_idx or not self._pending_request
                    or self._response_event.is_set()):
                return None
            expires = self._pending_request['expires_at']
            if expires is not None and time.time() >= expires:
                return None
            return copy.deepcopy(self._pending_request)

    def log(self, text: str, style: str = 'normal'):
        self._schedule({'type': MsgType.LOG, 'text': text, 'style': style})

    def broadcast_state(self):
        if self._game is not None:
            self._schedule_per_player()

    def state_for(self, player_idx):
        return {
            'type': MsgType.STATE, 'game_id': self._room.game_id,
            'context': copy.deepcopy(self._game.get_state_for_player(player_idx)),
        }

    def _schedule_per_player(self):
        for member in list(self._room.members):
            if member.connected and not member.is_ai:
                self._schedule(self.state_for(member.player_idx), member)

    def broadcast_game_over(self, result: dict):
        if self._terminated:
            raise GameStopped()
        self._room.result = copy.deepcopy(result)
        self._room._game_ended = True
        self._schedule({'type': MsgType.GAME_OVER, 'game_id': self._room.game_id,
                        'result': self._room.result})

    def handle_leave(self, player_idx: int):
        member = self._room.get_player_by_idx(player_idx)
        if member is not None:
            self._handle_disconnect(member)

    def _handle_disconnect(self, member):
        if member.disconnect_handled:
            return
        member.disconnect_handled = True
        member.connected = False
        member.disconnect_deadline = None
        try:
            if not member.is_spectator and self._game is not None:
                self._game.on_player_disconnected(member.player_idx)
        finally:
            if self._pending_player_idx == member.player_idx:
                self._response_event.set()
        if not self._terminated:
            self.log(f'⚠ {member.name} 已离线，由 AI 接管', 'warn')
        self._check_terminate_if_all_ai()

    def _check_terminate_if_all_ai(self):
        if not self._room.has_humans():
            self.terminate()

    def terminate(self):
        self._terminated = True
        self._response_event.set()

    def _schedule(self, msg: dict, member=None):
        if self._terminated or self._loop.is_closed():
            raise GameStopped()
        future = asyncio.run_coroutine_threadsafe(self._broadcast_q.put((msg, member)), self._loop)
        future.add_done_callback(self._scheduled)

    @staticmethod
    def _scheduled(future):
        if not future.cancelled():
            error = future.exception()
            if error is not None:
                _logger.error('Unable to queue game message',
                              exc_info=(type(error), error, error.__traceback__))

    async def broadcast_loop(self):
        while True:
            msg, target = await self._broadcast_q.get()
            for member in list(self._room.members):
                if (not member.connected or member.is_ai
                        or (target is not None and member is not target)
                        or (msg['type'] == MsgType.REQUEST
                            and (member.is_spectator or member.player_idx != msg['player_idx']))):
                    continue
                try:
                    await asyncio.wait_for(member.ws.send_json(msg), timeout=10)
                except (OSError, RuntimeError, ConnectionClosed, asyncio.TimeoutError):
                    _logger.info('Room connection lost room=%s player=%s',
                                 self._room.code, member.player_idx)
                    if self._on_disconnect is not None:
                        await self._on_disconnect(member)
                    else:
                        self._handle_disconnect(member)

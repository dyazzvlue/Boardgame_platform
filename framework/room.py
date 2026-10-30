from __future__ import annotations

import secrets
import string
import threading
from dataclasses import dataclass, field
from typing import Optional

import bcrypt


def _gen_code(n=6):
    return ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(n))


@dataclass
class RoomMember:
    ws: object
    name: str
    player_idx: int
    is_spectator: bool = False
    connected: bool = True
    is_ai: bool = False
    resume_token: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    disconnect_deadline: float | None = None
    disconnect_handled: bool = False


class Room:
    def __init__(self, code, game_id, player_count, password='', turn_timeout=30):
        self.code = code
        self.game_id = game_id
        self.player_count = player_count
        self._password_hash = (
            bcrypt.hashpw(password.encode(), bcrypt.gensalt()) if password else None
        )
        self.turn_timeout = turn_timeout
        self.members: list[RoomMember] = []
        self.game_thread = None
        self.started = False
        self.starting = False
        self.host_ws = None
        self._countdown_task = None
        self._broadcast_task = None
        self._disconnect_tasks = {}
        self._bridge = None
        self._lock = threading.RLock()
        self._restart_votes: set[int] = set()
        self._game_ended = False
        self.result = None

    def add_player(self, ws, name) -> RoomMember:
        with self._lock:
            m = RoomMember(ws=ws, name=name, player_idx=len(self.players))
            self.members.append(m)
            if self.host_ws is None:
                self.host_ws = ws
            return m

    def add_ai(self) -> Optional[RoomMember]:
        with self._lock:
            if self.is_full():
                return None
            idx = len(self.players)
            m = RoomMember(ws=None, name=f'AI-{idx + 1}', player_idx=idx, is_ai=True)
            self.members.append(m)
            return m

    def add_spectator(self, ws, name) -> RoomMember:
        with self._lock:
            m = RoomMember(ws=ws, name=name, player_idx=-1, is_spectator=True)
            self.members.append(m)
            return m

    def vote_restart(self, player_idx: int) -> bool:
        self._restart_votes.add(player_idx)
        humans = {m.player_idx for m in self.players if not m.is_ai and m.connected}
        return bool(humans) and humans <= self._restart_votes

    def restart_vote_count(self) -> tuple:
        humans = {m.player_idx for m in self.players if not m.is_ai and m.connected}
        return len(self._restart_votes & humans), len(humans)

    def clear_restart_state(self):
        self._restart_votes.clear()
        self._game_ended = False
        self.result = None

    def clear_ai_players(self):
        with self._lock:
            self.members = [
                m for m in self.members
                if m.is_spectator or (not m.is_ai and not m.disconnect_handled)
            ]
            self._reindex()

    def _reindex(self):
        for idx, member in enumerate(self.players):
            member.player_idx = idx
        if not any(m.ws is self.host_ws and not m.disconnect_handled for m in self.players):
            host = next((m for m in self.players if m.connected and not m.is_ai), None)
            self.host_ws = host.ws if host else None

    def check_password(self, pwd: str) -> bool:
        return self._password_hash is None or bcrypt.checkpw(pwd.encode(), self._password_hash)

    def remove_member(self, ws) -> Optional[RoomMember]:
        """Finalize a departure; active games keep their stable player indexes."""
        with self._lock:
            member = self.get_player_by_ws(ws)
            if member is None:
                return None
            member.connected = False
            member.disconnect_deadline = None
            if not self.started or member.is_spectator:
                self.members.remove(member)
                self._reindex()
            elif self.host_ws is ws:
                host = next((m for m in self.players if m.connected and not m.is_ai), None)
                self.host_ws = host.ws if host else None
            return member

    def resume_member(self, token: str, ws, now: float) -> Optional[RoomMember]:
        with self._lock:
            for member in self.members:
                if (member.is_ai or member.disconnect_handled
                        or not secrets.compare_digest(member.resume_token, token)):
                    continue
                if member.disconnect_deadline is not None and now >= member.disconnect_deadline:
                    return None
                old_ws = member.ws
                member.ws = ws
                member.connected = True
                member.disconnect_deadline = None
                if not member.is_spectator and (self.host_ws is old_ws or self.host_ws is None):
                    self.host_ws = ws
                return member
        return None

    @property
    def players(self):
        return [m for m in self.members if not m.is_spectator]

    @property
    def spectators(self):
        return [m for m in self.members if m.is_spectator and m.connected]

    def has_humans(self):
        return any(not m.is_ai and not m.is_spectator and not m.disconnect_handled
                   for m in self.members)

    def is_full(self):
        return len(self.players) >= self.player_count

    def ready(self):
        return self.is_full() and all(m.connected or m.is_ai for m in self.players)

    def get_player_by_ws(self, ws):
        return next((m for m in self.members if m.ws is ws), None)

    def get_player_by_idx(self, idx):
        return next((m for m in self.players if m.player_idx == idx), None)

    def host_player_idx(self) -> int:
        member = next((m for m in self.players if m.ws is self.host_ws), None)
        return member.player_idx if member else -1

    def to_dict(self):
        return {
            'code': self.code,
            'game_id': self.game_id,
            'player_count': self.player_count,
            'host_idx': self.host_player_idx(),
            'players': [
                {'name': m.name, 'idx': m.player_idx, 'connected': m.connected,
                 'is_ai': m.is_ai or m.disconnect_handled,
                 'reconnecting': m.disconnect_deadline is not None}
                for m in self.players
            ],
            'spectators': len(self.spectators),
            'started': self.started,
            'turn_timeout': self.turn_timeout,
        }


class RoomRegistry:
    def __init__(self):
        self._rooms: dict[str, Room] = {}
        self._lock = threading.Lock()

    def create(self, game_id, player_count, password='', turn_timeout=30, max_rooms=None) -> Room:
        room = Room('', game_id, player_count, password, turn_timeout)
        with self._lock:
            if max_rooms is not None and len(self._rooms) >= max_rooms:
                raise ValueError('Room limit reached')
            code = _gen_code()
            while code in self._rooms:
                code = _gen_code()
            room.code = code
            self._rooms[code] = room
        return room

    def get(self, code) -> Optional[Room]:
        return self._rooms.get(code.upper())

    def remove(self, code):
        with self._lock:
            return self._rooms.pop(code.upper(), None)

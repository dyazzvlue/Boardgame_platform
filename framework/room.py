from __future__ import annotations
import random, string, threading
from dataclasses import dataclass
from typing import Optional, TYPE_CHECKING
if TYPE_CHECKING:
    from starlette.websockets import WebSocket

def _gen_code(n=6):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=n))

@dataclass
class RoomMember:
    ws: object
    name: str
    player_idx: int
    is_spectator: bool = False
    connected: bool = True

class Room:
    def __init__(self, code, game_id, player_count, password=''):
        self.code = code
        self.game_id = game_id
        self.player_count = player_count
        self.password = password
        self.members: list[RoomMember] = []
        self.game_thread = None
        self.started = False
        self._lock = threading.Lock()

    def add_player(self, ws, name) -> RoomMember:
        with self._lock:
            idx = len([m for m in self.members if not m.is_spectator])
            m = RoomMember(ws=ws, name=name, player_idx=idx)
            self.members.append(m)
        return m

    def add_spectator(self, ws, name) -> RoomMember:
        with self._lock:
            m = RoomMember(ws=ws, name=name, player_idx=-1, is_spectator=True)
            self.members.append(m)
        return m

    def remove_member(self, ws) -> Optional[RoomMember]:
        with self._lock:
            for m in self.members:
                if m.ws is ws:
                    m.connected = False
                    return m
        return None

    @property
    def players(self):
        return [m for m in self.members if not m.is_spectator]

    @property
    def spectators(self):
        return [m for m in self.members if m.is_spectator]

    def is_full(self):
        return len(self.players) >= self.player_count

    def get_player_by_ws(self, ws):
        return next((m for m in self.members if m.ws is ws), None)

    def get_player_by_idx(self, idx):
        return next((m for m in self.players if m.player_idx == idx), None)

    def to_dict(self):
        return {
            'code': self.code,
            'game_id': self.game_id,
            'player_count': self.player_count,
            'players': [{'name': m.name, 'idx': m.player_idx, 'connected': m.connected}
                        for m in self.players],
            'spectators': len(self.spectators),
            'started': self.started,
        }

class RoomRegistry:
    def __init__(self):
        self._rooms = {}
        self._lock = threading.Lock()

    def create(self, game_id, player_count, password='') -> Room:
        with self._lock:
            while True:
                code = _gen_code()
                if code not in self._rooms:
                    break
            room = Room(code=code, game_id=game_id,
                        player_count=player_count, password=password)
            self._rooms[code] = room
        return room

    def get(self, code) -> Optional[Room]:
        return self._rooms.get(code.upper())

    def remove(self, code):
        with self._lock:
            self._rooms.pop(code.upper(), None)

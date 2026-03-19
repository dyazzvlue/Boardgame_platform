from __future__ import annotations
import random, string, threading
from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING
if TYPE_CHECKING:
    from starlette.websockets import WebSocket

def _gen_code(n=6):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=n))

@dataclass
class RoomMember:
    ws: object           # None for AI members
    name: str
    player_idx: int
    is_spectator: bool = False
    connected: bool = True
    is_ai: bool = False  # True = AI 玩家，无 WS 连接

class Room:
    def __init__(self, code, game_id, player_count, password='', turn_timeout=30):
        self.code = code
        self.game_id = game_id
        self.player_count = player_count
        self.password = password
        self.turn_timeout = turn_timeout  # 0 = 不限制
        self.members: list[RoomMember] = []
        self.game_thread = None
        self.started = False
        self.host_ws = None            # 房主 WebSocket
        self._countdown_task = None    # 满员自动开始的倒计时 asyncio.Task
        self._lock = threading.Lock()

    def add_player(self, ws, name) -> RoomMember:
        with self._lock:
            idx = len([m for m in self.members if not m.is_spectator])
            m = RoomMember(ws=ws, name=name, player_idx=idx)
            self.members.append(m)
            if self.host_ws is None:
                self.host_ws = ws   # 第一个加入的真人玩家为房主
        return m

    def add_ai(self) -> Optional[RoomMember]:
        """房主添加一个 AI 占位（无 WS），返回 None 表示房间已满。"""
        with self._lock:
            idx = len([m for m in self.members if not m.is_spectator])
            if idx >= self.player_count:
                return None
            m = RoomMember(ws=None, name=f'AI-{idx + 1}', player_idx=idx, is_ai=True)
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

    def host_player_idx(self) -> int:
        """返回房主的 player_idx（-1 表示房主已离线）。"""
        m = next((p for p in self.players if p.ws is self.host_ws), None)
        return m.player_idx if m else -1

    def to_dict(self):
        return {
            'code': self.code,
            'game_id': self.game_id,
            'player_count': self.player_count,
            'host_idx': self.host_player_idx(),
            'players': [
                {'name': m.name, 'idx': m.player_idx,
                 'connected': m.connected, 'is_ai': m.is_ai}
                for m in self.players
            ],
            'spectators': len(self.spectators),
            'started': self.started,
            'turn_timeout': self.turn_timeout,
        }

class RoomRegistry:
    def __init__(self):
        self._rooms = {}
        self._lock = threading.Lock()

    def create(self, game_id, player_count, password='', turn_timeout=30) -> Room:
        with self._lock:
            while True:
                code = _gen_code()
                if code not in self._rooms:
                    break
            room = Room(code=code, game_id=game_id,
                        player_count=player_count, password=password,
                        turn_timeout=turn_timeout)
            self._rooms[code] = room
        return room

    def get(self, code) -> Optional[Room]:
        return self._rooms.get(code.upper())

    def remove(self, code):
        with self._lock:
            self._rooms.pop(code.upper(), None)

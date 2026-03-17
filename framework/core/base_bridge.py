from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any

class AbstractBridge(ABC):
    @abstractmethod
    def ask(self, player_idx: int, kind: str, data: dict) -> Any:
        """向 player_idx 发操作请求，阻塞直到收到响应（断线则返回 None）。"""

    @abstractmethod
    def log(self, text: str, style: str = "normal") -> None:
        """追加日志并广播给全房间。"""

    @abstractmethod
    def broadcast_state(self) -> None:
        """调用 game.get_state()，以 STATE 消息广播。"""

    @abstractmethod
    def broadcast_game_over(self, result: dict) -> None:
        """广播 GAME_OVER 消息。"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, TYPE_CHECKING
if TYPE_CHECKING:
    from .base_bridge import AbstractBridge

class AbstractGame(ABC):
    GAME_ID: str = ""
    GAME_NAME: str = ""
    MIN_PLAYERS: int = 2
    MAX_PLAYERS: int = 6
    COVER_IMAGE: str = ""

    bridge: "AbstractBridge" = None  # injected by server before run()

    @abstractmethod
    def setup(self, player_names: list, human_flags: list) -> None:
        """初始化，player_names[i] / human_flags[i] 一一对应。"""

    @abstractmethod
    def run(self) -> None:
        """游戏主循环，在独立线程中同步执行。"""

    @abstractmethod
    def get_state(self) -> dict:
        """返回完整游戏状态（JSON 可序列化 dict）。"""

    @abstractmethod
    def on_player_disconnected(self, player_idx: int) -> None:
        """玩家断线时由框架调用，通常切换为 AI。"""

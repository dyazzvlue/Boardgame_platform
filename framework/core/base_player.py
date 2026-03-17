from __future__ import annotations
from dataclasses import dataclass

@dataclass
class AbstractPlayer:
    name: str
    player_idx: int
    is_human: bool = True
    is_spectator: bool = False
    connected: bool = True

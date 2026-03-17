from __future__ import annotations
import importlib
from typing import Type, TYPE_CHECKING
if TYPE_CHECKING:
    from ..core.base_game import AbstractGame

_GAME_MODULES: dict[str, str] = {
    'manila': 'framework.games.manila.plugin',
}
_cache: dict[str, type] = {}

def get_game_class(game_id: str):
    if game_id not in _cache:
        mp = _GAME_MODULES.get(game_id)
        if mp is None:
            raise ValueError(f'未知游戏 ID: {game_id!r}')
        mod = importlib.import_module(mp)
        _cache[game_id] = mod.GAME_CLASS
    return _cache[game_id]

def list_games() -> list:
    result = []
    for gid in _GAME_MODULES:
        try:
            cls = get_game_class(gid)
            result.append({'id': cls.GAME_ID, 'name': cls.GAME_NAME,
                           'min_players': cls.MIN_PLAYERS,
                           'max_players': cls.MAX_PLAYERS,
                           'cover': cls.COVER_IMAGE})
        except Exception as e:
            result.append({'id': gid, 'name': gid, 'error': str(e)})
    return result

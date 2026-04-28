from __future__ import annotations
import importlib
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from ..core.base_game import AbstractGame

_GAME_REGISTRY: dict[str, dict] = {
    'manila': {
        'module': 'framework.games.manila.plugin',
        'name': '马尼拉',
        'min_players': 3,
        'max_players': 5,
        'cover': 'manila_cover.png',
        'rules_file': 'Manila/rules.md',
    },
    'avalon': {
        'module': 'framework.games.avalon.plugin',
        'name': '阿瓦隆',
        'min_players': 5,
        'max_players': 10,
        'cover': '',
        'rules_file': 'Avalon/rules.md',
    },
    'incan_gold': {
        'module': 'framework.games.incan_gold.plugin',
        'name': '印加宝藏',
        'min_players': 3,
        'max_players': 8,
        'cover': '',
        'rules_file': 'IncanGold/rules.md',
    },
    'transcard': {
        'module': 'framework.games.transcard.plugin',
        'name': '转牌',
        'min_players': 3,
        'max_players': 6,
        'cover': '',
        'rules_file': 'TransCard/rule.md',
    },
}
_cache: dict[str, type] = {}


def get_game_class(game_id: str):
    if game_id not in _cache:
        entry = _GAME_REGISTRY.get(game_id)
        if entry is None:
            raise ValueError(f'未知游戏 ID: {game_id!r}')
        mod = importlib.import_module(entry['module'])
        _cache[game_id] = mod.GAME_CLASS
    return _cache[game_id]


def list_games() -> list:
    return [
        {
            'id': gid,
            'name': info['name'],
            'min_players': info['min_players'],
            'max_players': info['max_players'],
            'cover': info['cover'],
        }
        for gid, info in _GAME_REGISTRY.items()
    ]

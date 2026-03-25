import os
import sys

_INCAN_PATH = os.environ.get(
    "INCANGOLD_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "IncanGold"),
)
_real = os.path.realpath(_INCAN_PATH)
if _real not in sys.path:
    sys.path.insert(0, _real)

from online.adapter import IncanGoldGame  # noqa: E402

GAME_CLASS = IncanGoldGame

"""GuanDan plugin."""
from ..loader import load_adapter

GAME_CLASS = load_adapter("guandan", "GuanDan", "GUANDAN_PATH", "GuandanGame")

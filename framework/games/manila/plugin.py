"""Manila plugin."""
from ..loader import load_adapter

GAME_CLASS = load_adapter("manila", "Manila", "MANILA_PATH", "ManilaGame")

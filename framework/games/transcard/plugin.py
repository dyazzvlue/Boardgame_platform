"""TransCard plugin."""
from ..loader import load_adapter

GAME_CLASS = load_adapter("transcard", "TransCard", "TRANSCARD_PATH", "TransCardGame")

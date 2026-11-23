"""Avalon plugin."""
from ..loader import load_adapter

GAME_CLASS = load_adapter("avalon", "Avalon", "AVALON_PATH", "AvalonGameAdapter")

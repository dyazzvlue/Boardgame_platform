"""Incan Gold plugin."""
from ..loader import load_adapter

GAME_CLASS = load_adapter("incan_gold", "IncanGold", "INCANGOLD_PATH", "IncanGoldGame")

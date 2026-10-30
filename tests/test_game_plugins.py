"""Plugin contracts using real adapters, without HTTP services or GUI dependencies."""
from __future__ import annotations

import importlib
import ast
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import threading
import unittest

from framework.games import get_game_class, list_games
from framework.net_bridge import GameStopped


class RecordingBridge:
    def __init__(self, barrier=None):
        self.asks = []
        self.logs = []
        self.results = []
        self.barrier = barrier

    def ask(self, player_idx, kind, data):
        self.asks.append((player_idx, kind, threading.current_thread().name))
        if self.barrier is not None:
            self.barrier.wait(timeout=5)
        if kind == "bid":
            return 0
        if kind == "explore_or_return":
            return False
        return None

    def log(self, text, style="normal"):
        self.logs.append((text, style))

    def broadcast_state(self):
        pass

    def broadcast_game_over(self, result):
        self.results.append(result)


class StoppingBridge(RecordingBridge):
    def __init__(self, callback):
        super().__init__()
        self.callback = callback

    def check_stop(self, callback):
        if self.callback == callback:
            raise GameStopped()

    def ask(self, player_idx, kind, data):
        self.check_stop("ask")
        return super().ask(player_idx, kind, data)

    def log(self, text, style="normal"):
        self.check_stop("log")
        super().log(text, style)

    def broadcast_state(self):
        self.check_stop("state")

    def broadcast_game_over(self, result):
        self.check_stop("over")
        super().broadcast_game_over(result)


class GamePluginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.classes = {info["id"]: get_game_class(info["id"]) for info in list_games()}

    def make_game(self, game_id, name="P", bridge=None):
        game = self.classes[game_id]()
        game.bridge = bridge if bridge is not None else RecordingBridge()
        names = [f"{name}{idx}" for idx in range(game.MIN_PLAYERS)]
        game.setup(names, [True] * len(names))
        return game

    def test_import_orders_leave_paths_and_generic_modules_untouched(self):
        script = """
import sys, types
from framework.games import get_game_class
names = ('online', 'constants', 'game', 'player', 'ai', 'ui', 'card', 'rules', 'logger')
sentinels = {name: types.ModuleType(name) for name in names}
sys.modules.update(sentinels)
paths = list(sys.path)
for game_id in sys.argv[1:]:
    cls = get_game_class(game_id)
    assert cls.__module__ == f'boardgame_{game_id}.online.adapter'
    assert get_game_class(game_id) is cls
assert sys.path == paths
assert all(sys.modules[name] is sentinel for name, sentinel in sentinels.items())
"""
        ids = list(self.classes)
        for order in (ids, ids[::-1]):
            with self.subTest(order=order):
                result = subprocess.run(
                    [sys.executable, "-B", "-c", script, *order],
                    cwd=Path(__file__).resolve().parents[1],
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                    capture_output=True, text=True, timeout=15,
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_late_manila_imports_after_all_games_loaded(self):
        game = self.make_game("manila")
        self.assertIsNone(game._shim.ask_buy_stock("P0", game._game.market, 30))
        self.assertIsNone(game._shim.ask_deploy_position(
            "P0", game._game.ships, game._game.board,
            game._game.active_goods, 3,
        ))
        self.assertEqual([ask[1] for ask in game.bridge.asks], ["buy_stock", "deploy"])

    def test_avalon_roles_use_the_engine_enum_and_spectators_are_public(self):
        game = self.make_game("avalon")
        for idx, player in enumerate(game._engine.players):
            view = game.get_state_for_player(idx)
            self.assertEqual(view["my_role"], player.role.value)
            self.assertEqual(view["my_alignment"], player.alignment.value)
            self.assertTrue(view["role_desc"])
        public = game.get_state()
        for idx in (-1, -2, len(game._engine.players), None):
            with self.subTest(viewer=idx):
                self.assertEqual(game.get_state_for_player(idx), public)
                self.assertNotIn("my_role", game.get_state_for_player(idx))
        self.assertTrue(all(player["role"] is None for player in public["players"]))

    def test_every_plugin_has_json_serializable_waiting_and_player_views(self):
        for game_id, cls in self.classes.items():
            with self.subTest(game=game_id):
                waiting = cls()
                json.dumps(waiting.get_state_for_player(-1))
                game = self.make_game(game_id)
                for idx in (-1, 0, game.MIN_PLAYERS - 1, game.MIN_PLAYERS):
                    json.dumps(game.get_state_for_player(idx))

    def test_card_games_filter_hands_at_serialization(self):
        for game_id in ("guandan", "transcard"):
            with self.subTest(game=game_id):
                game = self.make_game(game_id)
                if game_id == "guandan":
                    game.game.deal()
                public = game.get_state()
                self.assertTrue(all("hand" not in p for p in public["players"]))
                for idx in range(game.MIN_PLAYERS):
                    view = game.get_state_for_player(idx)
                    for player in view["players"]:
                        self.assertEqual("hand" in player, player["idx"] == idx)
                for idx in (-1, -2, game.MIN_PLAYERS, None):
                    view = game.get_state_for_player(idx)
                    self.assertTrue(all("hand" not in p for p in view["players"]))
                serializer = importlib.import_module(f"boardgame_{game_id}.online.state")
                engine = game.game if game_id == "guandan" else game._game
                serialize = serializer.serialize if game_id == "guandan" else serializer.serialize_state
                self.assertTrue(all("hand" not in p for p in serialize(engine)["players"]))

    def test_two_rooms_interleave_real_engine_phases_without_cross_routing(self):
        for game_id in ("manila", "incan_gold"):
            with self.subTest(game=game_id):
                barrier = threading.Barrier(2)
                a = self.make_game(game_id, "A", RecordingBridge(barrier))
                b = self.make_game(game_id, "B", RecordingBridge(barrier))
                errors = []

                def run_phases(game):
                    try:
                        for round_num in (1, 2):
                            if game_id == "manila":
                                game._game._bid_harbor_master()
                            else:
                                game._game._play_round(round_num)
                    except BaseException as exc:
                        errors.append(exc)

                threads = [
                    threading.Thread(target=run_phases, args=(game,), name=name, daemon=True)
                    for game, name in ((a, "room-A"), (b, "room-B"))
                ]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(timeout=10)
                self.assertFalse(any(thread.is_alive() for thread in threads))
                self.assertEqual(errors, [])
                for game, owner in ((a, "room-A"), (b, "room-B")):
                    self.assertEqual(len(game.bridge.asks), 6)
                    self.assertEqual([ask[0] for ask in game.bridge.asks], [0, 1, 2] * 2)
                    self.assertEqual({ask[2] for ask in game.bridge.asks}, {owner})
                self.assertIsNot(a._game.ui, b._game.ui)
                a.on_player_disconnected(1)
                self.assertFalse(a._players[1].is_human)
                self.assertTrue(b._players[1].is_human)

    def test_online_execution_does_not_change_stdout_or_global_random(self):
        for game_id in ("manila", "incan_gold", "transcard"):
            with self.subTest(game=game_id):
                stdout = sys.stdout
                state = random.getstate()
                game = self.make_game(game_id)
                if game_id == "manila":
                    game._game.market.is_game_over = lambda: True
                    self.assertIs(game._game.market.random, game._game.random)
                elif game_id == "transcard":
                    game._game.game_over = True
                    self.assertIs(game._game.deck.random, game._game.random)
                game.run()
                self.assertIs(sys.stdout, stdout)
                self.assertEqual(random.getstate(), state)
                self.assertTrue(game.bridge.results)

    def test_manila_ai_and_deal_share_an_instance_random_source(self):
        game = self.classes["manila"]()
        game.bridge = RecordingBridge()
        game.setup(["A0", "A1", "A2"], [False] * 3)
        self.assertTrue(all(player.random is game._game.random for player in game._players))
        game.on_player_disconnected(0)
        self.assertIs(game._players[0].random, game._game.random)

    def test_injected_shims_cover_the_engine_ui_surface(self):
        for game_id in ("manila", "incan_gold"):
            with self.subTest(game=game_id):
                game = self.make_game(game_id)
                module = importlib.import_module(f"boardgame_{game_id}.game")
                tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
                methods = {
                    node.attr for node in ast.walk(tree)
                    if isinstance(node, ast.Attribute)
                    and isinstance(node.value, ast.Attribute)
                    and node.value.attr == "ui"
                    and isinstance(node.value.value, ast.Name)
                    and node.value.value.id == "self"
                }
                self.assertTrue(methods)
                self.assertTrue(all(callable(getattr(game._game.ui, name)) for name in methods))

    def test_full_ai_games_finish_without_changing_global_random(self):
        state = random.getstate()
        for game_id in ("manila", "incan_gold", "transcard"):
            with self.subTest(game=game_id):
                game = self.classes[game_id]()
                game.bridge = RecordingBridge()
                if game_id == "manila":
                    game._random.seed(1234)
                game.setup(
                    [f"AI{idx}" for idx in range(game.MIN_PLAYERS)],
                    [False] * game.MIN_PLAYERS,
                )
                game._game.random.seed(1234)
                game.run()
                self.assertEqual(len(game.bridge.results), 1)
                self.assertEqual(random.getstate(), state)

    def test_game_stopped_propagates_through_real_adapter_callbacks(self):
        for game_id in self.classes:
            for callback in ("ask", "log", "state", "over"):
                with self.subTest(game=game_id, callback=callback):
                    game = self.make_game(game_id, bridge=StoppingBridge(callback))
                    action = game.run
                    if callback == "ask":
                        if game_id == "manila":
                            action = game._game._bid_harbor_master
                        elif game_id == "incan_gold":
                            action = game._game._collect_decisions
                        elif game_id == "avalon":
                            action = game._engine._night_phase
                        elif game_id == "guandan":
                            action = lambda: game.game.bridge.ask_play(0, [], None, [])
                    elif callback == "over":
                        if game_id == "manila":
                            game._game.market.is_game_over = lambda: True
                        elif game_id == "transcard":
                            game._game.game_over = True
                        elif game_id == "avalon":
                            action = lambda: game._engine._end_evil_wins("stop test")
                        elif game_id == "guandan":
                            game.game.game_over = True
                            game.game.winner_team = game.game.players[0].team
                    with self.assertRaises(GameStopped):
                        action()

    def test_existing_cli_entry_modules_still_import(self):
        root = Path(__file__).resolve().parents[2]
        repositories = {
            "manila": ("Manila", "MANILA_PATH"),
            "avalon": ("Avalon", "AVALON_PATH"),
            "incan_gold": ("IncanGold", "INCANGOLD_PATH"),
            "transcard": ("TransCard", "TRANSCARD_PATH"),
            "guandan": ("GuanDan", "GUANDAN_PATH"),
        }
        for game_id, (repository, variable) in repositories.items():
            with self.subTest(game=game_id):
                result = subprocess.run(
                    [sys.executable, "-B", "-c", "import main; assert callable(main.main)"],
                    cwd=os.environ.get(variable, str(root / repository)),
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                    capture_output=True, text=True, timeout=15,
                )
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()

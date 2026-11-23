import asyncio
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from websockets.exceptions import ConnectionClosedOK
from websockets.frames import Close

from framework import db, server
from framework.net_bridge import GameStopped, NetBridge
from framework.room import RoomRegistry


class Socket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)

    async def close(self, **kwargs):
        pass


class Game:
    def __init__(self):
        self.disconnected = []

    def on_player_disconnected(self, idx):
        self.disconnected.append(idx)

    def get_state_for_player(self, idx):
        return {'viewer': idx}


class RoomLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.registry_patch = patch.object(server, '_registry', RoomRegistry())
        self.registry_patch.start()
        self.grace_patch = patch.object(server, 'RECONNECT_GRACE_SECONDS', 0.03)
        self.grace_patch.start()
        self.room = server._registry.create('manila', 3, turn_timeout=0)
        self.member = self.room.add_player(Socket(), 'host')

    async def asyncTearDown(self):
        for room in list(server._registry._rooms.values()):
            await server._close_room(room)
        self.grace_patch.stop()
        self.registry_patch.stop()

    async def test_waiting_room_departure_releases_seat_and_transfers_host(self):
        guest = self.room.add_player(Socket(), 'guest')
        await server._disconnect_member(self.room, self.member, self.member.ws, immediate=True)
        self.assertEqual(self.room.players, [guest])
        self.assertEqual(guest.player_idx, 0)
        self.assertEqual(self.room.host_ws, guest.ws)

    async def test_fifty_empty_rooms_are_reclaimed(self):
        for _ in range(50):
            room = server._registry.create('manila', 3)
            member = room.add_player(Socket(), 'host')
            await server._disconnect_member(room, member, member.ws, immediate=True)
        self.assertEqual(list(server._registry._rooms), [self.room.code])

    async def test_grace_preserves_seat_then_resumes_without_ai(self):
        self.room.started = True
        bridge = NetBridge(self.room, asyncio.get_running_loop())
        game = Game()
        bridge.set_game(game)
        self.room._bridge = bridge
        old_socket = self.member.ws
        await server._disconnect_member(self.room, self.member, old_socket)
        self.assertFalse(self.member.connected)
        self.assertEqual(game.disconnected, [])
        replacement = Socket()
        resumed = self.room.resume_member(self.member.resume_token, replacement, time.monotonic())
        self.assertIs(resumed, self.member)
        await asyncio.sleep(0.05)
        await server._disconnect_member(self.room, self.member, old_socket)
        self.assertTrue(self.member.connected)
        self.assertEqual(game.disconnected, [])
        self.assertIs(server._registry.get(self.room.code), self.room)

    async def test_expired_or_invalid_token_cannot_restore_seat(self):
        await server._disconnect_member(self.room, self.member, self.member.ws)
        deadline = self.member.disconnect_deadline
        self.assertIsNone(self.room.resume_member('invalid', Socket(), time.monotonic()))
        self.assertIsNone(self.room.resume_member(self.member.resume_token, Socket(), deadline + 1))
        await asyncio.sleep(0.06)
        self.assertIsNone(server._registry.get(self.room.code))

    async def test_native_websocket_send_failure_enters_grace(self):
        class ClosedSocket(Socket):
            async def send_json(self, message):
                raise ConnectionClosedOK(Close(1000, ''), Close(1000, ''), True)

        self.member.ws = ClosedSocket()
        await server._broadcast_room(self.room)
        await asyncio.sleep(0.005)
        self.assertFalse(self.member.connected)
        self.assertIsNotNone(self.member.disconnect_deadline)
        self.assertFalse(self.member.disconnect_handled)

    async def test_grace_expiry_unblocks_unlimited_request_and_closes_room(self):
        self.room.started = True
        game = Game()
        bridge = NetBridge(self.room, asyncio.get_running_loop())
        bridge.set_game(game)
        self.room._bridge = bridge
        finished = threading.Event()

        def ask():
            try:
                bridge.ask(0, 'choose', {})
            except GameStopped:
                pass
            finally:
                finished.set()

        thread = threading.Thread(target=ask, daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if bridge.pending_for(0):
                    break
                await asyncio.sleep(0.001)
            await server._disconnect_member(self.room, self.member, self.member.ws)
            self.assertFalse(finished.is_set())
            await asyncio.sleep(0.06)
            self.assertTrue(finished.is_set())
            self.assertEqual(game.disconnected, [0])
            self.assertIsNone(server._registry.get(self.room.code))
            bridge._handle_disconnect(self.member)
            self.assertEqual(game.disconnected, [0])
        finally:
            bridge.terminate()
            await asyncio.to_thread(thread.join, 1)

    async def test_request_ids_reject_stale_response_and_ack_duplicates(self):
        bridge = NetBridge(self.room, asyncio.get_running_loop())
        result = []
        thread = threading.Thread(target=lambda: result.append(bridge.ask(0, 'choose', {})),
                                  daemon=True)
        thread.start()
        try:
            for _ in range(100):
                pending = bridge.pending_for(0)
                if pending:
                    break
                await asyncio.sleep(0.001)
            self.assertFalse(bridge.receive_response(0, 'choose', 'wrong', 'stale'))
            self.assertTrue(bridge.receive_response(0, 'choose', 'yes', pending['request_id']))
            self.assertTrue(bridge.receive_response(0, 'choose', 'yes', pending['request_id']))
            await asyncio.to_thread(thread.join, 1)
            self.assertEqual(result, ['yes'])
        finally:
            bridge.terminate()
            await asyncio.to_thread(thread.join, 1)

    async def test_private_request_is_not_broadcast_to_other_players_or_spectators(self):
        guest = self.room.add_player(Socket(), 'guest')
        spectator = self.room.add_spectator(Socket(), 'spectator')
        bridge = NetBridge(self.room, asyncio.get_running_loop())
        task = asyncio.create_task(bridge.broadcast_loop())
        try:
            bridge._schedule({'type': 'request', 'player_idx': 0, 'data': {'private': True}})
            for _ in range(100):
                if self.member.ws.messages:
                    break
                await asyncio.sleep(0.001)
            self.assertEqual(len(self.member.ws.messages), 1)
            self.assertEqual(guest.ws.messages, [])
            self.assertEqual(spectator.ws.messages, [])
        finally:
            bridge.terminate()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_stopped_game_cannot_overwrite_a_restarted_rooms_result(self):
        bridge = NetBridge(self.room, asyncio.get_running_loop())
        bridge.terminate()
        with self.assertRaises(GameStopped):
            bridge.broadcast_game_over({'stale': True})
        self.assertIsNone(self.room.result)
        self.assertFalse(self.room._game_ended)

    async def test_plugin_failure_does_not_publish_started_state(self):
        with patch.object(server, 'get_game_class', side_effect=ImportError('test loader failure')):
            with self.assertLogs('framework.server', level='ERROR'):
                self.assertFalse(await server._start_game(self.room, asyncio.get_running_loop()))
        self.assertFalse(self.room.started)
        self.assertFalse(self.room.starting)
        self.assertIsNone(self.room.game_thread)
        self.assertFalse(any(m.get('started') for m in self.member.ws.messages))
        self.assertEqual(self.member.ws.messages[-1]['code'], 'game_start_failed')

    async def test_setup_failure_does_not_add_ai_or_leave_room_starting(self):
        class BrokenGame(Game):
            def setup(self, names, flags):
                raise ValueError('controlled setup failure')

        with patch.object(server, 'get_game_class', return_value=BrokenGame):
            with self.assertLogs('framework.server', level='ERROR'):
                self.assertFalse(await server._start_game(self.room, asyncio.get_running_loop()))
        self.assertEqual(self.room.players, [self.member])
        self.assertFalse(self.room.started)
        self.assertFalse(self.room.starting)


class WebSocketLifecycleTests(unittest.TestCase):
    @staticmethod
    def receive_type(socket, message_type):
        for _ in range(20):
            message = socket.receive_json()
            if message['type'] == message_type:
                return message
        raise AssertionError(f'Message {message_type!r} not received')

    def test_running_game_restores_pending_request_and_accepts_response(self):
        class InteractiveGame(Game):
            def setup(self, names, flags):
                self.names = names

            def run(self):
                value = self.bridge.ask(0, 'choose', {'choices': ['yes']})
                self.bridge.broadcast_game_over({'answer': value})

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(db, '_DB_PATH', Path(directory) / 'blog.db'), \
                    patch.object(server, '_registry', RoomRegistry()), \
                    patch.object(server, 'get_game_class', return_value=InteractiveGame), \
                    TestClient(server.app) as client:
                with client.websocket_connect('/ws') as first:
                    first.send_json({'type': 'create', 'game': 'manila', 'name': 'host',
                                     'turn_timeout': 0})
                    room = first.receive_json()
                    first.send_json({'type': 'start_game'})
                    pending = self.receive_type(first, 'request')
                with client.websocket_connect('/ws') as second:
                    second.send_json({'type': 'resume', 'room': room['code'],
                                      'token': room['resume_token']})
                    resumed = self.receive_type(second, 'room')
                    self.assertTrue(resumed['started'])
                    state = self.receive_type(second, 'state')
                    self.assertEqual(state['context']['viewer'], 0)
                    replay = self.receive_type(second, 'request')
                    self.assertEqual(replay['request_id'], pending['request_id'])
                    second.send_json({'type': 'response', 'kind': 'choose', 'value': 'yes',
                                      'request_id': replay['request_id']})
                    ack = self.receive_type(second, 'response_ack')
                    self.assertTrue(ack['accepted'])
                    result = self.receive_type(second, 'game_over')
                    self.assertEqual(result['result']['answer'], 'yes')
                    second.send_json({'type': 'return_room'})
                    returned = self.receive_type(second, 'room')
                    self.assertFalse(returned['started'])
                    second.send_json({'type': 'leave_room'})
                    self.assertEqual(self.receive_type(second, 'left_room')['type'], 'left_room')

    def test_create_resume_leave_and_invalid_messages(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(db, '_DB_PATH', Path(directory) / 'blog.db'), \
                    patch.object(server, '_registry', RoomRegistry()), \
                    TestClient(server.app) as client:
                with client.websocket_connect('/ws') as first:
                    first.send_json([])
                    self.assertEqual(first.receive_json()['code'], 'invalid_msg')
                    first.send_json({'type': 'create', 'game': 'manila', 'name': 'host'})
                    room = first.receive_json()
                    self.assertEqual(room['type'], 'room')
                    self.assertTrue(room['resume_token'])
                    self.assertNotIn('resume_token', room['players'][0])
                    first.send_json({'type': 'create', 'game': 'manila'})
                    self.assertEqual(first.receive_json()['code'], 'invalid_msg')
                with client.websocket_connect('/ws') as second:
                    second.send_json({'type': 'resume', 'room': room['code'],
                                      'token': room['resume_token']})
                    resumed = second.receive_json()
                    self.assertEqual(resumed['type'], 'room')
                    self.assertEqual(resumed['your_idx'], room['your_idx'])
                    second.send_json({'type': 'leave_room'})
                    self.assertEqual(second.receive_json()['type'], 'left_room')
                    self.assertIsNone(server._registry.get(room['code']))
                    second.send_json({'type': 'resume', 'room': room['code'],
                                      'token': room['resume_token']})
                    self.assertEqual(second.receive_json()['code'], 'resume_expired')


if __name__ == '__main__':
    unittest.main()

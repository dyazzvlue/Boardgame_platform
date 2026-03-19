class MsgType:
    # Server → Client
    GAME_LIST  = "game_list"
    ROOM       = "room"
    STATE      = "state"
    REQUEST    = "request"
    LOG        = "log"
    ERROR      = "error"
    GAME_OVER  = "game_over"
    PONG       = "pong"
    COUNTDOWN  = "countdown"   # 倒计时（满员自动开始）

    # Client → Server
    LIST       = "list"
    CREATE     = "create"
    JOIN       = "join"
    RESPONSE   = "response"
    PING       = "ping"
    ADD_AI     = "add_ai"      # 房主添加 AI
    START_GAME = "start_game"  # 房主手动开始
    LEAVE_GAME = "leave_game"  # 玩家离开游戏（AI接管）


class ErrorCode:
    WRONG_PASSWORD = "wrong_password"
    ROOM_NOT_FOUND = "room_not_found"
    ROOM_FULL      = "room_full"
    GAME_STARTED   = "game_started"
    INVALID_MSG    = "invalid_msg"
    NOT_YOUR_TURN  = "not_your_turn"
    FORBIDDEN      = "forbidden"

# Communication Protocol

Technical specification for the TCP protocol between the MCP server and the Love2D game.

## Transport

TCP socket on localhost. Default port: **21110** (configurable via `LOVE_MCP_PORT` environment variable or Lua init parameter).

## Message Framing

Each message is length-prefixed:

```
[4 bytes: payload length (big-endian uint32)][N bytes: JSON payload (UTF-8)]
```

Maximum payload size: 4 MB (configurable).

## Message Types

### Request (server to game)

```json
{
  "id": "uuid-v4",
  "type": "request",
  "command": "screenshot",
  "params": { "scale": 1.0 }
}
```

### Response (game to server)

```json
{
  "id": "uuid-v4",
  "type": "response",
  "status": "ok",
  "data": { ... }
}
```

### Error Response

```json
{
  "id": "uuid-v4",
  "type": "response",
  "status": "error",
  "error": { "code": "INVALID_PATH", "message": "..." }
}
```

### Async Event (game to server, unsolicited)

```json
{
  "type": "event",
  "event": "console_output",
  "data": { "level": "error", "text": "...", "timestamp": 1234567890.123 }
}
```

### Heartbeat (bidirectional)

```json
{
  "type": "heartbeat",
  "timestamp": 1234567890.123
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `UNKNOWN_COMMAND` | Unrecognized command name |
| `HANDLER_ERROR` | Command handler threw an exception |
| `RATE_LIMITED` | Too many commands per second |
| `INVALID_PATH` | State path does not exist |
| `NOT_ALLOWED` | Path not in mutable_paths whitelist |
| `SANDBOX_ERROR` | Code execution failed in sandbox |

## Heartbeat Protocol

The MCP server sends a heartbeat every 5 seconds. If the game does not respond within 10 seconds, the server disconnects. The game detects server absence when no heartbeat arrives and returns to a listening state.

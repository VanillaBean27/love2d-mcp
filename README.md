# love2d-mcp

> Let AI agents observe, interact with, and test your Love2D games in real time via the [Model Context Protocol](https://modelcontextprotocol.io/).

**love2d-mcp** connects Claude (or any MCP-compatible client) to a running Love2D game. Take screenshots, inspect game state, execute Lua code, simulate player input, pause/step frames — all through natural language.

## How It Works

```
Claude / MCP Client  <--stdio-->  love2d-mcp server  <--TCP-->  Your Love2D game
```

The MCP server runs as a subprocess of your AI client. Your Love2D game includes a small Lua module that opens a TCP socket. The server bridges MCP tool calls to game commands.

## Quick Start

### 1. Install the MCP server

```bash
npm install -g love2d-mcp
```

Or run directly with npx (no install needed):

```bash
npx love2d-mcp
```

### 2. Add MCP to your Love2D game

Copy the `lua/love_mcp/` folder and `lua/love_mcp.lua` into your game directory, then add two lines to `main.lua`:

```lua
local mcp = require("love_mcp")

function love.load()
    mcp.init()
    -- your existing code ...
end
```

That's it. The module hooks into Love2D's `love.update`, `love.draw`, and `love.quit` callbacks automatically, chaining with any existing callbacks you have defined.

### 3. Connect from Claude

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "love2d": {
      "command": "npx",
      "args": ["-y", "love2d-mcp"]
    }
  }
}
```

#### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "love2d": {
      "command": "npx",
      "args": ["-y", "love2d-mcp"]
    }
  }
}
```

Or configure globally in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "love2d": {
      "command": "npx",
      "args": ["-y", "love2d-mcp"]
    }
  }
}
```

### 4. Run your game and start talking to Claude

```bash
love .
```

Then ask Claude things like:
- "Take a screenshot of the game"
- "What's the player's health?"
- "Press the space key"
- "Move the player right for 2 seconds"
- "Pause the game and step forward 10 frames"

## Available Tools

### Core Observability

| Tool | Description |
|------|-------------|
| `screenshot` | Capture the current game frame as a PNG |
| `get_game_state` | Inspect global variables, entities, current scene |
| `execute_lua` | Run Lua code in the game (sandboxed by default) |
| `get_console_output` | Retrieve `print()` and error output |
| `get_game_info` | Window size, FPS, Love2D version, MCP status |

### Interaction

| Tool | Description |
|------|-------------|
| `simulate_input` | Inject keyboard, mouse, or gamepad events |
| `move` | Hold WASD keys for a duration (convenience wrapper) |
| `set_game_state` | Modify variables at runtime (whitelist-controlled) |
| `hot_reload` | Reload Lua modules without restarting |
| `pause` / `resume` | Freeze/unfreeze the game loop |
| `step_frame` | Advance exactly N frames while paused |

### Process Management

| Tool | Description |
|------|-------------|
| `start_game` | Launch Love2D with your game (auto-detects Love2D location) |
| `stop_game` | Stop the running game process |
| `get_status` | Check game connection and Love2D installation status |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOVE_MCP_PORT` | `21110` | TCP port for game communication |
| `LOVE_MCP_HOST` | `127.0.0.1` | TCP host (keep as localhost for security) |
| `LOVE_MCP_GAME_PATH` | — | Path to your game directory (for `start_game`) |
| `LOVE_MCP_LOVE_PATH` | auto-detect | Path to Love2D executable |
| `LOVE_MCP_CONNECT_TIMEOUT` | `5000` | Connection timeout (ms) |
| `LOVE_MCP_REQUEST_TIMEOUT` | `30000` | Command timeout (ms) |
| `LOVE_MCP_HEARTBEAT_INTERVAL` | `5000` | How often to send heartbeats (ms) |
| `LOVE_MCP_HEARTBEAT_TIMEOUT` | `30000` | Disconnect if no peer activity in this time (ms) |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

### Lua-Side Configuration

```lua
mcp.init({
    port = 21110,                    -- TCP port (match LOVE_MCP_PORT)
    host = "127.0.0.1",             -- Bind address
    sandbox = true,                  -- Sandbox execute_lua (recommended)
    expose_globals = true,           -- Expose _G variables to get_game_state
    mutable_paths = { "player" },    -- Whitelist for set_game_state
    game_state = my_state_table,     -- Custom state table to expose
    get_current_scene = function()   -- Optional scene name getter
        return current_scene_name
    end,
    hot_reload_skip = {              -- Modules to exclude from `hot_reload`
        "libraries.hc",              -- (no-arg full reload). Useful for
        "vendor.lume",               -- third-party libs with load-order
        "^plugins%.",                -- dependencies. Strings starting with
    },                               -- "^" are Lua patterns; others match
                                     -- exact name + dot-prefix (so
                                     -- "libraries.hc" also skips
                                     -- "libraries.hc.polygon", etc.).
})
```

All options are optional. `mcp.init()` with no arguments works with sane defaults.

The Lua stdlib (`string`, `table`, `math`, ...), Love2D itself, `main`, `_G`, LuaSocket, and the love_mcp module are always skipped by `hot_reload` automatically — you only need `hot_reload_skip` for third-party libraries that break when re-required.

## Love2D Integration Guide

### Basic Setup

1. Copy `lua/love_mcp.lua` and the `lua/love_mcp/` directory into your game's source folder
2. Require and initialize in `love.load()`:

```lua
local mcp = require("love_mcp")

function love.load()
    mcp.init()
end
```

### Exposing Game State

Make state accessible to the AI by either exposing globals or passing a state table:

```lua
-- Option A: Global variables (default with expose_globals = true)
_G.player = { x = 100, y = 200, health = 100 }

-- Option B: Explicit state table
mcp.init({
    game_state = {
        player = player,
        enemies = enemy_list,
        level = current_level,
    },
})
```

### Allowing State Modification

By default, `set_game_state` is read-only. Whitelist paths to allow modification:

```lua
mcp.init({
    mutable_paths = { "player", "game.settings" },
})
```

### Custom Expose

Register additional data or functions for sandbox access:

```lua
mcp.expose("get_inventory", function()
    return player.inventory
end)
```

### Callback Chaining

The module safely chains onto existing `love.update`, `love.draw`, and `love.quit` callbacks. Your existing callbacks are called normally — MCP just adds its own logic before/after. Initialize MCP **after** defining your callbacks for proper chaining.

### LuaSocket Dependency

Love2D ships with LuaSocket built in (versions 11.x and 12.x). No external dependencies needed.

## Security Model

### Sandbox (default: enabled)

The `execute_lua` tool runs code in a sandbox that:
- **Allows**: `print`, `tostring`, `tonumber`, `type`, `pairs`, `ipairs`, `string.*`, `table.*`, `math.*`, read-only `love.graphics`, `love.timer`, `love.window`, `love.keyboard`, `love.mouse`
- **Blocks**: `os`, `io`, `require`, `dofile`, `loadfile`, `debug`, `rawset`, `rawget`, `ffi`

Set `sandbox: false` in `mcp.init()` only for trusted development environments.

### Network Security

The TCP socket binds to `127.0.0.1` (localhost only) by default. **Do not** set `host` to `0.0.0.0` unless you understand that this exposes the game to your entire network.

### Rate Limiting

Commands are rate-limited to 60/second by default. Configure with `max_commands_per_second` in `mcp.init()`.

## Example Prompts

Here are effective prompts to use with Claude once connected:

```
"Take a screenshot and describe what you see in the game"
"What is the current game state? Show me the player's position and health"
"Press space to start the game, then take a screenshot"
"Move the player right for 1 second, then screenshot to see where they ended up"
"Pause the game, step forward 5 frames, then screenshot"
"Run this Lua code in the game: print(love.timer.getFPS())"
"Hot reload the player.lua module"
"What's in the console output? Any errors?"
```

## Examples

The `examples/` directory contains working games with MCP integration:

- **`examples/minimal/`** — Simplest possible setup. Counter, mouse tracking, animated circle.
- **`examples/breakout/`** — Classic breakout clone. Demonstrates state inspection, input simulation, pause/step.

Run an example:

```bash
cd examples/minimal
love .
```

## Development

### Prerequisites

- Node.js 18+
- Love2D 11.4+

### Building from Source

```bash
git clone https://github.com/camden-git/love2d-mcp.git
cd love2d-mcp
npm install
npm run build
```

### Running in Development

```bash
# Start the server with auto-reload
cd server
npm run dev
```

### Running Tests

```bash
npm test
```

## Troubleshooting

### "Cannot reach the Love2D game"

- Make sure your game is running with `mcp.init()` called in `love.load()`
- Check that the port matches (default: 21110)
- Ensure nothing else is using port 21110: `lsof -i :21110` (macOS/Linux) or `netstat -ano | findstr 21110` (Windows)

### "Could not find Love2D"

The server auto-detects Love2D in these locations:
- **Windows**: `C:\Program Files\LOVE\love.exe`, or on PATH
- **macOS**: `/Applications/love.app/Contents/MacOS/love`, or on PATH
- **Linux**: `love` on PATH, `/usr/bin/love`, `/usr/local/bin/love`, `/snap/bin/love`

If installed elsewhere, set `LOVE_MCP_LOVE_PATH`:

```bash
export LOVE_MCP_LOVE_PATH=/path/to/love
```

### Game connects but tools timeout

- Increase timeout: set `LOVE_MCP_REQUEST_TIMEOUT=60000`
- Check that `love.update` is running (game isn't frozen)
- Enable debug logging: set `LOG_LEVEL=debug`

### Screenshot tool returns a file path instead of an image

The screenshot is saved to Love2D's save directory. Use your AI client's file reading capability to view it. The save directory location:
- **Windows**: `%APPDATA%\LOVE\<game-identity>\`
- **macOS**: `~/Library/Application Support/LOVE/<game-identity>/`
- **Linux**: `~/.local/share/love/<game-identity>/`

## License

MIT

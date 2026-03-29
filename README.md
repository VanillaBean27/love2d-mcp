# love2d-mcp

> AI-assisted game testing and development for Love2D via the Model Context Protocol.

**love2d-mcp** lets AI agents (Claude, and other MCP-compatible clients) observe, interact with, and test your Love2D games in real time. Take screenshots, inspect game state, execute Lua code, simulate player input — all through the standard MCP interface.

## Quick Start

### 1. Add MCP to your Love2D game

Copy `lua/love_mcp.lua` into your game directory, then add two lines to `main.lua`:

```lua
local mcp = require("love_mcp")

function love.load()
    mcp.init()
    -- your existing code ...
end
```

### 2. Start the MCP server

```bash
cd server
npm install
npm run build
npm start
```

### 3. Connect from Claude

Add to your MCP client config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "love2d": {
      "command": "node",
      "args": ["/path/to/love2d-mcp/server/dist/index.js"]
    }
  }
}
```

## Available Tools

### Phase 1 — Core (v0.1)
| Tool | Description |
|------|-------------|
| `screenshot` | Capture current frame as base64 PNG |
| `get_game_state` | Inspect global variables, entity lists, current scene |
| `execute_lua` | Run arbitrary Lua in the game context |
| `get_console_output` | Retrieve print() and error output |
| `get_game_info` | Window size, FPS, Love2D version |

### Phase 2 — Interaction (v0.2)
| Tool | Description |
|------|-------------|
| `simulate_input` | Inject keyboard/mouse events |
| `hot_reload` | Trigger file reload for rapid iteration |
| `set_game_state` | Modify variables at runtime |
| `pause` / `resume` | Freeze/unfreeze the game loop |
| `step_frame` | Advance exactly one frame |

### Phase 3 — Advanced (v0.3)
| Tool | Description |
|------|-------------|
| `set_breakpoint` | Pause on specific conditions |
| `profile` | Collect performance data |
| `record_replay` | Capture input for replay testing |
| `inspect_physics` | Visualize collision shapes |
| `automated_test_run` | Scripted test scenarios |

## Prerequisites

- Node.js 18+
- Love2D 11.4+

## Development

```bash
# Install dependencies
npm install

# Build server
npm run build

# Run tests
npm test

# Run integration tests (requires Love2D)
npm run test:integration
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full architecture document.

## License

MIT

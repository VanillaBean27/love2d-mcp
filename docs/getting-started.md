# Getting Started with love2d-mcp

## Prerequisites

- **Node.js 18+** (20+ recommended). Download from [nodejs.org](https://nodejs.org/).
- **Love2D 11.4+**. Download from [love2d.org](https://love2d.org/).
- A Love2D game you want to connect to an AI agent.

## Step 1: Install the MCP Server

```bash
git clone https://github.com/your-org/love2d-mcp.git
cd love2d-mcp/server
npm install
npm run build
```

Or install from npm (once published):

```bash
npm install -g love2d-mcp
```

## Step 2: Add MCP to Your Game

Copy `lua/love_mcp.lua` and the `lua/love_mcp/` directory into your game's source folder. Then add two lines to your `main.lua`:

```lua
local mcp = require("love_mcp")

function love.load()
    mcp.init()
    -- ... your existing code
end
```

### Configuration Options

```lua
mcp.init({
    port = 21110,                    -- TCP port (default: 21110)
    host = "127.0.0.1",             -- Bind address (default: localhost)
    sandbox = true,                  -- Sandbox execute_lua (default: true)
    expose_globals = true,           -- Allow reading global variables (default: true)
    mutable_paths = { "game" },      -- Paths that set_game_state can modify
    sandbox_extensions = {           -- Extra functions/tables for the sandbox
        my_util = require("my_util"),
    },
    get_current_scene = function()   -- Optional: report current scene name
        return scene_manager.current
    end,
})
```

## Step 3: Run Your Game

```bash
cd your-game/
love .
```

You should see a log message: `[love_mcp] Listening on 127.0.0.1:21110`

## Step 4: Connect from an MCP Client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "love2d": {
      "command": "node",
      "args": ["/absolute/path/to/love2d-mcp/server/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add love2d -- node /absolute/path/to/love2d-mcp/server/dist/index.js
```

### Other MCP Clients

Any client that supports the MCP standard can connect. The server communicates via stdio using JSON-RPC 2.0.

## Step 5: Try It Out

Once connected, ask your AI agent:

- "Take a screenshot of the game"
- "What's the current game state?"
- "Run `return love.timer.getFPS()` in the game"
- "Simulate pressing the space key"
- "Pause the game and step forward 10 frames"

## Troubleshooting

**"Cannot reach the Love2D game"**
Make sure your game is running with `mcp.init()` called in `love.load()`. Check that the port matches (default: 21110).

**"Connection refused"**
The game must be started before the MCP server tries to connect. The server will retry automatically when you call a tool.

**"Module not found: love_mcp"**
Make sure `love_mcp.lua` and the `love_mcp/` subdirectory are in your game's source folder (or in Lua's require path).

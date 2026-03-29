# Phase 1 Testing Guide

Step-by-step validation of the five core MCP tools: `screenshot`, `get_game_state`, `execute_lua`, `get_console_output`, and `get_game_info`.

---

## Prerequisites

Before testing, make sure you have:

- **Node.js 18+** installed
- **Love2D 11.4+** installed and available on your PATH
- The `love2d-mcp` project built (`cd server && npm install && npm run build`)

## Setup

### 1. Prepare the example game

Copy the Lua client module into the minimal example:

```
# From the project root
cp lua/love_mcp.lua examples/minimal/
cp -r lua/love_mcp examples/minimal/
```

### 2. Start the example game

```
cd examples/minimal
love .
```

You should see a window titled "love2d-mcp Minimal Example" with:
- A blue "Hello from love2d-mcp!" message
- A counter, FPS, and mouse position readout
- An animated circle
- A status line: "MCP: Waiting for connection..."

In the terminal, confirm you see: `[love_mcp] Listening on 127.0.0.1:21110`

### 3. Configure the MCP server

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "love2d": {
      "command": "node",
      "args": ["C:/Users/oakle/Documents/Claude/Cowork/outputs/love2d-mcp/server/dist/index.js"]
    }
  }
}
```

Or for Claude Code:

```
claude mcp add love2d -- node C:/Users/oakle/Documents/Claude/Cowork/outputs/love2d-mcp/server/dist/index.js
```

Restart your MCP client after adding the config. The game window should now show "MCP: Connected".

---

## Test 1: `get_game_info`

**What it tests:** Basic connectivity and metadata retrieval.

**Prompt to send:**
> Get the game info from Love2D.

**Expected response:** A JSON object containing:

| Field | Expected Value |
|-------|---------------|
| `love_version` | `11.4.x` or `11.5.x` (your installed version) |
| `window_width` | `800` |
| `window_height` | `600` |
| `fps` | ~60 (varies) |
| `game_title` | `"love2d-mcp Minimal Example"` |
| `mcp_version` | `"0.1.0"` |
| `paused` | `false` |
| `current_scene` | `"main"` |

**Pass criteria:** All fields present with sensible values. If this fails, the TCP connection between the server and game is broken — check ports and firewalls.

---

## Test 2: `screenshot`

**What it tests:** Frame capture, canvas rendering, base64 encoding, and image transport.

**Prompt to send:**
> Take a screenshot of the game.

**Expected response:** A PNG image showing the minimal example game — blue text, animated circle, counter, and MCP status indicator.

**Follow-up test — scaled screenshot:**
> Take a screenshot at 0.5x scale.

**Expected:** A smaller image (400x300) with the same content.

**Pass criteria:** The image renders correctly and matches what's visible in the game window. The animated circle position should correspond to the moment of capture.

**Common failures:**
- Black image → the draw callback isn't being called in the canvas capture
- Garbled image → base64 encoding issue
- "Not connected" error → game isn't running or server can't reach port 21110

---

## Test 3: `get_game_state`

**What it tests:** Global variable introspection and state serialization.

### Test 3a: Full state tree

**Prompt:**
> What is the current game state?

**Expected:** A JSON tree showing the `game` table with fields like `counter` (a number that increases over time), `color` (with `r`, `g`, `b` sub-fields), `message`, `mouse_x`, and `mouse_y`.

### Test 3b: Specific path

**Prompt:**
> Get the game state at path "game.color"

**Expected:**
```json
{
  "r": 0.2,
  "g": 0.6,
  "b": 1.0
}
```

### Test 3c: Deep path

**Prompt:**
> Get the game state at path "game.color.r"

**Expected:** `0.2`

### Test 3d: Invalid path

**Prompt:**
> Get the game state at path "game.nonexistent.value"

**Expected:** An error message like "Key 'nonexistent' not found".

**Pass criteria:** All four sub-tests return correct results. The counter value should be a positive number that increases between calls.

---

## Test 4: `execute_lua`

**What it tests:** Sandboxed Lua execution, return value serialization, and print capture.

### Test 4a: Simple expression

**Prompt:**
> Run this Lua code in the game: `return 2 + 2`

**Expected:** Result: `4`

### Test 4b: Game state access

**Prompt:**
> Run this Lua in the game: `return game.message`

**Expected:** Result: `"Hello from love2d-mcp!"`

### Test 4c: Print capture

**Prompt:**
> Run this Lua in the game: `print("hello from MCP"); print("second line"); return 42`

**Expected:**
- Output: `hello from MCP` and `second line`
- Result: `42`
- Also check the game's terminal — the prints should appear there too.

### Test 4d: Love2D API access (sandboxed)

**Prompt:**
> Run this Lua: `return love.timer.getFPS()`

**Expected:** A number around 60.

### Test 4e: Sandbox restriction

**Prompt:**
> Run this Lua: `return os.execute("echo hello")`

**Expected:** An error — `os` should not be accessible in the sandbox.

### Test 4f: Compile error

**Prompt:**
> Run this Lua: `return if then while`

**Expected:** A compile error message (not a crash).

### Test 4g: Runtime error

**Prompt:**
> Run this Lua: `local x = nil; return x.y`

**Expected:** A runtime error: "attempt to index a nil value".

**Pass criteria:** All seven sub-tests behave as expected. Errors are caught and reported gracefully, never crashing the game.

---

## Test 5: `get_console_output`

**What it tests:** Print interception and console buffer retrieval.

### Test 5a: Retrieve existing output

**Prompt:**
> Show me the console output from the game.

**Expected:** At minimum, a message like `[minimal] Game loaded. MCP listening on port 21110.` from the game's `love.load()`. If you've pressed keys or clicked in the game, those events should also appear.

### Test 5b: Generate then retrieve

First, press some keys in the game window (e.g., press `a`, `b`, `c`). Then:

**Prompt:**
> Show me the latest console output.

**Expected:** Messages like:
```
[INFO] [minimal] Key pressed: a
[INFO] [minimal] Key pressed: b
[INFO] [minimal] Key pressed: c
```

### Test 5c: Limit parameter

**Prompt:**
> Show me the last 2 console messages.

**Expected:** Only the 2 most recent messages.

**Pass criteria:** Console output is captured chronologically with correct log levels. The buffer accumulates over time and respects the `limit` parameter.

---

## Integration Test: Chained tool calls

The real power of MCP is combining tools. Test this workflow:

1. **Screenshot** → "Take a screenshot of the game"
2. **Inspect** → "What is game.counter set to?"
3. **Execute** → "Run this Lua: `game.message = 'AI was here!'`"
4. **Screenshot again** → "Take another screenshot"
5. **Verify** → The second screenshot should show "AI was here!" instead of the original message.

**Pass criteria:** The message on screen visibly changes between the two screenshots, confirming that `execute_lua` can modify game state and `screenshot` captures the updated frame.

---

## Stress Tests

### Rapid-fire commands

Send 10+ tool calls in quick succession. The game should remain responsive and not drop frames. The rate limiter should kick in at 60 commands/second.

### Large state tree

**Prompt:**
> Get the game state with depth 10.

The response should complete within a few seconds without hanging the game.

### Long Lua execution

**Prompt:**
> Run this Lua: `local sum = 0; for i = 1, 1000000 do sum = sum + i end; return sum`

**Expected:** Result: `500000500000`. The game may briefly stutter since this runs synchronously, but it should recover.

---

## Disconnection Tests

### Test: Server disconnect and reconnect

1. Close the MCP client
2. Confirm the game continues running normally (no crash)
3. Reopen the MCP client
4. Send a tool call — it should reconnect and work

### Test: Game restart

1. Close the Love2D game window
2. Send a tool call — should get a "not connected" error
3. Restart the game (`love .`)
4. Send another tool call — should reconnect and succeed

---

## Results Checklist

| Test | Status | Notes |
|------|--------|-------|
| 1. get_game_info | | |
| 2. screenshot | | |
| 2b. scaled screenshot | | |
| 3a. full state tree | | |
| 3b. specific path | | |
| 3c. deep path | | |
| 3d. invalid path | | |
| 4a. simple expression | | |
| 4b. game state access | | |
| 4c. print capture | | |
| 4d. Love2D API access | | |
| 4e. sandbox restriction | | |
| 4f. compile error | | |
| 4g. runtime error | | |
| 5a. existing output | | |
| 5b. generate then retrieve | | |
| 5c. limit parameter | | |
| Integration: chained calls | | |
| Stress: rapid-fire | | |
| Stress: large state | | |
| Stress: long execution | | |
| Disconnect: server reconnect | | |
| Disconnect: game restart | | |

Fill in each row with a check mark or note as you test. If any test fails, the "Notes" column should capture the error message or unexpected behavior.

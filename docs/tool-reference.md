# Tool Reference

Complete reference for all MCP tools provided by love2d-mcp.

---

## Phase 1 — Core Observability

### `screenshot`

Capture the current game frame as a base64-encoded PNG image.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `scale` | number | 1.0 | Scale factor (0.1 to 4.0) |

**Returns:** An image (PNG) and a text description of dimensions.

---

### `get_game_state`

Inspect game state — global variables, entity lists, and current scene.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | `""` | Dot-separated path (e.g., `"player.health"`) |
| `depth` | integer | 3 | Max serialization depth (1–10) |

**Returns:** JSON representation of the state at the given path.

---

### `execute_lua`

Execute Lua code in the running game context.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `code` | string | *(required)* | Lua code to execute |
| `sandbox` | boolean | true | Run in sandboxed environment |

**Returns:** The return value, captured print output, and any error message.

---

### `get_console_output`

Retrieve recent print() output and error messages.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `since` | number | — | Only messages after this timestamp |
| `limit` | integer | 100 | Max messages to return (1–1000) |

**Returns:** Array of `{ timestamp, level, text }` message objects.

---

### `get_game_info`

Get metadata about the running Love2D game.

**Parameters:** None.

**Returns:** Object with `love_version`, `window_width`, `window_height`, `fps`, `delta_time`, `current_scene`, `game_title`, `identity`, `mcp_version`, `paused`.

---

## Phase 2 — Interaction

### `simulate_input`

Inject keyboard, mouse, or gamepad events.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `events` | array | *(required)* | Array of event objects (see below) |
| `immediate` | boolean | false | Dispatch all at once vs. one per frame |

**Event types:** `keypressed`, `keyreleased`, `mousepressed`, `mousereleased`, `mousemoved`, `textinput`, `gamepadpressed`, `gamepadreleased`.

---

### `set_game_state`

Modify a game variable at runtime. Restricted to paths in the `mutable_paths` whitelist.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | *(required)* | Dot-separated variable path |
| `value` | any | *(required)* | New value |

---

### `pause`

Pause the game loop. Rendering and MCP communication continue.

### `resume`

Resume the game loop.

### `step_frame`

Advance N frames while paused.

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `count` | integer | 1 | Frames to advance (1–1000) |

### `hot_reload`

Reload Lua source files without restarting.

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `files` | string[] | — | Specific files, or omit to reload all |

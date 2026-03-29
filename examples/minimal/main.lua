---============================================================================
--- Minimal Example — love2d-mcp
---
--- The simplest possible Love2D game with MCP integration.
--- Demonstrates: screenshot, get_game_state, execute_lua, get_game_info.
---
--- Usage:
---   1. Copy lua/love_mcp.lua and lua/love_mcp/ into this directory
---      (or add the lua/ directory to your Lua path)
---   2. Run: love .
---   3. Start the MCP server and connect from your AI client.
---============================================================================

-- Add the lua directory to the require path so love_mcp can be found
love.filesystem.setRequirePath(
    love.filesystem.getRequirePath() .. ";../../lua/?.lua;../../lua/?/init.lua"
)

local mcp = require("love_mcp")

-- Game state — accessible via get_game_state and execute_lua
local game = {
    counter = 0,
    color = { r = 0.2, g = 0.6, b = 1.0 },
    message = "Hello from love2d-mcp!",
    mouse_x = 0,
    mouse_y = 0,
}

-- Make game state globally accessible for MCP inspection
_G.game = game

function love.load()
    mcp.init({
        port = 21110,
        expose_globals = true,
        mutable_paths = { "game" },  -- Allow MCP to modify game state
        get_current_scene = function() return "main" end,
    })

    love.graphics.setBackgroundColor(0.1, 0.1, 0.15)
    print("[minimal] Game loaded. MCP listening on port 21110.")
end

function love.update(dt)
    game.counter = game.counter + dt
    game.mouse_x, game.mouse_y = love.mouse.getPosition()
end

function love.draw()
    -- Background gradient effect
    local t = game.counter
    love.graphics.setColor(game.color.r, game.color.g, game.color.b)

    -- Title
    love.graphics.setFont(love.graphics.newFont(28))
    love.graphics.printf(game.message, 0, 200, 800, "center")

    -- Info
    love.graphics.setFont(love.graphics.newFont(16))
    love.graphics.setColor(0.7, 0.7, 0.7)
    love.graphics.printf(
        string.format("Counter: %.1f | FPS: %d | Mouse: %d, %d",
            game.counter, love.timer.getFPS(), game.mouse_x, game.mouse_y),
        0, 260, 800, "center"
    )

    -- MCP status
    local status = mcp.is_connected() and "MCP: Connected" or "MCP: Waiting for connection..."
    local status_color = mcp.is_connected() and {0.3, 1.0, 0.3} or {1.0, 0.8, 0.3}
    love.graphics.setColor(status_color)
    love.graphics.printf(status, 0, 560, 800, "center")

    -- Animated circle
    love.graphics.setColor(game.color.r, game.color.g, game.color.b, 0.5)
    local cx = 400 + math.sin(t * 0.8) * 150
    local cy = 400 + math.cos(t * 1.2) * 80
    love.graphics.circle("fill", cx, cy, 30 + math.sin(t * 2) * 10)

    love.graphics.setColor(1, 1, 1)
end

function love.keypressed(key)
    if key == "escape" then
        love.event.quit()
    end
    print("[minimal] Key pressed: " .. key)
end

function love.mousepressed(x, y, button)
    print(string.format("[minimal] Mouse pressed: button %d at (%d, %d)", button, x, y))
end

---============================================================================
--- Breakout Example — love2d-mcp
---
--- A classic breakout clone that demonstrates MCP integration in a real game.
--- AI agents can: take screenshots, inspect game state (score, lives, bricks),
--- simulate paddle movement and ball launch, pause/step for testing.
---============================================================================

love.filesystem.setRequirePath(
    love.filesystem.getRequirePath() .. ";../../lua/?.lua;../../lua/?/init.lua"
)

local mcp = require("love_mcp")

-- ==========================================================================
-- Game State
-- ==========================================================================

local game = {
    state = "title",  -- "title", "playing", "gameover", "won"
    score = 0,
    lives = 3,
    level = 1,
}

local paddle = {
    x = 350,
    y = 560,
    width = 100,
    height = 12,
    speed = 500,
}

local ball = {
    x = 400,
    y = 545,
    radius = 6,
    dx = 0,
    dy = 0,
    speed = 300,
    attached = true,  -- Stuck to paddle until launched
}

local bricks = {}
local brick_colors = {
    {0.9, 0.2, 0.2},  -- Red
    {0.9, 0.5, 0.1},  -- Orange
    {0.9, 0.9, 0.2},  -- Yellow
    {0.2, 0.9, 0.2},  -- Green
    {0.2, 0.6, 0.9},  -- Blue
}

-- Expose state globally for MCP
_G.game = game
_G.paddle = paddle
_G.ball = ball
_G.bricks = bricks

-- ==========================================================================
-- Brick Generation
-- ==========================================================================

local function create_bricks()
    bricks = {}
    local cols = 10
    local rows = 5
    local brick_w = 68
    local brick_h = 20
    local padding = 4
    local offset_x = (800 - (cols * (brick_w + padding) - padding)) / 2
    local offset_y = 60

    for row = 1, rows do
        for col = 1, cols do
            bricks[#bricks + 1] = {
                x = offset_x + (col - 1) * (brick_w + padding),
                y = offset_y + (row - 1) * (brick_h + padding),
                width = brick_w,
                height = brick_h,
                color = brick_colors[row],
                alive = true,
                points = (rows - row + 1) * 10,
            }
        end
    end
    _G.bricks = bricks
end

local function reset_ball()
    ball.attached = true
    ball.x = paddle.x + paddle.width / 2
    ball.y = paddle.y - ball.radius - 1
    ball.dx = 0
    ball.dy = 0
end

local function launch_ball()
    if not ball.attached then return end
    ball.attached = false
    local angle = math.rad(-75 + math.random() * 30)  -- Launch upward with slight randomness
    ball.dx = math.sin(angle) * ball.speed
    ball.dy = -math.cos(angle) * ball.speed
end

local function reset_game()
    game.state = "playing"
    game.score = 0
    game.lives = 3
    game.level = 1
    paddle.x = 350
    create_bricks()
    reset_ball()
end

-- ==========================================================================
-- Love2D Callbacks
-- ==========================================================================

function love.load()
    mcp.init({
        port = 21110,
        expose_globals = true,
        mutable_paths = { "game", "paddle", "ball", "bricks" },
        get_current_scene = function() return game.state end,
    })

    love.graphics.setBackgroundColor(0.05, 0.05, 0.1)
    create_bricks()
    print("[breakout] Game loaded. MCP listening on port 21110.")
end

function love.update(dt)
    if game.state ~= "playing" then return end

    -- Paddle movement
    if love.keyboard.isDown("left") or love.keyboard.isDown("a") then
        paddle.x = math.max(0, paddle.x - paddle.speed * dt)
    end
    if love.keyboard.isDown("right") or love.keyboard.isDown("d") then
        paddle.x = math.min(800 - paddle.width, paddle.x + paddle.speed * dt)
    end

    -- Ball follows paddle when attached
    if ball.attached then
        ball.x = paddle.x + paddle.width / 2
        ball.y = paddle.y - ball.radius - 1
        return
    end

    -- Ball movement
    ball.x = ball.x + ball.dx * dt
    ball.y = ball.y + ball.dy * dt

    -- Wall collisions
    if ball.x - ball.radius <= 0 then
        ball.x = ball.radius
        ball.dx = math.abs(ball.dx)
    elseif ball.x + ball.radius >= 800 then
        ball.x = 800 - ball.radius
        ball.dx = -math.abs(ball.dx)
    end
    if ball.y - ball.radius <= 0 then
        ball.y = ball.radius
        ball.dy = math.abs(ball.dy)
    end

    -- Ball fell off bottom
    if ball.y > 620 then
        game.lives = game.lives - 1
        if game.lives <= 0 then
            game.state = "gameover"
            print("[breakout] Game over! Final score: " .. game.score)
        else
            reset_ball()
            print("[breakout] Life lost. Lives remaining: " .. game.lives)
        end
        return
    end

    -- Paddle collision
    if ball.dy > 0 and
       ball.y + ball.radius >= paddle.y and
       ball.y - ball.radius <= paddle.y + paddle.height and
       ball.x >= paddle.x and
       ball.x <= paddle.x + paddle.width then
        ball.dy = -math.abs(ball.dy)
        -- Angle based on where the ball hit the paddle
        local hit_pos = (ball.x - paddle.x) / paddle.width  -- 0 to 1
        local angle = math.rad(-60 + hit_pos * 120)  -- -60 to +60 degrees
        local speed = math.sqrt(ball.dx^2 + ball.dy^2)
        ball.dx = math.sin(angle) * speed
        ball.dy = -math.cos(angle) * speed
        ball.y = paddle.y - ball.radius - 1
    end

    -- Brick collisions
    local all_destroyed = true
    for _, brick in ipairs(bricks) do
        if brick.alive then
            all_destroyed = false
            if ball.x + ball.radius >= brick.x and
               ball.x - ball.radius <= brick.x + brick.width and
               ball.y + ball.radius >= brick.y and
               ball.y - ball.radius <= brick.y + brick.height then
                brick.alive = false
                game.score = game.score + brick.points
                ball.dy = -ball.dy
                print(string.format("[breakout] Brick destroyed! Score: %d", game.score))
                break
            end
        end
    end

    if all_destroyed then
        game.state = "won"
        print("[breakout] You win! Final score: " .. game.score)
    end
end

function love.draw()
    if game.state == "title" then
        love.graphics.setColor(1, 1, 1)
        love.graphics.setFont(love.graphics.newFont(36))
        love.graphics.printf("BREAKOUT", 0, 200, 800, "center")
        love.graphics.setFont(love.graphics.newFont(18))
        love.graphics.setColor(0.7, 0.7, 0.7)
        love.graphics.printf("Press SPACE to start", 0, 280, 800, "center")

    elseif game.state == "gameover" then
        love.graphics.setColor(1, 0.3, 0.3)
        love.graphics.setFont(love.graphics.newFont(36))
        love.graphics.printf("GAME OVER", 0, 200, 800, "center")
        love.graphics.setFont(love.graphics.newFont(18))
        love.graphics.setColor(0.7, 0.7, 0.7)
        love.graphics.printf("Score: " .. game.score .. "\nPress SPACE to restart", 0, 280, 800, "center")

    elseif game.state == "won" then
        love.graphics.setColor(0.3, 1, 0.3)
        love.graphics.setFont(love.graphics.newFont(36))
        love.graphics.printf("YOU WIN!", 0, 200, 800, "center")
        love.graphics.setFont(love.graphics.newFont(18))
        love.graphics.setColor(0.7, 0.7, 0.7)
        love.graphics.printf("Score: " .. game.score .. "\nPress SPACE to restart", 0, 280, 800, "center")

    elseif game.state == "playing" then
        -- Draw bricks
        for _, brick in ipairs(bricks) do
            if brick.alive then
                love.graphics.setColor(brick.color)
                love.graphics.rectangle("fill", brick.x, brick.y, brick.width, brick.height, 3, 3)
                love.graphics.setColor(1, 1, 1, 0.3)
                love.graphics.rectangle("line", brick.x, brick.y, brick.width, brick.height, 3, 3)
            end
        end

        -- Draw paddle
        love.graphics.setColor(0.8, 0.8, 0.9)
        love.graphics.rectangle("fill", paddle.x, paddle.y, paddle.width, paddle.height, 4, 4)

        -- Draw ball
        love.graphics.setColor(1, 1, 1)
        love.graphics.circle("fill", ball.x, ball.y, ball.radius)

        -- HUD
        love.graphics.setFont(love.graphics.newFont(16))
        love.graphics.setColor(0.8, 0.8, 0.8)
        love.graphics.print("Score: " .. game.score, 10, 10)
        love.graphics.print("Lives: " .. game.lives, 700, 10)
        love.graphics.print("FPS: " .. love.timer.getFPS(), 370, 10)
    end

    -- MCP connection indicator
    local mcp_color = mcp.is_connected() and {0.2, 0.8, 0.2} or {0.5, 0.5, 0.5}
    love.graphics.setColor(mcp_color)
    love.graphics.circle("fill", 790, 10, 5)

    love.graphics.setColor(1, 1, 1)
end

function love.keypressed(key)
    if key == "escape" then
        love.event.quit()
    elseif key == "space" then
        if game.state == "title" or game.state == "gameover" or game.state == "won" then
            reset_game()
        elseif game.state == "playing" and ball.attached then
            launch_ball()
        end
    end
    print("[breakout] Key pressed: " .. key)
end

function love.mousepressed(x, y, button)
    if game.state == "playing" and ball.attached and button == 1 then
        launch_ball()
    end
end

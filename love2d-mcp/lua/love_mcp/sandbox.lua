--- Sandboxed Lua execution environment.
--- Provides a restricted execution context for the execute_lua MCP tool.

local sandbox = {}

--- Create a new sandbox environment.
--- The sandbox exposes safe standard library functions and optionally
--- developer-provided extensions, while blocking access to os, io, debug,
--- loadfile, dofile, and other dangerous functions.
---@param opts table  Options: { expose_globals = bool, extensions = table, game_state = table }
---@return table  The sandbox environment table
function sandbox.create(opts)
    opts = opts or {}

    local env = {
        -- Safe builtins
        print       = print,
        tostring    = tostring,
        tonumber    = tonumber,
        type        = type,
        pairs       = pairs,
        ipairs      = ipairs,
        next        = next,
        select      = select,
        unpack      = unpack or table.unpack,
        pcall       = pcall,
        xpcall      = xpcall,
        error       = error,
        assert      = assert,
        setmetatable = setmetatable,
        getmetatable = getmetatable,

        -- Safe standard libraries (copies to prevent pollution)
        string = {},
        table  = {},
        math   = {},
    }

    -- Copy string library
    for k, v in pairs(string) do env.string[k] = v end

    -- Copy table library
    for k, v in pairs(table) do env.table[k] = v end

    -- Copy math library
    for k, v in pairs(math) do env.math[k] = v end

    -- Read-only Love2D access (if available)
    if love then
        env.love = {
            graphics = {
                getDimensions    = love.graphics and love.graphics.getDimensions,
                getWidth         = love.graphics and love.graphics.getWidth,
                getHeight        = love.graphics and love.graphics.getHeight,
                getBackgroundColor = love.graphics and love.graphics.getBackgroundColor,
            },
            timer = {
                getTime  = love.timer and love.timer.getTime,
                getFPS   = love.timer and love.timer.getFPS,
                getDelta = love.timer and love.timer.getDelta,
            },
            window = {
                getTitle = love.window and love.window.getTitle,
                getMode  = love.window and love.window.getMode,
            },
            keyboard = {
                isDown = love.keyboard and love.keyboard.isDown,
            },
            mouse = {
                getPosition = love.mouse and love.mouse.getPosition,
                isDown      = love.mouse and love.mouse.isDown,
            },
        }
    end

    -- Expose global game state if configured
    if opts.expose_globals and opts.game_state then
        for k, v in pairs(opts.game_state) do
            env[k] = v
        end
    end

    -- Developer-provided extensions
    if opts.extensions then
        for k, v in pairs(opts.extensions) do
            env[k] = v
        end
    end

    env._G = env
    return env
end

--- Execute Lua code in a sandbox.
---@param code string      The Lua code to execute
---@param env table        The sandbox environment
---@param timeout_ms number|nil  Not enforced in pure Lua; reserved for future use
---@return boolean success
---@return any result       The return value(s) or error message
---@return string output    Captured print output during execution
function sandbox.execute(code, env, timeout_ms)
    local output_lines = {}

    -- Temporarily override print in the sandbox to capture output
    local original_print = env.print
    env.print = function(...)
        local parts = {}
        for i = 1, select('#', ...) do
            parts[i] = tostring(select(i, ...))
        end
        local line = table.concat(parts, "\t")
        output_lines[#output_lines + 1] = line
        -- Also call the real print
        if original_print then original_print(...) end
    end

    -- Compile the code
    local fn, compile_err = load(code, "=mcp_execute", "t", env)
    if not fn then
        env.print = original_print
        return false, compile_err, ""
    end

    -- Execute
    local results = {pcall(fn)}
    env.print = original_print

    local success = table.remove(results, 1)
    local output = table.concat(output_lines, "\n")

    if success then
        -- Return the first return value (or nil if none)
        return true, results[1], output
    else
        return false, results[1], output
    end
end

return sandbox

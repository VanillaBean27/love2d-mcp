---============================================================================
--- love_mcp — MCP (Model Context Protocol) client module for Love2D
---
--- Enables AI agents to observe, interact with, and test Love2D games
--- in real time via the MCP standard.
---
--- Usage:
---   local mcp = require("love_mcp")
---   function love.load()
---       mcp.init({ port = 21110 })
---   end
---
--- That's it. The module hooks into Love2D callbacks automatically.
---============================================================================

-- Determine the base path for submodule requires.
-- When required as "love_mcp", submodules are at "love_mcp.xxx".
-- When required as "libs.love_mcp", submodules are at "libs.love_mcp.xxx".
local MOD_NAME = (...)
local BASE = MOD_NAME  -- e.g., "love_mcp" or "libs.love_mcp"

local json             = require(BASE .. ".json")
local socket_handler   = require(BASE .. ".socket_handler")
local console_capture  = require(BASE .. ".console_capture")
local sandbox_mod      = require(BASE .. ".sandbox")
local state_inspector  = require(BASE .. ".state_inspector")
local input_simulator  = require(BASE .. ".input_simulator")

local love_mcp = {}
love_mcp.VERSION = "0.1.0"

-- Internal state
local _initialized = false
local _socket = nil
local _console = nil
local _input_sim = nil
local _config = {}
local _paused = false
local _step_frames = 0
local _original_callbacks = {}
local _command_handlers = {}
local _rate_limiter = { count = 0, reset_time = 0, max_per_second = 60 }
local _pending_screenshot_requests = {}
local _virtual_keys = {}          -- key -> frames_remaining
local _original_isDown = nil      -- original love.keyboard.isDown

--- Initialize the MCP client module.
--- Call this once in love.load().
---@param opts table|nil  Configuration options
function love_mcp.init(opts)
    if _initialized then
        print("[love_mcp] Already initialized, ignoring duplicate init()")
        return
    end

    opts = opts or {}
    _config = {
        port              = opts.port or tonumber(os.getenv("LOVE_MCP_PORT")) or 21110,
        host              = opts.host or "127.0.0.1",
        sandbox           = opts.sandbox ~= false,  -- default: true
        mutable_paths     = opts.mutable_paths or {},
        expose_globals    = opts.expose_globals ~= false,  -- default: true
        max_payload_size  = opts.max_payload_size or (4 * 1024 * 1024),
        sandbox_extensions = opts.sandbox_extensions or {},
        max_commands_per_second = opts.max_commands_per_second or 60,
        game_state_ref    = opts.game_state or nil,
        scene_getter      = opts.get_current_scene or nil,
    }
    _rate_limiter.max_per_second = _config.max_commands_per_second

    -- Initialize subsystems
    _console = console_capture.new(500)
    _console:install()

    _input_sim = input_simulator.new()

    _socket = socket_handler.new({
        host = _config.host,
        port = _config.port,
        max_payload_size = _config.max_payload_size,
    })

    local ok, err = _socket:listen()
    if not ok then
        _console:error("Failed to start MCP listener: " .. tostring(err))
        return
    end

    print("[love_mcp] Listening on " .. _config.host .. ":" .. _config.port)

    -- Register command handlers
    love_mcp._register_handlers()

    -- Hook into Love2D callbacks
    love_mcp._hook_callbacks()

    _initialized = true
end

--- Shut down the MCP module. Restores original callbacks.
function love_mcp.shutdown()
    if not _initialized then return end

    -- Restore original callbacks
    for name, fn in pairs(_original_callbacks) do
        love[name] = fn
    end
    _original_callbacks = {}

    -- Clean up
    if _console then _console:uninstall() end
    if _socket then _socket:close() end

    _initialized = false
    _paused = false
    _step_frames = 0
    print("[love_mcp] Shut down")
end

--- Check if the module is initialized.
---@return boolean
function love_mcp.is_initialized()
    return _initialized
end

--- Check if a MCP client is connected.
---@return boolean
function love_mcp.is_connected()
    return _socket and _socket:is_connected() or false
end

--- Check if the game is currently paused via MCP.
---@return boolean
function love_mcp.is_paused()
    return _paused
end

--- Allow developers to register custom state for MCP access.
---@param key string
---@param value any
function love_mcp.expose(key, value)
    if not _config.sandbox_extensions then
        _config.sandbox_extensions = {}
    end
    _config.sandbox_extensions[key] = value
end

--==========================================================================
-- Internal: Callback hooking
--==========================================================================

function love_mcp._hook_callbacks()
    -- Patch love.keyboard.isDown to also report virtual (MCP-held) keys.
    _original_isDown = love.keyboard.isDown
    love.keyboard.isDown = function(...)
        -- Check virtual keys first
        for i = 1, select("#", ...) do
            local key = select(i, ...)
            if _virtual_keys[key] then
                return true
            end
        end
        return _original_isDown(...)
    end

    -- Hook love.update
    _original_callbacks.update = love.update
    love.update = function(dt)
        -- Always poll MCP socket, even when paused
        love_mcp._poll_socket()

        -- Tick down virtual key hold timers; release expired keys.
        for key, frames in pairs(_virtual_keys) do
            if frames <= 1 then
                _virtual_keys[key] = nil
                -- Fire keyreleased so event-based systems also see it
                if love.keyreleased then
                    love.keyreleased(key, key)
                end
            else
                _virtual_keys[key] = frames - 1
            end
        end

        -- Dispatch one queued input event per frame
        if _input_sim then
            _input_sim:dispatch_one()
        end

        if _paused then
            if _step_frames > 0 then
                _step_frames = _step_frames - 1
                if _original_callbacks.update then
                    _original_callbacks.update(dt)
                end
            end
            -- When paused, skip the game's update
            return
        end

        if _original_callbacks.update then
            _original_callbacks.update(dt)
        end
    end

    -- Hook love.draw — call captureScreenshot here (required by Love2D 11.4+).
    _original_callbacks.draw = love.draw
    love.draw = function()
        if _original_callbacks.draw then
            _original_callbacks.draw()
        end

        -- Process any pending screenshot requests.
        -- captureScreenshot MUST be called inside love.draw; calling it
        -- from love.update will crash in Love2D 11.4+.
        if #_pending_screenshot_requests > 0 then
            local requests = _pending_screenshot_requests
            _pending_screenshot_requests = {}
            love.graphics.captureScreenshot(function(image_data)
                for _, req in ipairs(requests) do
                    local ok, err = pcall(function()
                        local src_w, src_h = image_data:getWidth(), image_data:getHeight()
                        local filename = "_mcp_screenshot.png"
                        local save_data = image_data
                        local out_w, out_h = src_w, src_h

                        -- Cap at 960px wide so the saved PNG stays under ~500KB.
                        if src_w > 960 then
                            local s = 960 / src_w
                            out_w = 960
                            out_h = math.floor(src_h * s)
                            save_data = love.image.newImageData(out_w, out_h)
                            local inv = 1.0 / s
                            for y = 0, out_h - 1 do
                                for x = 0, out_w - 1 do
                                    local sx = math.min(math.floor(x * inv), src_w - 1)
                                    local sy = math.min(math.floor(y * inv), src_h - 1)
                                    save_data:setPixel(x, y, image_data:getPixel(sx, sy))
                                end
                            end
                        end

                        save_data:encode("png", filename)
                        if save_data ~= image_data then
                            save_data:release()
                        end

                        local full_path = love.filesystem.getSaveDirectory() .. "/" .. filename
                        love_mcp._send_response(req.id, {
                            file = full_path,
                            width = out_w,
                            height = out_h,
                            format = "png",
                        })
                    end)
                    if not ok then
                        love_mcp._send_error(req.id, "HANDLER_ERROR", tostring(err))
                    end
                end
            end)
        end
    end

    -- Hook love.quit
    _original_callbacks.quit = love.quit
    love.quit = function()
        love_mcp.shutdown()
        if _original_callbacks.quit then
            return _original_callbacks.quit()
        end
    end
end

--==========================================================================
-- Internal: Socket polling and message dispatch
--==========================================================================

function love_mcp._poll_socket()
    if not _socket then return end

    local messages = _socket:poll(json)

    for _, msg in ipairs(messages) do
        if msg.type == "heartbeat" then
            -- Respond to heartbeat
            _socket:send(json, {
                type = "heartbeat",
                timestamp = love.timer and love.timer.getTime() or os.clock(),
            })
        elseif msg.type == "request" then
            love_mcp._handle_request(msg)
        end
    end
end

function love_mcp._handle_request(msg)
    -- Rate limiting
    local now = love.timer and love.timer.getTime() or os.clock()
    if now >= _rate_limiter.reset_time then
        _rate_limiter.count = 0
        _rate_limiter.reset_time = now + 1.0
    end
    _rate_limiter.count = _rate_limiter.count + 1
    if _rate_limiter.count > _rate_limiter.max_per_second then
        love_mcp._send_error(msg.id, "RATE_LIMITED", "Too many commands per second")
        return
    end

    local handler = _command_handlers[msg.command]
    if not handler then
        love_mcp._send_error(msg.id, "UNKNOWN_COMMAND", "Unknown command: " .. tostring(msg.command))
        return
    end

    local ok, result = pcall(handler, msg.params or {}, msg.id)
    if ok then
        if type(result) == "table" and result.__deferred then
            return  -- response will be sent asynchronously
        end
        love_mcp._send_response(msg.id, result)
    else
        love_mcp._send_error(msg.id, "HANDLER_ERROR", tostring(result))
    end
end

function love_mcp._send_response(id, data)
    if not _socket then return end
    _socket:send(json, {
        id = id,
        type = "response",
        status = "ok",
        data = data,
    })
end

function love_mcp._send_error(id, code, message)
    if not _socket then return end
    _socket:send(json, {
        id = id,
        type = "response",
        status = "error",
        error = { code = code, message = message },
    })
end

function love_mcp._send_event(event_name, data)
    if not _socket or not _socket:is_connected() then return end
    _socket:send(json, {
        type = "event",
        event = event_name,
        data = data,
    })
end

--==========================================================================
-- Internal: Command handler registration
--==========================================================================

function love_mcp._register_handlers()
    -- Phase 1: Core
    _command_handlers["screenshot"]        = love_mcp._cmd_screenshot
    _command_handlers["get_game_state"]     = love_mcp._cmd_get_game_state
    _command_handlers["execute_lua"]        = love_mcp._cmd_execute_lua
    _command_handlers["get_console_output"] = love_mcp._cmd_get_console_output
    _command_handlers["get_game_info"]      = love_mcp._cmd_get_game_info

    -- Phase 2: Interaction
    _command_handlers["simulate_input"]     = love_mcp._cmd_simulate_input
    _command_handlers["set_game_state"]     = love_mcp._cmd_set_game_state
    _command_handlers["pause"]             = love_mcp._cmd_pause
    _command_handlers["resume"]            = love_mcp._cmd_resume
    _command_handlers["step_frame"]        = love_mcp._cmd_step_frame
    _command_handlers["hot_reload"]        = love_mcp._cmd_hot_reload
    _command_handlers["hold_keys"]         = love_mcp._cmd_hold_keys
end

--==========================================================================
-- Phase 1 Command Handlers
--==========================================================================

function love_mcp._cmd_screenshot(params, id)
    -- Queue the request; actual captureScreenshot happens in the draw hook
    -- (Love2D 11.4+ requires it to be called inside love.draw).
    _pending_screenshot_requests[#_pending_screenshot_requests + 1] = {
        id = id,
        params = params or {},
    }
    return { __deferred = true }
end

function love_mcp._cmd_hold_keys(params)
    local keys = params.keys
    local frames = params.frames or 30  -- default ~0.5s at 60fps
    if type(keys) ~= "table" then
        error("Missing required parameter: keys (array of key names)")
    end

    local held = {}
    for _, key in ipairs(keys) do
        _virtual_keys[key] = frames
        held[#held + 1] = key
        -- Fire keypressed so event-based systems also see it
        if love.keypressed then
            love.keypressed(key, key, false)
        end
    end

    return {
        held = held,
        frames = frames,
    }
end

function love_mcp._cmd_get_game_state(params)
    local path = params.path or ""
    local depth = params.depth or 3

    -- Build the state root
    local root = {}

    -- Include globals if configured
    if _config.expose_globals then
        -- Shallow copy of _G, excluding internal/dangerous keys
        local skip = {
            _G=true, _VERSION=true, arg=true, coroutine=true, debug=true,
            io=true, os=true, package=true, require=true, dofile=true,
            loadfile=true, load=true, rawget=true, rawset=true, rawequal=true,
            love=true, jit=true, bit=true, ffi=true, socket=true,
        }
        for k, v in pairs(_G) do
            if type(k) == "string" and not skip[k] and not k:match("^_") then
                root[k] = v
            end
        end
    end

    -- Include developer-exposed state
    if _config.game_state_ref then
        for k, v in pairs(_config.game_state_ref) do
            root[k] = v
        end
    end

    local value, err = state_inspector.resolve(path, root)
    if err then
        error(err)
    end

    return state_inspector.serialize(value, depth)
end

function love_mcp._cmd_execute_lua(params)
    if not params.code then
        error("Missing required parameter: code")
    end

    local use_sandbox = _config.sandbox
    if params.sandbox ~= nil then
        use_sandbox = params.sandbox
    end

    if use_sandbox then
        local env = sandbox_mod.create({
            expose_globals = _config.expose_globals,
            game_state = _config.game_state_ref,
            extensions = _config.sandbox_extensions,
        })
        local success, result, output = sandbox_mod.execute(params.code, env)
        return {
            result = state_inspector.serialize(result, 5),
            output = output,
            error = success and nil or tostring(result),
        }
    else
        -- Unsandboxed execution (developer must opt in)
        local fn, compile_err = load(params.code)
        if not fn then
            return { result = nil, output = "", error = compile_err }
        end
        local ok, result = pcall(fn)
        return {
            result = ok and state_inspector.serialize(result, 5) or nil,
            output = "",
            error = ok and nil or tostring(result),
        }
    end
end

function love_mcp._cmd_get_console_output(params)
    if not _console then
        return { messages = {} }
    end
    return {
        messages = _console:get(params.since, params.limit),
    }
end

function love_mcp._cmd_get_game_info(params)
    local major, minor, revision, codename = love.getVersion()
    local w, h, flags = love.window.getMode()
    local title = love.window.getTitle()
    local identity = love.filesystem.getIdentity()

    local scene = nil
    if _config.scene_getter then
        local ok, s = pcall(_config.scene_getter)
        if ok then scene = s end
    end

    return {
        love_version = string.format("%d.%d.%d", major, minor, revision),
        love_codename = codename,
        window_width = w,
        window_height = h,
        fullscreen = flags.fullscreen,
        vsync = flags.vsync,
        fps = love.timer.getFPS(),
        delta_time = love.timer.getDelta(),
        current_scene = scene,
        game_title = title,
        identity = identity,
        mcp_version = love_mcp.VERSION,
        paused = _paused,
    }
end

--==========================================================================
-- Phase 2 Command Handlers
--==========================================================================

function love_mcp._cmd_simulate_input(params)
    if not params.events or type(params.events) ~= "table" then
        error("Missing or invalid 'events' parameter")
    end

    local immediate = params.immediate or false
    local queued, errors = _input_sim:queue_events(params.events)

    if immediate then
        _input_sim:dispatch_all()
    end

    return {
        executed = queued,
        errors = errors,
    }
end

function love_mcp._cmd_set_game_state(params)
    if not params.path then error("Missing required parameter: path") end

    local root = {}
    if _config.expose_globals then
        for k, v in pairs(_G) do
            if type(k) == "string" then root[k] = v end
        end
    end
    if _config.game_state_ref then
        for k, v in pairs(_config.game_state_ref) do
            root[k] = v
        end
    end

    local previous, err = state_inspector.set(
        params.path,
        root,
        params.value,
        #_config.mutable_paths > 0 and _config.mutable_paths or nil
    )

    if err then error(err) end

    return {
        previous_value = state_inspector.serialize(previous, 3),
        new_value = state_inspector.serialize(params.value, 3),
    }
end

function love_mcp._cmd_pause(params)
    _paused = true
    return { paused = true }
end

function love_mcp._cmd_resume(params)
    _paused = false
    _step_frames = 0
    return { paused = false }
end

function love_mcp._cmd_step_frame(params)
    local count = params.count or 1
    _step_frames = _step_frames + count
    -- Game is still paused but will advance count frames
    return {
        frames_queued = count,
        game_time = love.timer.getTime(),
    }
end

function love_mcp._cmd_hot_reload(params)
    local files = params.files
    local reloaded = {}
    local errors = {}

    if files and #files > 0 then
        for _, file in ipairs(files) do
            local mod_name = file:gsub("/", "."):gsub("%.lua$", "")
            if package.loaded[mod_name] then
                package.loaded[mod_name] = nil
                local ok, err = pcall(require, mod_name)
                if ok then
                    reloaded[#reloaded + 1] = mod_name
                else
                    errors[#errors + 1] = mod_name .. ": " .. tostring(err)
                end
            else
                errors[#errors + 1] = mod_name .. ": not previously loaded"
            end
        end
    else
        -- Reload all non-standard modules
        local skip = { love_mcp = true, socket = true, mime = true, ltn12 = true }
        for name, _ in pairs(package.loaded) do
            if type(name) == "string" and not skip[name] and not name:match("^love%.") and not name:match("^love_mcp") then
                package.loaded[name] = nil
                local ok, err = pcall(require, name)
                if ok then
                    reloaded[#reloaded + 1] = name
                else
                    errors[#errors + 1] = name .. ": " .. tostring(err)
                end
            end
        end
    end

    return { reloaded = reloaded, errors = errors }
end

return love_mcp

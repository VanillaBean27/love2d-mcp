--- Input simulator module.
--- Injects synthetic keyboard, mouse, and gamepad events into Love2D callbacks.
--- Used by the simulate_input MCP tool (Phase 2).

local input_simulator = {}
input_simulator.__index = input_simulator

function input_simulator.new()
    local self = setmetatable({}, input_simulator)
    self.event_queue = {}
    self.recording = false
    self.recorded_events = {}
    return self
end

--- Queue events for dispatch.
---@param events table  Array of event objects
---@return number queued  Number of events queued
---@return table errors   Array of error strings
function input_simulator:queue_events(events)
    local queued = 0
    local errors = {}

    for _, event in ipairs(events) do
        local ok, err = self:_validate_event(event)
        if ok then
            self.event_queue[#self.event_queue + 1] = event
            queued = queued + 1
        else
            errors[#errors + 1] = err
        end
    end

    return queued, errors
end

--- Dispatch one event from the queue.
--- Call this once per frame to maintain realistic timing,
--- or call repeatedly for immediate dispatch.
---@return boolean dispatched  True if an event was dispatched
function input_simulator:dispatch_one()
    if #self.event_queue == 0 then
        return false
    end

    local event = table.remove(self.event_queue, 1)
    self:_dispatch_event(event)
    return true
end

--- Dispatch all queued events immediately.
---@return number count  Number of events dispatched
function input_simulator:dispatch_all()
    local count = 0
    while self:dispatch_one() do
        count = count + 1
    end
    return count
end

function input_simulator:_validate_event(event)
    if type(event) ~= "table" then
        return false, "Event must be a table"
    end
    if not event.type then
        return false, "Event missing 'type' field"
    end

    local valid_types = {
        keypressed = true, keyreleased = true,
        mousepressed = true, mousereleased = true, mousemoved = true,
        textinput = true,
        gamepadpressed = true, gamepadreleased = true,
    }

    if not valid_types[event.type] then
        return false, "Unknown event type: " .. tostring(event.type)
    end

    return true, nil
end

function input_simulator:_dispatch_event(event)
    local t = event.type

    if t == "keypressed" and love.keypressed then
        love.keypressed(event.key or "", event.scancode or event.key or "", event.isrepeat or false)
    elseif t == "keyreleased" and love.keyreleased then
        love.keyreleased(event.key or "", event.scancode or event.key or "")
    elseif t == "mousepressed" and love.mousepressed then
        love.mousepressed(event.x or 0, event.y or 0, event.button or 1, event.istouch or false, event.presses or 1)
    elseif t == "mousereleased" and love.mousereleased then
        love.mousereleased(event.x or 0, event.y or 0, event.button or 1, event.istouch or false, event.presses or 1)
    elseif t == "mousemoved" and love.mousemoved then
        love.mousemoved(event.x or 0, event.y or 0, event.dx or 0, event.dy or 0, event.istouch or false)
    elseif t == "textinput" and love.textinput then
        love.textinput(event.text or "")
    elseif t == "gamepadpressed" and love.gamepadpressed then
        love.gamepadpressed(event.joystick, event.button or "a")
    elseif t == "gamepadreleased" and love.gamepadreleased then
        love.gamepadreleased(event.joystick, event.button or "a")
    end

    -- Record if active
    if self.recording then
        event._timestamp = love.timer and love.timer.getTime() or os.clock()
        self.recorded_events[#self.recorded_events + 1] = event
    end
end

--- Start recording dispatched events.
function input_simulator:start_recording()
    self.recording = true
    self.recorded_events = {}
end

--- Stop recording and return captured events.
---@return table  Array of recorded event objects
function input_simulator:stop_recording()
    self.recording = false
    local events = self.recorded_events
    self.recorded_events = {}
    return events
end

return input_simulator

--- Console capture module.
--- Intercepts print() and love.errorhandler to buffer output for the MCP client.

local console_capture = {}
console_capture.__index = console_capture

--- Create a new console capture instance.
---@param max_messages number  Maximum number of messages to retain
---@return table
function console_capture.new(max_messages)
    local self = setmetatable({}, console_capture)
    self.messages = {}
    self.max_messages = max_messages or 500
    self._original_print = print
    self._original_errorhandler = nil
    self._installed = false
    return self
end

--- Install the capture hooks. Replaces global print() and love.errorhandler.
function console_capture:install()
    if self._installed then return end
    self._installed = true

    local cap = self

    -- Wrap print
    self._original_print = print
    _G.print = function(...)
        -- Call original print so output still goes to terminal
        cap._original_print(...)

        local parts = {}
        for i = 1, select('#', ...) do
            parts[i] = tostring(select(i, ...))
        end
        local text = table.concat(parts, "\t")
        cap:_add("info", text)
    end

    -- Wrap love.errorhandler (if love is available)
    if love and love.errorhandler then
        self._original_errorhandler = love.errorhandler
        love.errorhandler = function(msg)
            cap:_add("error", tostring(msg))
            if cap._original_errorhandler then
                return cap._original_errorhandler(msg)
            end
        end
    end
end

--- Uninstall the capture hooks. Restores original print() and love.errorhandler.
function console_capture:uninstall()
    if not self._installed then return end
    self._installed = false

    _G.print = self._original_print

    if self._original_errorhandler and love then
        love.errorhandler = self._original_errorhandler
    end
end

--- Add a message to the buffer.
---@param level string  "info", "warn", or "error"
---@param text string
function console_capture:_add(level, text)
    local msg = {
        timestamp = love and love.timer and love.timer.getTime() or os.clock(),
        level = level,
        text = text,
    }
    self.messages[#self.messages + 1] = msg

    -- Trim if over capacity (remove oldest)
    while #self.messages > self.max_messages do
        table.remove(self.messages, 1)
    end
end

--- Log a warning.
---@param text string
function console_capture:warn(text)
    self._original_print("[love_mcp WARN] " .. text)
    self:_add("warn", text)
end

--- Log an error.
---@param text string
function console_capture:error(text)
    self._original_print("[love_mcp ERROR] " .. text)
    self:_add("error", text)
end

--- Retrieve messages, optionally filtered by timestamp.
---@param since number|nil  Only return messages after this timestamp
---@param limit number|nil  Maximum number of messages to return
---@return table  Array of message objects
function console_capture:get(since, limit)
    limit = limit or 100
    local result = {}
    for i = #self.messages, 1, -1 do
        local msg = self.messages[i]
        if since and msg.timestamp <= since then
            break
        end
        table.insert(result, 1, msg)
        if #result >= limit then
            break
        end
    end
    return result
end

--- Clear all buffered messages.
function console_capture:clear()
    self.messages = {}
end

return console_capture

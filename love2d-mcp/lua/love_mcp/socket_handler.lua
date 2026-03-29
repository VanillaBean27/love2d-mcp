--- Socket handler module.
--- Manages the TCP server socket and client connection with non-blocking I/O.

local socket_handler = {}
socket_handler.__index = socket_handler

--- Create a new socket handler.
---@param opts table  { host: string, port: number, max_payload_size: number }
---@return table
function socket_handler.new(opts)
    local self = setmetatable({}, socket_handler)
    self.host = opts.host or "127.0.0.1"
    self.port = opts.port or 21110
    self.max_payload_size = opts.max_payload_size or (4 * 1024 * 1024)

    self.server = nil       -- TCP server socket
    self.client = nil       -- Connected client socket
    self.recv_buffer = ""   -- Incoming data buffer
    self.send_queue = {}    -- Outgoing message queue
    self.connected = false
    self.last_heartbeat = 0

    return self
end

--- Start listening for connections.
---@return boolean success
---@return string|nil error
function socket_handler:listen()
    local socket = require("socket")

    local server, err = socket.bind(self.host, self.port)
    if not server then
        return false, "Failed to bind to " .. self.host .. ":" .. self.port .. ": " .. tostring(err)
    end

    server:settimeout(0)  -- Non-blocking
    self.server = server

    return true, nil
end

--- Poll for new connections and incoming data.
--- Must be called once per frame from love.update.
--- Returns an array of decoded messages (may be empty).
---@param json table  The json module (for decoding)
---@return table  Array of parsed message tables
function socket_handler:poll(json)
    local messages = {}

    if not self.server then
        return messages
    end

    -- Accept new connections
    if not self.client then
        local client, err = self.server:accept()
        if client then
            client:settimeout(0)
            self.client = client
            self.connected = true
            self.recv_buffer = ""
            self.send_queue = {}
            self.last_heartbeat = love and love.timer and love.timer.getTime() or os.clock()
        end
        return messages
    end

    -- Read available data
    local data, err, partial = self.client:receive(8192)
    local received = data or partial
    if received and #received > 0 then
        self.recv_buffer = self.recv_buffer .. received
        self:_extract_messages(json, messages)
    elseif err == "closed" then
        self:_disconnect()
    end

    -- Flush send queue
    self:_flush_send_queue()

    return messages
end

--- Extract complete messages from the receive buffer.
--- Protocol: 4-byte big-endian length prefix + JSON payload.
---@param json table
---@param messages table  Array to append parsed messages to
function socket_handler:_extract_messages(json, messages)
    while #self.recv_buffer >= 4 do
        -- Read 4-byte length prefix (big-endian uint32)
        local b1, b2, b3, b4 = self.recv_buffer:byte(1, 4)
        local payload_len = b1 * 0x1000000 + b2 * 0x10000 + b3 * 0x100 + b4

        if payload_len > self.max_payload_size then
            -- Payload too large — disconnect to prevent memory issues
            self:_disconnect()
            return
        end

        if #self.recv_buffer < 4 + payload_len then
            break  -- Incomplete message, wait for more data
        end

        local payload = self.recv_buffer:sub(5, 4 + payload_len)
        self.recv_buffer = self.recv_buffer:sub(5 + payload_len)

        local msg, decode_err = json.decode(payload)
        if msg then
            messages[#messages + 1] = msg
        end
    end
end

--- Queue a message for sending.
---@param json table  The json module (for encoding)
---@param message table  The message to send
function socket_handler:send(json, message)
    if not self.client then return end

    local payload = json.encode(message)
    local len = #payload

    -- 4-byte big-endian length prefix
    local header = string.char(
        math.floor(len / 0x1000000) % 256,
        math.floor(len / 0x10000) % 256,
        math.floor(len / 0x100) % 256,
        len % 256
    )

    self.send_queue[#self.send_queue + 1] = header .. payload
end

--- Flush queued outgoing messages.
function socket_handler:_flush_send_queue()
    if not self.client or #self.send_queue == 0 then return end

    while #self.send_queue > 0 do
        local data = self.send_queue[1]
        local sent, err, last_sent = self.client:send(data)
        if sent then
            table.remove(self.send_queue, 1)
        elseif err == "timeout" then
            -- Partial send — trim the sent portion and retry next frame
            if last_sent and last_sent > 0 then
                self.send_queue[1] = data:sub(last_sent + 1)
            end
            break
        elseif err == "closed" then
            self:_disconnect()
            break
        else
            break
        end
    end
end

--- Handle disconnection cleanup.
function socket_handler:_disconnect()
    if self.client then
        self.client:close()
        self.client = nil
    end
    self.connected = false
    self.recv_buffer = ""
    self.send_queue = {}
end

--- Check if a client is currently connected.
---@return boolean
function socket_handler:is_connected()
    return self.connected
end

--- Close the server and any active client connection.
function socket_handler:close()
    self:_disconnect()
    if self.server then
        self.server:close()
        self.server = nil
    end
end

return socket_handler

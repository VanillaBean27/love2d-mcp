--- Minimal JSON encoder/decoder for love_mcp.
--- Avoids external dependencies. Handles the subset of JSON needed for the protocol.

local json = {}

--- Encode a Lua value to a JSON string.
--- Supports: string, number, boolean, nil, table (array or object).
--- Functions and userdata are encoded as descriptive strings.
---@param value any
---@param depth number|nil  Current recursion depth (internal)
---@param max_depth number|nil  Maximum recursion depth
---@return string
function json.encode(value, depth, max_depth)
    depth = depth or 0
    max_depth = max_depth or 20

    if depth > max_depth then
        return '"<max depth exceeded>"'
    end

    local t = type(value)

    if value == nil then
        return "null"
    elseif t == "boolean" then
        return value and "true" or "false"
    elseif t == "number" then
        if value ~= value then return '"NaN"' end          -- NaN
        if value == math.huge then return '"Infinity"' end
        if value == -math.huge then return '"-Infinity"' end
        if value == math.floor(value) and math.abs(value) < 2^53 then
            return string.format("%d", value)
        end
        return string.format("%.14g", value)
    elseif t == "string" then
        return json._encode_string(value)
    elseif t == "table" then
        return json._encode_table(value, depth, max_depth)
    elseif t == "function" then
        return '"<function>"'
    elseif t == "userdata" then
        local mt = getmetatable(value)
        local typename = mt and mt.__name or "userdata"
        return json._encode_string("<" .. typename .. ">")
    else
        return json._encode_string("<" .. t .. ">")
    end
end

local escape_map = {
    ['"']  = '\\"',
    ['\\'] = '\\\\',
    ['\b'] = '\\b',
    ['\f'] = '\\f',
    ['\n'] = '\\n',
    ['\r'] = '\\r',
    ['\t'] = '\\t',
}

function json._encode_string(s)
    local result = s:gsub('[%z\1-\31"\\]', function(c)
        return escape_map[c] or string.format("\\u%04x", c:byte())
    end)
    return '"' .. result .. '"'
end

function json._encode_table(tbl, depth, max_depth)
    -- Detect array vs object
    local is_array = true
    local max_index = 0
    local count = 0
    for k, _ in pairs(tbl) do
        count = count + 1
        if type(k) == "number" and k == math.floor(k) and k > 0 then
            if k > max_index then max_index = k end
        else
            is_array = false
            break
        end
    end
    if is_array and max_index ~= count then
        is_array = false  -- Sparse array → treat as object
    end

    local parts = {}
    if is_array and count > 0 then
        for i = 1, max_index do
            parts[i] = json.encode(tbl[i], depth + 1, max_depth)
        end
        return "[" .. table.concat(parts, ",") .. "]"
    else
        for k, v in pairs(tbl) do
            local key = type(k) == "string" and k or tostring(k)
            parts[#parts + 1] = json._encode_string(key) .. ":" .. json.encode(v, depth + 1, max_depth)
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
end

-- ==========================================================================
-- JSON Decoder
-- ==========================================================================

function json.decode(str)
    if type(str) ~= "string" then
        return nil, "expected string, got " .. type(str)
    end
    local pos = 1

    local function skip_whitespace()
        pos = str:match("^%s*()", pos)
    end

    local function peek()
        skip_whitespace()
        return str:sub(pos, pos)
    end

    local function next_char()
        skip_whitespace()
        local c = str:sub(pos, pos)
        pos = pos + 1
        return c
    end

    local function expect(c)
        skip_whitespace()
        if str:sub(pos, pos) ~= c then
            error("JSON: expected '" .. c .. "' at position " .. pos .. ", got '" .. str:sub(pos, pos) .. "'")
        end
        pos = pos + 1
    end

    local parse_value  -- forward declaration

    local function parse_string()
        expect('"')
        local parts = {}
        while pos <= #str do
            local c = str:sub(pos, pos)
            pos = pos + 1
            if c == '"' then
                return table.concat(parts)
            elseif c == '\\' then
                local esc = str:sub(pos, pos)
                pos = pos + 1
                if esc == '"' then parts[#parts+1] = '"'
                elseif esc == '\\' then parts[#parts+1] = '\\'
                elseif esc == '/' then parts[#parts+1] = '/'
                elseif esc == 'b' then parts[#parts+1] = '\b'
                elseif esc == 'f' then parts[#parts+1] = '\f'
                elseif esc == 'n' then parts[#parts+1] = '\n'
                elseif esc == 'r' then parts[#parts+1] = '\r'
                elseif esc == 't' then parts[#parts+1] = '\t'
                elseif esc == 'u' then
                    local hex = str:sub(pos, pos + 3)
                    pos = pos + 4
                    local code = tonumber(hex, 16)
                    if code then
                        if code < 128 then
                            parts[#parts+1] = string.char(code)
                        else
                            -- Simple UTF-8 encoding for BMP characters
                            if code < 0x800 then
                                parts[#parts+1] = string.char(
                                    0xC0 + math.floor(code / 64),
                                    0x80 + (code % 64)
                                )
                            else
                                parts[#parts+1] = string.char(
                                    0xE0 + math.floor(code / 4096),
                                    0x80 + math.floor((code % 4096) / 64),
                                    0x80 + (code % 64)
                                )
                            end
                        end
                    end
                end
            else
                parts[#parts+1] = c
            end
        end
        error("JSON: unterminated string")
    end

    local function parse_number()
        local start = pos
        if str:sub(pos, pos) == '-' then pos = pos + 1 end
        while str:sub(pos, pos):match("[%d]") do pos = pos + 1 end
        if str:sub(pos, pos) == '.' then
            pos = pos + 1
            while str:sub(pos, pos):match("[%d]") do pos = pos + 1 end
        end
        if str:sub(pos, pos):match("[eE]") then
            pos = pos + 1
            if str:sub(pos, pos):match("[%+%-]") then pos = pos + 1 end
            while str:sub(pos, pos):match("[%d]") do pos = pos + 1 end
        end
        local num = tonumber(str:sub(start, pos - 1))
        if not num then error("JSON: invalid number at position " .. start) end
        return num
    end

    local function parse_array()
        expect('[')
        local arr = {}
        if peek() == ']' then
            pos = pos + 1
            return arr
        end
        while true do
            arr[#arr + 1] = parse_value()
            skip_whitespace()
            local c = str:sub(pos, pos)
            pos = pos + 1
            if c == ']' then return arr end
            if c ~= ',' then error("JSON: expected ',' or ']' at position " .. (pos - 1)) end
        end
    end

    local function parse_object()
        expect('{')
        local obj = {}
        if peek() == '}' then
            pos = pos + 1
            return obj
        end
        while true do
            local key = parse_string()
            expect(':')
            obj[key] = parse_value()
            skip_whitespace()
            local c = str:sub(pos, pos)
            pos = pos + 1
            if c == '}' then return obj end
            if c ~= ',' then error("JSON: expected ',' or '}' at position " .. (pos - 1)) end
        end
    end

    parse_value = function()
        skip_whitespace()
        local c = str:sub(pos, pos)
        if c == '"' then return parse_string()
        elseif c == '{' then return parse_object()
        elseif c == '[' then return parse_array()
        elseif c == 't' then
            if str:sub(pos, pos + 3) == "true" then pos = pos + 4; return true end
            error("JSON: invalid value at position " .. pos)
        elseif c == 'f' then
            if str:sub(pos, pos + 4) == "false" then pos = pos + 5; return false end
            error("JSON: invalid value at position " .. pos)
        elseif c == 'n' then
            if str:sub(pos, pos + 3) == "null" then pos = pos + 4; return nil end
            error("JSON: invalid value at position " .. pos)
        elseif c == '-' or c:match("%d") then
            return parse_number()
        else
            error("JSON: unexpected character '" .. c .. "' at position " .. pos)
        end
    end

    local ok, result = pcall(parse_value)
    if not ok then
        return nil, result
    end
    return result
end

return json

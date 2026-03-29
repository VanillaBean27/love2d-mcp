--- State inspector module.
--- Provides utilities for introspecting game state tables and serializing
--- them into JSON-compatible structures.

local state_inspector = {}

--- Walk a dot-separated path into a table.
--- Example: resolve("player.health", game_state) returns game_state.player.health
---@param path string       Dot-separated key path (e.g., "player.health")
---@param root table        The root table to start from
---@return any value        The value at the path
---@return string|nil error Error message if path is invalid
function state_inspector.resolve(path, root)
    if not path or path == "" then
        return root, nil
    end

    local current = root
    for segment in path:gmatch("[^%.]+") do
        if type(current) ~= "table" then
            return nil, "Cannot index into " .. type(current) .. " at '" .. segment .. "'"
        end

        -- Try string key first, then numeric
        local value = current[segment]
        if value == nil then
            local num = tonumber(segment)
            if num then
                value = current[num]
            end
        end

        if value == nil then
            return nil, "Key '" .. segment .. "' not found"
        end
        current = value
    end

    return current, nil
end

--- Serialize a Lua value into a JSON-compatible table.
--- Handles tables with depth limiting and circular reference detection.
---@param value any
---@param max_depth number   Maximum table nesting depth
---@param current_depth number|nil  Internal: current depth counter
---@param seen table|nil     Internal: set of already-visited tables
---@return any  JSON-compatible value
function state_inspector.serialize(value, max_depth, current_depth, seen)
    max_depth = max_depth or 3
    current_depth = current_depth or 0
    seen = seen or {}

    local t = type(value)

    if value == nil then
        return nil  -- JSON null
    elseif t == "boolean" or t == "number" or t == "string" then
        return value
    elseif t == "function" then
        return "<function>"
    elseif t == "userdata" then
        local mt = getmetatable(value)
        local name = mt and (mt.__name or mt.__tostring and tostring(value)) or "userdata"
        return "<" .. tostring(name) .. ">"
    elseif t == "table" then
        if seen[value] then
            return "<circular reference>"
        end

        if current_depth >= max_depth then
            -- Count keys to give a hint of what's inside
            local count = 0
            for _ in pairs(value) do count = count + 1 end
            return "<table: " .. count .. " keys>"
        end

        seen[value] = true

        -- Check if it's an array
        local is_array = true
        local max_index = 0
        local key_count = 0
        for k, _ in pairs(value) do
            key_count = key_count + 1
            if type(k) == "number" and k == math.floor(k) and k > 0 then
                if k > max_index then max_index = k end
            else
                is_array = false
            end
        end
        if is_array and max_index ~= key_count then
            is_array = false
        end

        local result = {}
        if is_array and key_count > 0 then
            for i = 1, max_index do
                result[i] = state_inspector.serialize(value[i], max_depth, current_depth + 1, seen)
            end
        else
            for k, v in pairs(value) do
                local key = type(k) == "string" and k or tostring(k)
                result[key] = state_inspector.serialize(v, max_depth, current_depth + 1, seen)
            end
        end

        seen[value] = nil  -- Allow revisiting through different paths
        return result
    else
        return "<" .. t .. ">"
    end
end

--- Set a value at a dot-separated path in a table.
---@param path string        Dot-separated key path
---@param root table         The root table
---@param value any          The value to set
---@param allowed_paths table|nil  If provided, path must start with one of these prefixes
---@return any previous      The previous value
---@return string|nil error  Error message if path is invalid or not allowed
function state_inspector.set(path, root, value, allowed_paths)
    if not path or path == "" then
        return nil, "Empty path"
    end

    -- Check if path is in the allowed list
    if allowed_paths then
        local allowed = false
        for _, prefix in ipairs(allowed_paths) do
            if path == prefix or path:sub(1, #prefix + 1) == prefix .. "." then
                allowed = true
                break
            end
        end
        if not allowed then
            return nil, "Path '" .. path .. "' is not in the mutable_paths whitelist"
        end
    end

    local segments = {}
    for segment in path:gmatch("[^%.]+") do
        segments[#segments + 1] = segment
    end

    local current = root
    for i = 1, #segments - 1 do
        local seg = segments[i]
        local next_val = current[seg]
        if next_val == nil then
            local num = tonumber(seg)
            if num then next_val = current[num] end
        end
        if type(next_val) ~= "table" then
            return nil, "Cannot traverse '" .. seg .. "': " .. type(next_val)
        end
        current = next_val
    end

    local final_key = segments[#segments]
    local num_key = tonumber(final_key)
    local actual_key = (current[final_key] ~= nil) and final_key or (num_key and num_key or final_key)

    local previous = current[actual_key]
    current[actual_key] = value

    return previous, nil
end

return state_inspector

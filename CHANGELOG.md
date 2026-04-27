# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-09

### Added
- Lua client module (`love_mcp.lua`) with non-blocking TCP socket communication
- Node.js MCP server with stdio JSON-RPC 2.0 transport
- Phase 1 tools: `screenshot`, `get_game_state`, `execute_lua`, `get_console_output`, `get_game_info`
- Phase 2 tools: `simulate_input`, `move`, `set_game_state`, `hot_reload`, `pause`, `resume`, `step_frame`
- Management tools: `start_game`, `stop_game`, `get_status`
- TCP communication protocol with length-prefix framing
- Sandboxed Lua execution environment
- Rate limiting (60 commands/second)
- Auto-reconnection on disconnect
- Minimal and breakout example games
- Cross-platform Love2D auto-detection (Windows, macOS, Linux)
- Cross-platform process management
- CI/CD with GitHub Actions
- Comprehensive README with setup guides for Claude Desktop and Claude Code

### Removed
- `start_server` / `stop_server` tools (self-referential; the server is already running)
- Hardcoded personal file paths

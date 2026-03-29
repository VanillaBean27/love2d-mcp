# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project structure
- Lua client module (`love_mcp.lua`) with non-blocking TCP socket communication
- Node.js MCP server with stdio JSON-RPC 2.0 transport
- Phase 1 tools: `screenshot`, `get_game_state`, `execute_lua`, `get_console_output`, `get_game_info`
- TCP communication protocol with length-prefix framing
- Minimal and breakout example games
- CI workflow for linting and testing

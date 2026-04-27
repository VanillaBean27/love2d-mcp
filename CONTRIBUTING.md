# Contributing to love2d-mcp

Thanks for your interest in contributing! This guide will help you get set up.

## Development Setup

### Prerequisites

- Node.js 18+
- Love2D 11.4+ (for testing)
- Git

### Getting Started

```bash
git clone https://github.com/camden-git/love2d-mcp.git
cd love2d-mcp
npm install
npm run build
```

### Project Structure

```
love2d-mcp/
  lua/                    # Lua client module (runs inside Love2D)
    love_mcp.lua          # Main module entry point
    love_mcp/
      console_capture.lua # print() interception
      input_simulator.lua # Input event queue
      json.lua            # JSON encoder/decoder
      sandbox.lua         # Sandboxed Lua execution
      socket_handler.lua  # TCP server (non-blocking)
      state_inspector.lua # Game state serialization
  server/                 # Node.js MCP server
    src/
      index.ts            # Entry point (stdio transport)
      mcp-handler.ts      # Tool registration and dispatch
      game-bridge.ts      # TCP client to the Love2D game
      protocol/
        framing.ts        # Length-prefix message framing
        messages.ts       # Protocol type definitions
      utils/
        config.ts         # Environment-based configuration
        logger.ts         # stderr logger
  examples/
    minimal/              # Simplest possible example game
    breakout/             # Breakout clone with full MCP integration
  tests/
    server/               # Server unit tests
```

### Architecture

```
MCP Client (Claude)  <--stdio/JSON-RPC-->  MCP Server (Node.js)  <--TCP-->  Love2D Game (Lua)
```

The MCP server speaks JSON-RPC 2.0 over stdio to the AI client, and communicates with the Love2D game over a TCP socket using length-prefixed JSON messages.

### Development Workflow

```bash
# Build the TypeScript server
npm run build

# Run tests
npm test

# Run the server in dev mode (auto-reload)
cd server && npm run dev

# Run an example game
cd examples/minimal && love .
```

### Running Tests

```bash
# Unit tests
npm test

# Watch mode
cd server && npm run test:watch
```

## Making Changes

### Code Style

- TypeScript for the server, Lua for the game module
- Use `path.join()` / `path.resolve()` for all file paths (cross-platform)
- Use the `logger` module for all output (writes to stderr to avoid interfering with stdio MCP transport)

### Adding a New Tool

1. Add the command handler in `lua/love_mcp.lua` (in `_register_handlers`)
2. Register the MCP tool in `server/src/mcp-handler.ts`
3. Add the tool to the table in `README.md`
4. Add a test

### Testing

- Test on both Windows and macOS/Linux when possible
- The minimal example in `examples/minimal/` is the easiest way to manually test

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Build: `npm run build`
6. Commit with a clear message
7. Open a pull request

## Reporting Issues

- Use the [GitHub issue tracker](https://github.com/camden-git/love2d-mcp/issues)
- Include your OS, Node.js version, and Love2D version
- For connection issues, include the output with `LOG_LEVEL=debug`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

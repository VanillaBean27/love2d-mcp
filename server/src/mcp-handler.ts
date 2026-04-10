/**
 * MCP Handler — registers tools and dispatches MCP tool calls to the game bridge.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';

import type { GameBridge } from './game-bridge.js';
import { logger } from './utils/logger.js';

// Track running processes
let gameProcess: ChildProcess | null = null;
let serverProcess: ChildProcess | null = null;

/**
 * Register all MCP tools on the given server.
 */
export function registerTools(server: McpServer, bridge: GameBridge): void {
  registerPhase1Tools(server, bridge);
  registerPhase2Tools(server, bridge);
  registerManagementTools(server, bridge);
}

// ==========================================================================
// Phase 1 — Core Observability
// ==========================================================================

function registerPhase1Tools(server: McpServer, bridge: GameBridge): void {

  // --- screenshot ---
  server.tool(
    'screenshot',
    'Capture the current game frame. Returns a file path — use your Read tool to view the image.',
    {},
    async () => {
      const result = await bridge.sendCommand('screenshot', {}) as {
        file: string; width: number; height: number; format: string;
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: `Screenshot saved: ${result.file}\nResolution: ${result.width}x${result.height}\nUse the Read tool on the file path above to view the image.`,
          },
        ],
      };
    }
  );

  // --- move ---
  server.tool(
    'move',
    'Move the player by holding WASD keys for a duration. Use screenshot after moving to see the result.',
    {
      direction: z.enum(['up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right'])
        .describe('Direction to move'),
      duration: z.number().min(0.1).max(5.0).optional()
        .describe('How long to hold the key in seconds (default: 0.5)'),
    },
    async ({ direction, duration }) => {
      const seconds = duration ?? 0.5;
      const frames = Math.round(seconds * 60); // assume 60fps

      const keyMap: Record<string, string[]> = {
        'up':         ['w'],
        'down':       ['s'],
        'left':       ['a'],
        'right':      ['d'],
        'up-left':    ['w', 'a'],
        'up-right':   ['w', 'd'],
        'down-left':  ['s', 'a'],
        'down-right': ['s', 'd'],
      };

      const keys = keyMap[direction];
      const result = await bridge.sendCommand('hold_keys', { keys, frames }) as {
        held: string[]; frames: number;
      };

      return {
        content: [{
          type: 'text' as const,
          text: `Moving ${direction}: holding [${result.held.join(', ')}] for ${result.frames} frames (~${seconds}s). Use screenshot to see the result after movement completes.`,
        }],
      };
    }
  );

  // --- get_game_state ---
  server.tool(
    'get_game_state',
    'Inspect game state — global variables, entity lists, current scene. Use dot-separated paths like "player.health" to drill into specific values.',
    {
      path: z.string().optional()
        .describe('Dot-separated path to a specific state value (e.g., "player.health"). Omit to get the full state tree.'),
      depth: z.number().int().min(1).max(10).optional()
        .describe('Maximum depth for table serialization (default: 3)'),
    },
    async ({ path, depth }) => {
      const result = await bridge.sendCommand('get_game_state', {
        path: path ?? '',
        depth: depth ?? 3,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // --- execute_lua ---
  server.tool(
    'execute_lua',
    'Execute Lua code in the running game context. Returns the result, captured print output, and any errors. Code runs in a sandbox by default.',
    {
      code: z.string()
        .describe('Lua code to execute in the game'),
      sandbox: z.boolean().optional()
        .describe('Whether to run in a sandboxed environment (default: true)'),
    },
    async ({ code, sandbox }) => {
      const result = await bridge.sendCommand('execute_lua', {
        code,
        sandbox: sandbox ?? true,
      }) as { result: unknown; output: string; error: string | null };

      const parts: Array<{ type: 'text'; text: string }> = [];

      if (result.error) {
        parts.push({ type: 'text' as const, text: `Error: ${result.error}` });
      }
      if (result.output) {
        parts.push({ type: 'text' as const, text: `Output:\n${result.output}` });
      }
      if (result.result !== undefined && result.result !== null) {
        parts.push({
          type: 'text' as const,
          text: `Result: ${typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}`,
        });
      }

      if (parts.length === 0) {
        parts.push({ type: 'text' as const, text: 'Executed successfully (no output).' });
      }

      return { content: parts };
    }
  );

  // --- get_console_output ---
  server.tool(
    'get_console_output',
    'Retrieve recent print() output and error messages from the game.',
    {
      since: z.number().optional()
        .describe('Only return messages after this timestamp'),
      limit: z.number().int().min(1).max(1000).optional()
        .describe('Maximum number of messages to return (default: 100)'),
    },
    async ({ since, limit }) => {
      const result = await bridge.sendCommand('get_console_output', {
        since,
        limit: limit ?? 100,
      }) as { messages: Array<{ timestamp: number; level: string; text: string }> };

      if (result.messages.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No console output.' }],
        };
      }

      const formatted = result.messages
        .map(m => `[${m.level.toUpperCase()}] ${m.text}`)
        .join('\n');

      return {
        content: [{ type: 'text' as const, text: formatted }],
      };
    }
  );

  // --- get_game_info ---
  server.tool(
    'get_game_info',
    'Get metadata about the running Love2D game — version, window size, FPS, current scene, and more.',
    {},
    async () => {
      const result = await bridge.sendCommand('get_game_info', {});
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );
}

// ==========================================================================
// Phase 2 — Interaction
// ==========================================================================

function registerPhase2Tools(server: McpServer, bridge: GameBridge): void {

  // --- simulate_input ---
  server.tool(
    'simulate_input',
    'Inject keyboard, mouse, or gamepad events into the game. Events are queued and dispatched one per frame unless immediate=true.',
    {
      events: z.array(z.object({
        type: z.enum([
          'keypressed', 'keyreleased',
          'mousepressed', 'mousereleased', 'mousemoved',
          'textinput',
          'gamepadpressed', 'gamepadreleased',
        ]),
        key: z.string().optional(),
        scancode: z.string().optional(),
        isrepeat: z.boolean().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        dx: z.number().optional(),
        dy: z.number().optional(),
        button: z.union([z.string(), z.number()]).optional(),
        istouch: z.boolean().optional(),
        presses: z.number().optional(),
        text: z.string().optional(),
        joystick: z.any().optional(),
      })).describe('Array of input event objects'),
      immediate: z.boolean().optional()
        .describe('Dispatch all events immediately instead of one per frame (default: false)'),
    },
    async ({ events, immediate }) => {
      const result = await bridge.sendCommand('simulate_input', {
        events,
        immediate: immediate ?? false,
      }) as { executed: number; errors: string[] };

      let text = `Queued ${result.executed} event(s).`;
      if (result.errors.length > 0) {
        text += `\nErrors:\n${result.errors.join('\n')}`;
      }

      return { content: [{ type: 'text' as const, text }] };
    }
  );

  // --- set_game_state ---
  server.tool(
    'set_game_state',
    'Modify a game variable at runtime. Only works for paths in the developer-configured mutable_paths whitelist.',
    {
      path: z.string().describe('Dot-separated path to the variable (e.g., "player.health")'),
      value: z.any().describe('The new value to set'),
    },
    async ({ path, value }) => {
      const result = await bridge.sendCommand('set_game_state', { path, value }) as {
        previous_value: unknown; new_value: unknown;
      };
      return {
        content: [{
          type: 'text' as const,
          text: `Updated ${path}:\n  Previous: ${JSON.stringify(result.previous_value)}\n  New: ${JSON.stringify(result.new_value)}`,
        }],
      };
    }
  );

  // --- pause ---
  server.tool(
    'pause',
    'Pause the game loop. love.update is skipped but rendering and MCP communication continue.',
    {},
    async () => {
      const result = await bridge.sendCommand('pause', {}) as { paused: boolean };
      return {
        content: [{ type: 'text' as const, text: `Game paused: ${result.paused}` }],
      };
    }
  );

  // --- resume ---
  server.tool(
    'resume',
    'Resume the game loop after pausing.',
    {},
    async () => {
      const result = await bridge.sendCommand('resume', {}) as { paused: boolean };
      return {
        content: [{ type: 'text' as const, text: `Game paused: ${result.paused}` }],
      };
    }
  );

  // --- step_frame ---
  server.tool(
    'step_frame',
    'Advance exactly N frames while the game is paused. Essential for deterministic testing.',
    {
      count: z.number().int().min(1).max(1000).optional()
        .describe('Number of frames to advance (default: 1)'),
    },
    async ({ count }) => {
      const result = await bridge.sendCommand('step_frame', {
        count: count ?? 1,
      }) as { frames_queued: number; game_time: number };

      return {
        content: [{
          type: 'text' as const,
          text: `Stepped ${result.frames_queued} frame(s). Game time: ${result.game_time.toFixed(4)}s`,
        }],
      };
    }
  );

  // --- hot_reload ---
  server.tool(
    'hot_reload',
    'Trigger a hot-reload of Lua source files without restarting the game.',
    {
      files: z.array(z.string()).optional()
        .describe('Specific files to reload (e.g., ["player.lua", "enemy.lua"]). Omit to reload all loaded modules.'),
    },
    async ({ files }) => {
      const result = await bridge.sendCommand('hot_reload', {
        files: files ?? [],
      }) as { reloaded: string[]; errors: string[] };

      let text = `Reloaded ${result.reloaded.length} module(s).`;
      if (result.reloaded.length > 0) {
        text += `\n  ${result.reloaded.join('\n  ')}`;
      }
      if (result.errors.length > 0) {
        text += `\nErrors:\n  ${result.errors.join('\n  ')}`;
      }

      return { content: [{ type: 'text' as const, text }] };
    }
  );
}

// ==========================================================================
// Management Tools — Process Control
// ==========================================================================

function registerManagementTools(server: McpServer, bridge: GameBridge): void {

  // --- start_game ---
  server.tool(
    'start_game',
    'Launch the Love2D game process. The game will start with MCP integration enabled.',
    {
      gamePath: z.string().optional()
        .describe('Path to the game directory (default: auto-detect from current working directory)'),
      lovePath: z.string().optional()
        .describe('Path to love.exe (default: "C:\\Program Files\\LOVE\\love.exe")'),
    },
    async ({ gamePath, lovePath }) => {
      if (gameProcess && !gameProcess.killed) {
        return {
          content: [{ type: 'text' as const, text: 'Game is already running.' }],
        };
      }

      const gameDir = gamePath || 'C:\\Users\\Camden\\Documents\\MyGame\\CubicleAndCauldron';
      const loveExe = lovePath || 'C:\\Program Files\\LOVE\\love.exe';

      try {
        // Ensure the game directory exists
        const fs = await import('fs');
        if (!fs.existsSync(gameDir)) {
          return {
            content: [{ type: 'text' as const, text: `Game directory not found: ${gameDir}` }],
          };
        }

        // Check if main.lua exists
        const mainLuaPath = `${gameDir}\\main.lua`;
        if (!fs.existsSync(mainLuaPath)) {
          return {
            content: [{ type: 'text' as const, text: `main.lua not found in: ${mainLuaPath}` }],
          };
        }

        logger.info(`Starting game from: ${gameDir}`);
        logger.info(`Using Love2D: ${loveExe}`);

        // Try launching with the directory path instead of "."
        gameProcess = spawn(loveExe, [gameDir], {
          detached: true,
          stdio: 'ignore',
        });

        logger.info(`Game process spawned with PID: ${gameProcess.pid}`);

        // Wait for the game to start and MCP to connect
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds
        const checkInterval = 1000;

        const checkConnection = async () => {
          attempts++;
          try {
            // Try to send a simple command to see if the game is connected
            await bridge.sendCommand('get_game_info', {});
            logger.info('Game MCP connection established');
            return true;
          } catch (err) {
            if (attempts >= maxAttempts) {
              logger.error(`Game failed to connect after ${maxAttempts} seconds`);
              return false;
            }
            // Wait and try again
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            return checkConnection();
          }
        };

        const connected = await checkConnection();

        if (!connected) {
          // Kill the process if it didn't connect
          try {
            gameProcess.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!gameProcess.killed) {
              gameProcess.kill('SIGKILL');
            }
          } catch (err) {
            logger.error('Failed to kill unresponsive game process:', err);
          }
          gameProcess = null;
          return {
            content: [{ type: 'text' as const, text: `Game started but MCP connection failed. The game may have crashed or MCP failed to initialize.` }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: `Game started successfully from ${gameDir}. PID: ${gameProcess.pid}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to start game: ${(err as Error).message}` }],
        };
      }
    }
  );

  // --- stop_game ---
  server.tool(
    'stop_game',
    'Stop the running Love2D game process.',
    {},
    async () => {
      if (!gameProcess || gameProcess.killed) {
        return {
          content: [{ type: 'text' as const, text: 'No game process is currently running.' }],
        };
      }

      try {
        gameProcess.kill('SIGTERM');
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!gameProcess.killed) {
          gameProcess.kill('SIGKILL');
        }

        const pid = gameProcess.pid;
        gameProcess = null;

        return {
          content: [{ type: 'text' as const, text: `Game stopped successfully. PID: ${pid}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to stop game: ${(err as Error).message}` }],
        };
      }
    }
  );

  // --- start_server ---
  server.tool(
    'start_server',
    'Launch the MCP server process. Note: This tool is usually not needed since the server should already be running.',
    {
      serverPath: z.string().optional()
        .describe('Path to the server directory (default: auto-detect)'),
    },
    async ({ serverPath }) => {
      if (serverProcess && !serverProcess.killed) {
        return {
          content: [{ type: 'text' as const, text: 'Server is already running.' }],
        };
      }

      const serverDir = serverPath || process.cwd();

      try {
        serverProcess = spawn('node', ['dist/index.js'], {
          cwd: serverDir,
          detached: true,
          stdio: 'ignore',
        });

        serverProcess.on('error', (err) => {
          logger.error('Failed to start server:', err);
        });

        serverProcess.on('exit', (code) => {
          logger.info(`Server exited with code ${code}`);
          serverProcess = null;
        });

        // Give it a moment to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        return {
          content: [{ type: 'text' as const, text: `Server started successfully. PID: ${serverProcess.pid}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to start server: ${(err as Error).message}` }],
        };
      }
    }
  );

  // --- stop_server ---
  server.tool(
    'stop_server',
    'Stop the running MCP server process.',
    {},
    async () => {
      if (!serverProcess || serverProcess.killed) {
        return {
          content: [{ type: 'text' as const, text: 'No server process is currently running.' }],
        };
      }

      try {
        serverProcess.kill('SIGTERM');
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }

        const pid = serverProcess.pid;
        serverProcess = null;

        return {
          content: [{ type: 'text' as const, text: `Server stopped successfully. PID: ${pid}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to stop server: ${(err as Error).message}` }],
        };
      }
    }
  );

  // --- get_status ---
  server.tool(
    'get_status',
    'Get the current status of the game and server processes.',
    {},
    async () => {
      const gameRunning = gameProcess && !gameProcess.killed;
      const serverRunning = serverProcess && !serverProcess.killed;

      let status = 'Status:\n';
      status += `Game: ${gameRunning ? 'Running' : 'Not running'}`;
      if (gameRunning && gameProcess) {
        status += ` (PID: ${gameProcess.pid})`;
      }
      status += '\n';
      status += `Server: ${serverRunning ? 'Running' : 'Not running'}`;
      if (serverRunning && serverProcess) {
        status += ` (PID: ${serverProcess.pid})`;
      }

      return {
        content: [{ type: 'text' as const, text: status }],
      };
    }
  );
}

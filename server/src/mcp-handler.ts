/**
 * MCP Handler — registers tools and dispatches MCP tool calls to the game bridge.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import type { GameBridge } from './game-bridge.js';
import { logger } from './utils/logger.js';

// Track running game process
let gameProcess: ChildProcess | null = null;

/**
 * Auto-detect the Love2D executable by searching common install locations per OS.
 * Returns the path if found, or null.
 */
function detectLovePath(): string | null {
  const platform = os.platform();

  // Check if 'love' is on PATH first (works on all platforms)
  try {
    const cmd = platform === 'win32' ? 'where love' : 'which love';
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (result) {
      const firstLine = result.split('\n')[0].trim();
      if (fs.existsSync(firstLine)) return firstLine;
    }
  } catch {
    // Not on PATH, check common locations
  }

  const candidates: string[] = [];

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\LOVE\\love.exe',
      'C:\\Program Files (x86)\\LOVE\\love.exe',
      path.join(os.homedir(), 'scoop', 'apps', 'love', 'current', 'love.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/love.app/Contents/MacOS/love',
      path.join(os.homedir(), 'Applications', 'love.app', 'Contents', 'MacOS', 'love'),
    );
  } else {
    // Linux — typically on PATH (checked above), but check common spots
    candidates.push(
      '/usr/bin/love',
      '/usr/local/bin/love',
      '/snap/bin/love',
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Coerce a value that may have arrived as a string from an MCP client into
 * its likely intended primitive type. Recurses into arrays and plain objects.
 *
 * MCP clients (including Claude) frequently pass numbers and booleans as
 * JSON strings when the tool schema uses an unconstrained `z.any()`. Without
 * this, set_game_state would write `"10"` instead of `10`.
 */
export function coerceValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    // Numeric strings: must be a finite number and round-trip cleanly so we
    // don't accidentally turn "01" or "1.0abc" or "" into a number.
    if (value !== '' && /^-?\d+(\.\d+)?$/.test(value)) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(coerceValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = coerceValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Kill a child process in a cross-platform way.
 */
function killProcess(proc: ChildProcess): void {
  if (!proc.pid) return;

  if (os.platform() === 'win32') {
    try {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { timeout: 5000 });
    } catch {
      // Process may have already exited
    }
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {
      // Already dead
    }
  }
}

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
      // MCP clients often pass numeric/boolean values as strings because the
      // z.any() schema is unconstrained. Coerce common cases so Lua receives
      // the correct type.
      const coerced = coerceValue(value);
      const result = await bridge.sendCommand('set_game_state', { path, value: coerced }) as {
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
        .describe('Path to the game directory containing main.lua'),
      lovePath: z.string().optional()
        .describe('Path to the Love2D executable (auto-detected if not provided)'),
    },
    async ({ gamePath, lovePath }) => {
      if (gameProcess && !gameProcess.killed) {
        return {
          content: [{ type: 'text' as const, text: 'Game is already running.' }],
        };
      }

      // Resolve game directory: explicit arg > env var > error
      const gameDir = gamePath
        || process.env.LOVE_MCP_GAME_PATH
        || null;

      if (!gameDir) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No game path provided. Pass gamePath, or set the LOVE_MCP_GAME_PATH environment variable.',
          }],
        };
      }

      // Resolve Love2D executable: explicit arg > env var > auto-detect > error
      const loveExe = lovePath
        || process.env.LOVE_MCP_LOVE_PATH
        || detectLovePath();

      if (!loveExe) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Could not find Love2D. Install it and ensure it\'s on your PATH, pass lovePath, or set the LOVE_MCP_LOVE_PATH environment variable.',
          }],
        };
      }

      try {
        const resolvedGameDir = path.resolve(gameDir);

        if (!fs.existsSync(resolvedGameDir)) {
          return {
            content: [{ type: 'text' as const, text: `Game directory not found: ${resolvedGameDir}` }],
          };
        }

        const mainLuaPath = path.join(resolvedGameDir, 'main.lua');
        if (!fs.existsSync(mainLuaPath)) {
          return {
            content: [{ type: 'text' as const, text: `main.lua not found in: ${resolvedGameDir}` }],
          };
        }

        logger.info(`Starting game from: ${resolvedGameDir}`);
        logger.info(`Using Love2D: ${loveExe}`);

        gameProcess = spawn(loveExe, [resolvedGameDir], {
          detached: true,
          stdio: 'ignore',
        });

        gameProcess.on('exit', () => { gameProcess = null; });

        logger.info(`Game process spawned with PID: ${gameProcess.pid}`);

        // Wait for the game to start and MCP to connect
        let attempts = 0;
        const maxAttempts = 30;
        const checkInterval = 1000;

        const checkConnection = async (): Promise<boolean> => {
          attempts++;
          try {
            await bridge.sendCommand('get_game_info', {});
            logger.info('Game MCP connection established');
            return true;
          } catch {
            if (attempts >= maxAttempts) {
              logger.error(`Game failed to connect after ${maxAttempts} seconds`);
              return false;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            return checkConnection();
          }
        };

        const connected = await checkConnection();

        if (!connected) {
          if (gameProcess) {
            killProcess(gameProcess);
            gameProcess = null;
          }
          return {
            content: [{ type: 'text' as const, text: 'Game started but MCP connection failed. The game may have crashed or love_mcp failed to initialize.' }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: `Game started successfully from ${resolvedGameDir}. PID: ${gameProcess?.pid}` }],
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
        const pid = gameProcess.pid;
        killProcess(gameProcess);
        // Give it a moment to die
        await new Promise(resolve => setTimeout(resolve, 1000));
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

  // --- get_status ---
  server.tool(
    'get_status',
    'Get the current status of the game and server processes.',
    {},
    async () => {
      const gameRunning = gameProcess && !gameProcess.killed;
      const detectedLove = detectLovePath();

      let status = 'Status:\n';
      status += `Game: ${gameRunning ? 'Running' : 'Not running'}`;
      if (gameRunning && gameProcess) {
        status += ` (PID: ${gameProcess.pid})`;
      }
      status += '\n';
      status += `Love2D: ${detectedLove || 'Not found (set LOVE_MCP_LOVE_PATH or install Love2D)'}`;
      status += '\n';
      status += `Platform: ${os.platform()} (${os.arch()})`;

      return {
        content: [{ type: 'text' as const, text: status }],
      };
    }
  );
}

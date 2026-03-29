/**
 * MCP Handler — registers tools and dispatches MCP tool calls to the game bridge.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GameBridge } from './game-bridge.js';
import { logger } from './utils/logger.js';

/**
 * Register all MCP tools on the given server.
 */
export function registerTools(server: McpServer, bridge: GameBridge): void {
  registerPhase1Tools(server, bridge);
  registerPhase2Tools(server, bridge);
}

// ==========================================================================
// Phase 1 — Core Observability
// ==========================================================================

function registerPhase1Tools(server: McpServer, bridge: GameBridge): void {

  // --- screenshot ---
  server.tool(
    'screenshot',
    'Capture the current game frame as a base64-encoded PNG image.',
    {
      scale: z.number().min(0.1).max(4.0).optional()
        .describe('Scale factor for the screenshot (default: 1.0)'),
    },
    async ({ scale }) => {
      const result = await bridge.sendCommand('screenshot', { scale: scale ?? 1.0 }) as {
        image: string; width: number; height: number; format: string;
      };

      return {
        content: [
          {
            type: 'image' as const,
            data: result.image,
            mimeType: 'image/png',
          },
          {
            type: 'text' as const,
            text: `Screenshot captured: ${result.width}x${result.height} ${result.format}`,
          },
        ],
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

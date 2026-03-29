#!/usr/bin/env node
/**
 * love2d-mcp — MCP server entry point.
 *
 * Sets up the MCP server on stdio and connects to the Love2D game via TCP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GameBridge } from './game-bridge.js';
import { registerTools } from './mcp-handler.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();

  logger.info('love2d-mcp server starting...');
  logger.info(`Game bridge target: ${config.gameHost}:${config.gamePort}`);

  // Create the game bridge (TCP connection to Love2D)
  const bridge = new GameBridge(config);

  // Attempt initial connection — don't fail if the game isn't running yet
  try {
    await bridge.connect();
    logger.info('Initial connection to game established');
  } catch (err) {
    logger.warn(
      `Could not connect to game at startup (${(err as Error).message}). ` +
      'Tools will attempt to reconnect when called.'
    );
  }

  // Auto-reconnect on disconnect
  bridge.on('disconnected', () => {
    logger.info('Game disconnected. Will attempt reconnection on next tool call.');
  });

  // Log game events
  bridge.on('game-event', (event) => {
    logger.debug('Game event:', event.event, event.data);
  });

  // Create the MCP server
  const server = new McpServer({
    name: 'love2d-mcp',
    version: '0.1.0',
  });

  // Register all tools, wrapping them with auto-reconnect logic
  const reconnectingBridge = new Proxy(bridge, {
    get(target, prop, receiver) {
      if (prop === 'sendCommand') {
        return async (command: string, params: Record<string, unknown>) => {
          // Try to reconnect if not connected
          if (!target.connected) {
            try {
              logger.info('Attempting to reconnect to game...');
              await target.connect();
            } catch (err) {
              throw new Error(
                'Cannot reach the Love2D game. Make sure your game is running with love_mcp initialized. ' +
                `(${(err as Error).message})`
              );
            }
          }
          return target.sendCommand(command, params);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as GameBridge;

  registerTools(server, reconnectingBridge);

  // Start the MCP server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP server running on stdio');
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});

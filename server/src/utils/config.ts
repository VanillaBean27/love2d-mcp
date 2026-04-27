/**
 * Configuration for the MCP server.
 */

export interface ServerConfig {
  /** TCP port to connect to the Love2D game (default: 21110) */
  gamePort: number;

  /** TCP host for the Love2D game connection (default: 127.0.0.1) */
  gameHost: string;

  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout: number;

  /** Heartbeat interval in milliseconds (default: 5000) */
  heartbeatInterval: number;

  /** Heartbeat timeout — disconnect if no response within this time (default: 30000) */
  heartbeatTimeout: number;

  /** Maximum payload size in bytes (default: 4MB) */
  maxPayloadSize: number;

  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout: number;
}

export function loadConfig(): ServerConfig {
  return {
    gamePort: parseInt(process.env.LOVE_MCP_PORT || '21110', 10),
    gameHost: process.env.LOVE_MCP_HOST || '127.0.0.1',
    connectTimeout: parseInt(process.env.LOVE_MCP_CONNECT_TIMEOUT || '5000', 10),
    heartbeatInterval: parseInt(process.env.LOVE_MCP_HEARTBEAT_INTERVAL || '5000', 10),
    heartbeatTimeout: parseInt(process.env.LOVE_MCP_HEARTBEAT_TIMEOUT || '30000', 10),
    maxPayloadSize: parseInt(process.env.LOVE_MCP_MAX_PAYLOAD || String(4 * 1024 * 1024), 10),
    requestTimeout: parseInt(process.env.LOVE_MCP_REQUEST_TIMEOUT || '30000', 10),
  };
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.LOVE_MCP_PORT;
    delete process.env.LOVE_MCP_HOST;
    delete process.env.LOVE_MCP_CONNECT_TIMEOUT;
    delete process.env.LOVE_MCP_HEARTBEAT_INTERVAL;
    delete process.env.LOVE_MCP_HEARTBEAT_TIMEOUT;
    delete process.env.LOVE_MCP_MAX_PAYLOAD;
    delete process.env.LOVE_MCP_REQUEST_TIMEOUT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns defaults when no env vars are set', () => {
    const config = loadConfig();
    expect(config.gamePort).toBe(21110);
    expect(config.gameHost).toBe('127.0.0.1');
    expect(config.connectTimeout).toBe(5000);
    expect(config.heartbeatInterval).toBe(5000);
    expect(config.heartbeatTimeout).toBe(30000);
    expect(config.maxPayloadSize).toBe(4 * 1024 * 1024);
    expect(config.requestTimeout).toBe(30000);
  });

  it('reads values from environment variables', () => {
    process.env.LOVE_MCP_PORT = '9999';
    process.env.LOVE_MCP_HOST = '0.0.0.0';
    process.env.LOVE_MCP_CONNECT_TIMEOUT = '10000';
    process.env.LOVE_MCP_REQUEST_TIMEOUT = '60000';

    const config = loadConfig();
    expect(config.gamePort).toBe(9999);
    expect(config.gameHost).toBe('0.0.0.0');
    expect(config.connectTimeout).toBe(10000);
    expect(config.requestTimeout).toBe(60000);
  });
});

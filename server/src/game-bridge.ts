/**
 * Game Bridge — TCP client that connects to the Love2D game's MCP socket.
 *
 * Handles connection lifecycle, message framing, request/response correlation,
 * heartbeats, and reconnection.
 */

import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { encodeMessage, MessageDecoder } from './protocol/framing.js';
import type { GameMessage, GameRequest } from './protocol/messages.js';
import type { ServerConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class GameBridge extends EventEmitter {
  private config: ServerConfig;
  private socket: net.Socket | null = null;
  private decoder: MessageDecoder;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatResponse: number = 0;
  private _connected: boolean = false;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
    this.decoder = new MessageDecoder(config.maxPayloadSize);
  }

  /** Whether the bridge is currently connected to the game. */
  get connected(): boolean {
    return this._connected;
  }

  /** Attempt to connect to the Love2D game's TCP socket. */
  async connect(): Promise<void> {
    if (this._connected) return;

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout after ${this.config.connectTimeout}ms`));
      }, this.config.connectTimeout);

      socket.connect(this.config.gamePort, this.config.gameHost, () => {
        clearTimeout(timeout);
        this.socket = socket;
        this._connected = true;
        this.decoder.reset();
        this.lastHeartbeatResponse = Date.now();

        logger.info(`Connected to game at ${this.config.gameHost}:${this.config.gamePort}`);

        this.startHeartbeat();
        this.emit('connected');
        resolve();
      });

      socket.on('data', (data: Buffer) => {
        try {
          const messages = this.decoder.feed(data);
          for (const msg of messages) {
            this.handleMessage(msg as GameMessage);
          }
        } catch (err) {
          logger.error('Failed to decode message', err);
        }
      });

      socket.on('error', (err: Error) => {
        clearTimeout(timeout);
        if (!this._connected) {
          reject(err);
        } else {
          logger.error('Socket error', err.message);
          this.disconnect();
        }
      });

      socket.on('close', () => {
        clearTimeout(timeout);
        if (this._connected) {
          logger.info('Game disconnected');
          this.disconnect();
        }
      });
    });
  }

  /** Disconnect from the game. */
  disconnect(): void {
    this.stopHeartbeat();

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected from game'));
    }
    this.pendingRequests.clear();

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    const wasConnected = this._connected;
    this._connected = false;
    this.decoder.reset();

    if (wasConnected) {
      this.emit('disconnected');
    }
  }

  /**
   * Send a command to the game and wait for the response.
   * @param command  The command name (e.g., "screenshot")
   * @param params   Command parameters
   * @returns        The response data
   */
  async sendCommand(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this._connected || !this.socket) {
      throw new Error('Not connected to game. Make sure your Love2D game is running with love_mcp initialized.');
    }

    const id = randomUUID();
    const request: GameRequest = {
      id,
      type: 'request',
      command,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command '${command}' timed out after ${this.config.requestTimeout}ms`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        const encoded = encodeMessage(request);
        this.socket!.write(encoded);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /** Handle an incoming message from the game. */
  private handleMessage(msg: GameMessage): void {
    // ANY incoming byte from the peer proves liveness — not just heartbeats.
    // This matters when a long-running command (e.g. hot_reload of hundreds
    // of modules) blocks love.update for many seconds: by the time the
    // response arrives, the heartbeat-only check would already have
    // declared the peer dead.
    this.lastHeartbeatResponse = Date.now();

    if (msg.type === 'heartbeat') {
      return;
    }

    if (msg.type === 'event') {
      this.emit('game-event', msg);
      return;
    }

    if (msg.type === 'response' || msg.type === 'response_chunk') {
      const id = msg.id;
      const pending = this.pendingRequests.get(id);
      if (!pending) {
        logger.warn(`Received response for unknown request: ${id}`);
        return;
      }

      // TODO: Handle response_chunk reassembly for large payloads
      if (msg.type === 'response_chunk') {
        logger.warn('Response chunking not yet implemented');
        return;
      }

      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);

      if (msg.status === 'ok') {
        pending.resolve(msg.data);
      } else {
        pending.reject(new Error(`Game error [${msg.error.code}]: ${msg.error.message}`));
      }
    }
  }

  /** Start the heartbeat interval. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this._connected || !this.socket) return;

      // If a request is in flight, the peer is busy executing it (potentially
      // a long-running operation like hot_reload of hundreds of modules that
      // blocks love.update). Don't enforce heartbeat timeout — the request
      // itself has its own timeout (requestTimeout) that will fire if the
      // peer is genuinely stuck.
      if (this.pendingRequests.size > 0) return;

      // Check for heartbeat timeout
      const elapsed = Date.now() - this.lastHeartbeatResponse;
      if (elapsed > this.config.heartbeatTimeout) {
        logger.warn(`Heartbeat timeout (${elapsed}ms), disconnecting`);
        this.disconnect();
        return;
      }

      // Send heartbeat
      try {
        const encoded = encodeMessage({
          type: 'heartbeat',
          timestamp: Date.now() / 1000,
        });
        this.socket.write(encoded);
      } catch {
        logger.error('Failed to send heartbeat');
        this.disconnect();
      }
    }, this.config.heartbeatInterval);
  }

  /** Stop the heartbeat interval. */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * Protocol message types for communication between the MCP server and the Love2D game.
 */

/** Request sent from the MCP server to the game */
export interface GameRequest {
  id: string;
  type: 'request';
  command: string;
  params: Record<string, unknown>;
}

/** Successful response from the game */
export interface GameResponse {
  id: string;
  type: 'response';
  status: 'ok';
  data: unknown;
}

/** Error response from the game */
export interface GameErrorResponse {
  id: string;
  type: 'response';
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}

/** Async event from the game (no request ID) */
export interface GameEvent {
  type: 'event';
  event: string;
  data: unknown;
}

/** Heartbeat message (bidirectional) */
export interface Heartbeat {
  type: 'heartbeat';
  timestamp: number;
}

/** Response chunk for large payloads */
export interface GameResponseChunk {
  id: string;
  type: 'response_chunk';
  chunk_index: number;
  total_chunks: number;
  data: string;
}

export type GameMessage =
  | GameResponse
  | GameErrorResponse
  | GameEvent
  | Heartbeat
  | GameResponseChunk;

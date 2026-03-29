/**
 * TCP message framing utilities.
 *
 * Protocol: 4-byte big-endian uint32 length prefix + UTF-8 JSON payload.
 */

/**
 * Encode a message object into a length-prefixed buffer.
 */
export function encodeMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Streaming message decoder.
 * Feeds raw TCP data and emits complete parsed messages.
 */
export class MessageDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private maxPayloadSize: number;

  constructor(maxPayloadSize: number = 4 * 1024 * 1024) {
    this.maxPayloadSize = maxPayloadSize;
  }

  /**
   * Feed raw bytes from the TCP socket.
   * Returns an array of decoded message objects.
   */
  feed(data: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const messages: unknown[] = [];

    while (this.buffer.length >= 4) {
      const payloadLength = this.buffer.readUInt32BE(0);

      if (payloadLength > this.maxPayloadSize) {
        throw new Error(
          `Payload too large: ${payloadLength} bytes (max: ${this.maxPayloadSize})`
        );
      }

      if (this.buffer.length < 4 + payloadLength) {
        break; // Incomplete message
      }

      const payload = this.buffer.subarray(4, 4 + payloadLength);
      this.buffer = this.buffer.subarray(4 + payloadLength);

      try {
        const message = JSON.parse(payload.toString('utf-8'));
        messages.push(message);
      } catch {
        // Skip malformed JSON
      }
    }

    return messages;
  }

  /** Reset the internal buffer. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

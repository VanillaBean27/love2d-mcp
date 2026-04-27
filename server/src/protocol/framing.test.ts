import { describe, it, expect } from 'vitest';
import { encodeMessage, MessageDecoder } from './framing.js';

describe('encodeMessage', () => {
  it('creates a 4-byte length-prefixed buffer', () => {
    const msg = { type: 'heartbeat', timestamp: 1234 };
    const buf = encodeMessage(msg);
    const payloadLen = buf.readUInt32BE(0);
    const payload = buf.subarray(4).toString('utf-8');
    expect(JSON.parse(payload)).toEqual(msg);
    expect(payloadLen).toBe(buf.length - 4);
  });

  it('handles empty object', () => {
    const buf = encodeMessage({});
    const payloadLen = buf.readUInt32BE(0);
    expect(payloadLen).toBe(2); // "{}"
  });
});

describe('MessageDecoder', () => {
  it('decodes a single complete message', () => {
    const decoder = new MessageDecoder();
    const encoded = encodeMessage({ hello: 'world' });
    const messages = decoder.feed(encoded);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ hello: 'world' });
  });

  it('decodes multiple messages in one feed', () => {
    const decoder = new MessageDecoder();
    const msg1 = encodeMessage({ id: 1 });
    const msg2 = encodeMessage({ id: 2 });
    const combined = Buffer.concat([msg1, msg2]);
    const messages = decoder.feed(combined);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ id: 1 });
    expect(messages[1]).toEqual({ id: 2 });
  });

  it('handles fragmented messages across multiple feeds', () => {
    const decoder = new MessageDecoder();
    const encoded = encodeMessage({ fragmented: true });
    // Split in the middle
    const half = Math.floor(encoded.length / 2);
    const part1 = encoded.subarray(0, half);
    const part2 = encoded.subarray(half);

    expect(decoder.feed(part1)).toHaveLength(0);
    const messages = decoder.feed(part2);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ fragmented: true });
  });

  it('handles split in the header', () => {
    const decoder = new MessageDecoder();
    const encoded = encodeMessage({ test: 'header-split' });
    // Split at byte 2 (middle of header)
    const part1 = encoded.subarray(0, 2);
    const part2 = encoded.subarray(2);

    expect(decoder.feed(part1)).toHaveLength(0);
    const messages = decoder.feed(part2);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ test: 'header-split' });
  });

  it('throws on payload exceeding max size', () => {
    const decoder = new MessageDecoder(10); // 10 byte max
    const encoded = encodeMessage({ big: 'this is way longer than 10 bytes' });
    expect(() => decoder.feed(encoded)).toThrow('Payload too large');
  });

  it('resets the buffer', () => {
    const decoder = new MessageDecoder();
    // Feed partial data
    const encoded = encodeMessage({ data: 'test' });
    decoder.feed(encoded.subarray(0, 3));
    decoder.reset();
    // Should start fresh
    const messages = decoder.feed(encodeMessage({ fresh: true }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ fresh: true });
  });

  it('skips malformed JSON payloads', () => {
    const decoder = new MessageDecoder();
    // Craft a valid-length but invalid JSON payload
    const badPayload = Buffer.from('not json!', 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(badPayload.length, 0);
    const badMessage = Buffer.concat([header, badPayload]);

    const goodMessage = encodeMessage({ good: true });
    const combined = Buffer.concat([badMessage, goodMessage]);

    const messages = decoder.feed(combined);
    // Should skip the bad one and return the good one
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ good: true });
  });
});

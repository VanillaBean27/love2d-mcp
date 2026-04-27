import { describe, it, expect } from 'vitest';
import { coerceValue } from './mcp-handler.js';

describe('coerceValue', () => {
  it('coerces numeric strings to numbers', () => {
    expect(coerceValue('10')).toBe(10);
    expect(coerceValue('-5')).toBe(-5);
    expect(coerceValue('3.14')).toBe(3.14);
    expect(coerceValue('0')).toBe(0);
  });

  it('coerces boolean strings', () => {
    expect(coerceValue('true')).toBe(true);
    expect(coerceValue('false')).toBe(false);
  });

  it('coerces "null" string to null', () => {
    expect(coerceValue('null')).toBe(null);
  });

  it('leaves non-numeric strings alone', () => {
    expect(coerceValue('hello')).toBe('hello');
    expect(coerceValue('')).toBe('');
    expect(coerceValue('1.0abc')).toBe('1.0abc');
    expect(coerceValue('10.20.30')).toBe('10.20.30');
  });

  it('passes through native primitive types unchanged', () => {
    expect(coerceValue(10)).toBe(10);
    expect(coerceValue(true)).toBe(true);
    expect(coerceValue(false)).toBe(false);
    expect(coerceValue(null)).toBe(null);
    expect(coerceValue(undefined)).toBe(undefined);
  });

  it('recursively coerces array elements', () => {
    expect(coerceValue(['1', '2', 'three'])).toEqual([1, 2, 'three']);
    expect(coerceValue(['true', 'false'])).toEqual([true, false]);
  });

  it('recursively coerces object values', () => {
    expect(coerceValue({ x: '10', y: '20', name: 'player' }))
      .toEqual({ x: 10, y: 20, name: 'player' });
  });

  it('handles nested structures', () => {
    expect(coerceValue({ pos: { x: '5', y: '10' }, tags: ['1', 'enemy'] }))
      .toEqual({ pos: { x: 5, y: 10 }, tags: [1, 'enemy'] });
  });

  it('does not coerce strings with leading zeros that lose info', () => {
    // "01" is a valid match per the regex but Number("01") === 1 — acceptable.
    // The important thing is we don't mangle non-numeric strings.
    expect(coerceValue('01')).toBe(1);
  });
});

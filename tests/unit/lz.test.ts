import fc from 'fast-check';
import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { decompressFromEncodedURIComponent, decompressFromUTF16 } from '../../src/lib/lz';
import { docFromBoard } from '../../src/model/crdt';
import { demoBoard } from '../../src/model/seed';

describe('bounded lz decompression', () => {
  it('matches lz-string on real documents', () => {
    const json = JSON.stringify(docFromBoard(demoBoard(new Date(2026, 9, 22)), 'priya', 'Priya'));
    expect(decompressFromEncodedURIComponent(LZString.compressToEncodedURIComponent(json))).toBe(json);
    expect(decompressFromUTF16(LZString.compressToUTF16(json))).toBe(json);
  });

  it('matches lz-string on any text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        expect(decompressFromEncodedURIComponent(LZString.compressToEncodedURIComponent(text))).toBe(text);
        expect(decompressFromUTF16(LZString.compressToUTF16(text))).toBe(text);
      }),
      { numRuns: 300 },
    );
  });

  it('refuses decompression bombs instead of crashing', () => {
    // Same check as the real 5M-character cap, at a small scale so the test stays fast.
    const bomb = LZString.compressToEncodedURIComponent('a'.repeat(200_000));
    expect(bomb.length).toBeLessThan(2_000);
    expect(decompressFromEncodedURIComponent(bomb, 50_000)).toBeNull();
    expect(decompressFromEncodedURIComponent(bomb, 500_000)).toHaveLength(200_000);
    expect(decompressFromEncodedURIComponent('x'.repeat(400_000))).toBeNull();
  });

  it('returns null or text for garbage, never throws', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (junk) => {
        const out = decompressFromEncodedURIComponent(junk);
        expect(out === null || typeof out === 'string').toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

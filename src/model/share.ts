import LZString from 'lz-string';
import { validateBoard } from './validate';
import type { Board } from './types';

const PREFIX = 'v1.';

/** Packs a whole board into a short, URL-safe string. No server involved. */
export function encodeBoard(board: Board): string {
  return PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(board));
}

export function decodeBoard(data: string): Board | null {
  if (!data.startsWith(PREFIX)) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(data.slice(PREFIX.length));
    return json ? validateBoard(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

export function shareUrl(board: Board, base: string): string {
  return `${base.split('#')[0]}#board=${encodeBoard(board)}`;
}

/** Reads a board from a location hash such as "#board=v1.…". */
export function boardFromHash(hash: string): Board | null {
  const m = hash.match(/^#board=(.+)$/);
  return m ? decodeBoard(m[1]) : null;
}

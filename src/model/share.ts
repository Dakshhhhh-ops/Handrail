import LZString from 'lz-string';
import { docFromBoard, materialize, validateDoc, type Doc } from './crdt';
import { validateBoard } from './validate';
import type { Board } from './types';

const V1 = 'v1.';
const V2 = 'v2.';

/** Packs a whole board document into a short, URL-safe string. No server involved. */
export function encodeDoc(doc: Doc): string {
  return V2 + LZString.compressToEncodedURIComponent(JSON.stringify(doc));
}

/** Older links held a plain board; still accepted. */
export function encodeBoard(board: Board): string {
  return V1 + LZString.compressToEncodedURIComponent(JSON.stringify(board));
}

function unpack(data: string): unknown {
  try {
    const json = LZString.decompressFromEncodedURIComponent(data);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export function decodeBoard(data: string): Board | null {
  return data.startsWith(V1) ? validateBoard(unpack(data.slice(V1.length))) : null;
}

/** Reads either link format and returns a document ready to merge. */
export function decodeShared(data: string): Doc | null {
  if (data.startsWith(V2)) return validateDoc(unpack(data.slice(V2.length)));
  const board = decodeBoard(data);
  return board ? docFromBoard(board, 'legacy', null) : null;
}

/** A link to the board. With `live`, opening it also joins that live session. */
export function shareUrl(doc: Doc, base: string, live?: string | null): string {
  return `${base.split('#')[0]}#board=${encodeDoc(doc)}${live ? `&live=${live}` : ''}`;
}

/** Splits "#board=v2.…&live=room" into its parts. The packed board never contains "&". */
export function parseHash(hash: string): { data: string; live: string | null } | null {
  const m = hash.match(/^#board=([^&]+)(?:&live=([a-z0-9]{8,40}))?$/);
  return m ? { data: m[1], live: m[2] ?? null } : null;
}

/** Reads a board document from a location hash such as "#board=v2.…". */
export function docFromHash(hash: string): Doc | null {
  const p = parseHash(hash);
  return p ? decodeShared(p.data) : null;
}

/** The board a link shows (either format). */
export function boardFromHash(hash: string): Board | null {
  const doc = docFromHash(hash);
  return doc ? materialize(doc) : null;
}

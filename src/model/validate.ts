import { isISODate } from './dates';
import { newId } from './board';
import type { Board, Card, Column } from './types';

export const LIMITS = { title: 200, notes: 5000, name: 60, columns: 20, cards: 1000 };

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v: unknown, max: number): string | null => {
  const s = str(v, max).trim();
  return s ? s : null;
};
const safeId = (v: unknown, prefix: string): string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : newId(prefix);

/**
 * Turns untrusted data (a shared link, an imported file, old saved data) into a
 * well-formed board, or returns null. Every card ends up in exactly one column.
 */
export function validateBoard(raw: unknown): Board | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.columns) || r.columns.length === 0) return null;
  const rawCards = r.cards && typeof r.cards === 'object' ? (r.cards as Record<string, unknown>) : {};

  const cards: Record<string, Card> = {};
  const placed = new Set<string>();
  const columns: Column[] = [];

  for (const rc of r.columns.slice(0, LIMITS.columns)) {
    if (!rc || typeof rc !== 'object') continue;
    const c = rc as Record<string, unknown>;
    const ids: string[] = [];
    for (const cid of Array.isArray(c.cardIds) ? c.cardIds : []) {
      if (typeof cid !== 'string' || placed.has(cid) || placed.size >= LIMITS.cards) continue;
      const rk = rawCards[cid];
      if (!rk || typeof rk !== 'object') continue;
      const k = rk as Record<string, unknown>;
      const title = str(k.title, LIMITS.title).trim();
      if (!title) continue;
      const id = safeId(cid, 'k');
      if (placed.has(id)) continue;
      cards[id] = {
        id,
        title,
        notes: str(k.notes, LIMITS.notes),
        due: typeof k.due === 'string' && isISODate(k.due) ? k.due : null,
        assignee: optStr(k.assignee, LIMITS.name),
        lastEditedBy: optStr(k.lastEditedBy, LIMITS.name),
        updatedAt: typeof k.updatedAt === 'number' ? k.updatedAt : 0,
      };
      placed.add(id);
      ids.push(id);
    }
    let colId = safeId(c.id, 'c');
    if (columns.some((x) => x.id === colId)) colId = newId('c');
    columns.push({ id: colId, title: str(c.title, LIMITS.title).trim() || 'Untitled', cardIds: ids });
  }
  if (columns.length === 0) return null;

  return {
    id: safeId(r.id, 'b'),
    title: str(r.title, LIMITS.title).trim() || 'Untitled board',
    columns,
    cards,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}

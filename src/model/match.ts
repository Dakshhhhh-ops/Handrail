import type { Board, Card, Column } from './types';

const STOP = new Set(['the', 'a', 'an', 'card', 'task', 'my', 'that', 'this', 'item', 'list', 'column', 'lane']);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  return normalize(s).split(' ').filter((w) => w && !STOP.has(w));
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function wordMatches(q: string, t: string): boolean {
  if (q === t) return true;
  if (q.length >= 3 && t.startsWith(q)) return true;
  if (t.length >= 4 && q.startsWith(t)) return true;
  // Speech recognition often gets one or two letters wrong ("lab raport").
  if (q.length >= 4 && editDistance(q, t) <= (q.length >= 9 ? 2 : 1)) return true;
  return false;
}

/** How well a spoken or typed phrase matches a name, from 0 to 100. */
export function matchScore(query: string, target: string): number {
  const q = words(query).join(' ');
  const t = words(target).join(' ');
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 80;
  const qw = q.split(' ');
  const tw = t.split(' ');
  const hits = qw.filter((w) => tw.some((x) => wordMatches(w, x))).length;
  if (hits === 0) return 0;
  const coverQuery = hits / qw.length;
  const coverTarget = Math.min(1, hits / tw.length);
  return Math.round(75 * coverQuery * (0.6 + 0.4 * coverTarget));
}

export interface MatchResult<T> {
  match?: T;
  /** Close candidates, best first (used to ask "which one?"). */
  candidates: T[];
  ambiguous: boolean;
}

export function bestMatch<T>(query: string, items: T[], names: (item: T) => string[], minScore = 45): MatchResult<T> {
  const scored = items
    .map((item) => ({ item, score: Math.max(0, ...names(item).map((n) => matchScore(query, n))) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { candidates: [], ambiguous: false };
  const [top, second] = scored;
  const ambiguous = !!second && top.score < 100 && second.score >= top.score - 4;
  return {
    match: ambiguous ? undefined : top.item,
    candidates: scored.slice(0, 4).map((s) => s.item),
    ambiguous,
  };
}

const COLUMN_SYNONYMS: string[][] = [
  ['done', 'finished', 'complete', 'completed', 'closed', 'shipped'],
  ['doing', 'in progress', 'progress', 'working', 'working on', 'started', 'current', 'active'],
  ['to do', 'todo', 'backlog', 'not started', 'later', 'up next', 'next'],
  ['review', 'in review', 'checking', 'waiting', 'blocked'],
];

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

export function findColumn(board: Board, query: string): MatchResult<Column> {
  const q = normalize(query).replace(/^(the )/, '').replace(/ (column|list|lane)$/, '').replace(/^(column|list|lane) /, '');
  const byNumber = q.match(/^(\d)$/);
  const ord = ORDINALS.indexOf(q);
  const idx = byNumber ? Number(byNumber[1]) - 1 : ord >= 0 ? ord : q === 'last' ? board.columns.length - 1 : -1;
  if (idx >= 0 && idx < board.columns.length) return { match: board.columns[idx], candidates: [board.columns[idx]], ambiguous: false };

  return bestMatch(q, board.columns, (c) => {
    const n = normalize(c.title);
    const group = COLUMN_SYNONYMS.find((g) => g.includes(n));
    return group ? [c.title, ...group] : [c.title];
  }, 60);
}

export function findCard(board: Board, query: string): MatchResult<Card> {
  const all = board.columns.flatMap((c) => c.cardIds.map((id) => board.cards[id])).filter(Boolean);
  return bestMatch(query, all, (k) => [k.title]);
}

export function findPerson(people: string[], query: string, me: string | null): string | null {
  const q = normalize(query);
  if (['me', 'myself', 'i'].includes(q)) return me;
  const m = bestMatch(q, people, (p) => [p], 80);
  return m.match ?? null;
}

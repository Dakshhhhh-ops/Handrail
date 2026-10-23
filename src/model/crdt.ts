/**
 * Conflict-free replicated board (a state-based CRDT).
 *
 * Every editable thing on a board is a last-writer-wins register that remembers
 * its value, a Lamport clock, the device ("actor") that wrote it and that
 * person's name. Two copies of a board merge by keeping, for each register, the
 * write with the higher (clock, actor). That merge is commutative, associative
 * and idempotent, so teammates who swap share links in any order, any number of
 * times, always end up with the same board. No server decides who wins.
 *
 * Card and column order uses fractional indexing: each item has a string key
 * and the list is sorted by key, so moving one card writes one register instead
 * of renumbering the whole column (the approach Figma and Linear describe).
 *
 * The rest of the app keeps working with plain `Board` views: `materialize`
 * turns a document into a view, and `commit` turns an edited view back into the
 * smallest set of register writes.
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { isISODate } from './dates';
import type { Board, Card, Column } from './types';

export interface Reg<T> {
  /** The value. */
  v: T;
  /** Lamport clock of the write. */
  c: number;
  /** Wall-clock time of the write (ms). Breaks ties between concurrent writes: the later one wins. */
  t: number;
  /** Actor (device) id of the writer; breaks ties between equal clocks. */
  a: string;
  /** Display name of the person who wrote it, for "Riya moved…". */
  by: string | null;
}

export interface Place {
  col: string;
  pos: string;
}

export interface CardRec {
  title: Reg<string>;
  notes: Reg<string>;
  due: Reg<string | null>;
  assignee: Reg<string | null>;
  place: Reg<Place>;
  alive: Reg<boolean>;
}

export interface ColRec {
  title: Reg<string>;
  pos: Reg<string>;
  alive: Reg<boolean>;
}

/** Highest clock seen from each actor. */
export type VersionVector = Record<string, number>;

export interface Doc {
  kind: 'handrail-doc';
  v: 2;
  id: string;
  title: Reg<string>;
  cols: Record<string, ColRec>;
  cards: Record<string, CardRec>;
  clock: number;
  vv: VersionVector;
}

export type CardField = 'title' | 'notes' | 'due' | 'assignee';
export const CARD_FIELDS: CardField[] = ['title', 'notes', 'due', 'assignee'];

// ---- Registers ---------------------------------------------------------------

/**
 * True when write x should win over write y. The Lamport clock respects cause and
 * effect (an edit made after seeing another always wins); for concurrent edits the
 * later real time wins; the actor id settles exact ties. A total order, so every
 * replica agrees.
 */
export function wins(x: Reg<unknown>, y: Reg<unknown>): boolean {
  if (x.c !== y.c) return x.c > y.c;
  if (x.t !== y.t) return x.t > y.t;
  if (x.a !== y.a) return x.a > y.a;
  // Same device, same moment (two tabs share a device id): compare the values so every replica still agrees.
  return JSON.stringify(x.v) > JSON.stringify(y.v);
}

function pick<T>(x: Reg<T>, y: Reg<T>): Reg<T> {
  return wins(y, x) ? y : x;
}

const NONE = { c: 0, t: 0, a: '', by: null } as const;

export function emptyDoc(id: string): Doc {
  return { kind: 'handrail-doc', v: 2, id, title: { v: '', ...NONE }, cols: {}, cards: {}, clock: 0, vv: {} };
}

// ---- Merge -------------------------------------------------------------------

function mergeCol(x: ColRec | undefined, y: ColRec | undefined): ColRec {
  if (!x) return y!;
  if (!y) return x;
  return { title: pick(x.title, y.title), pos: pick(x.pos, y.pos), alive: pick(x.alive, y.alive) };
}

function mergeCard(x: CardRec | undefined, y: CardRec | undefined): CardRec {
  if (!x) return y!;
  if (!y) return x;
  return {
    title: pick(x.title, y.title),
    notes: pick(x.notes, y.notes),
    due: pick(x.due, y.due),
    assignee: pick(x.assignee, y.assignee),
    place: pick(x.place, y.place),
    alive: pick(x.alive, y.alive),
  };
}

/** Joins two replicas of the same board. Order of arguments never matters. */
export function mergeDocs(a: Doc, b: Doc): Doc {
  if (a.id !== b.id) throw new Error('Cannot merge two different boards');
  const cols: Record<string, ColRec> = {};
  for (const id of new Set([...Object.keys(a.cols), ...Object.keys(b.cols)])) cols[id] = mergeCol(a.cols[id], b.cols[id]);
  const cards: Record<string, CardRec> = {};
  for (const id of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) cards[id] = mergeCard(a.cards[id], b.cards[id]);
  const vv: VersionVector = { ...a.vv };
  for (const [actor, c] of Object.entries(b.vv)) vv[actor] = Math.max(vv[actor] ?? 0, c);
  return { kind: 'handrail-doc', v: 2, id: a.id, title: pick(a.title, b.title), cols, cards, clock: Math.max(a.clock, b.clock), vv };
}

// ---- Materialize -----------------------------------------------------------

const byKey = (ka: string, ia: string, kb: string, ib: string) => (ka < kb ? -1 : ka > kb ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0);

function latest(rec: CardRec): Reg<unknown> {
  return [rec.title, rec.notes, rec.due, rec.assignee, rec.place, rec.alive].reduce((m, r) => (wins(r, m) ? r : m));
}

/** Turns a document into the plain board the UI works with. */
export function materialize(doc: Doc): Board {
  const allCols = Object.entries(doc.cols).sort(([ia, a], [ib, b]) => byKey(a.pos.v, ia, b.pos.v, ib));
  let alive = allCols.filter(([, r]) => r.alive.v);
  // If concurrent deletes removed every column, show the last one rather than hiding every card.
  if (alive.length === 0 && allCols.length) alive = [allCols[allCols.length - 1]];
  const columns: Column[] = alive.map(([id, r]) => ({ id, title: r.title.v, cardIds: [] }));
  const index = new Map(columns.map((c, i) => [c.id, i]));

  // Cards whose column was deleted (or never arrived) show in the nearest
  // living column to its left, so nothing is ever lost.
  const home = (colId: string): number => {
    const direct = index.get(colId);
    if (direct !== undefined) return direct;
    const at = allCols.findIndex(([id]) => id === colId);
    if (at < 0) return 0;
    for (let i = at - 1; i >= 0; i--) {
      const j = index.get(allCols[i][0]);
      if (j !== undefined) return j;
    }
    return 0;
  };

  const cards: Record<string, Card> = {};
  if (columns.length) {
    const placed = Object.entries(doc.cards)
      .filter(([, r]) => r.alive.v)
      .sort(([ia, a], [ib, b]) => byKey(a.place.v.pos, ia, b.place.v.pos, ib));
    for (const [id, r] of placed) {
      const last = latest(r);
      cards[id] = {
        id,
        title: r.title.v,
        notes: r.notes.v,
        due: r.due.v,
        assignee: r.assignee.v,
        lastEditedBy: last.by,
        updatedAt: last.c,
        fieldBy: { title: r.title.by, notes: r.notes.by, due: r.due.by, assignee: r.assignee.by, place: r.place.by, alive: r.alive.by },
      };
      columns[home(r.place.v.col)].cardIds.push(id);
    }
  }
  const removed: Record<string, { title: string; by: string | null }> = {};
  for (const [id, r] of Object.entries(doc.cards)) if (!r.alive.v) removed[id] = { title: r.title.v, by: r.alive.by };
  return { id: doc.id, title: doc.title.v || 'Untitled board', columns, cards, updatedAt: doc.clock, titleBy: doc.title.by, removed };
}

// ---- Commit ----------------------------------------------------------------

/** Indices of a longest strictly increasing run of keys (nulls are skipped). O(n log n). */
export function lisIndices(keys: (string | null)[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(keys.length).fill(-1);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === null) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[tails[mid]]! < k) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * Gives every item a sort key. Items whose existing keys are already in order
 * keep them; the others get new keys between their neighbours. Items marked
 * `moved` (the ones the user actually moved) never keep their old key, so a
 * move rewrites the moved card's position and not its neighbour's.
 */
export function assignKeys(existing: (string | null)[], moved: boolean[] = []): string[] {
  const candidates = existing.map((k, i) => (moved[i] ? null : k));
  const keep = lisIndices(candidates);
  const out: string[] = new Array(existing.length);
  let i = 0;
  while (i < existing.length) {
    if (keep.has(i)) {
      out[i] = existing[i]!;
      i++;
      continue;
    }
    // A run of items needing keys: generate them together so keys stay short.
    let j = i;
    while (j < existing.length && !keep.has(j)) j++;
    const keys = generateNKeysBetween(i > 0 ? out[i - 1] : null, j < existing.length ? existing[j] : null, j - i);
    for (let k = i; k < j; k++) out[k] = keys[k - i];
    i = j;
  }
  return out;
}

/**
 * Records the difference between the document and an edited board view as new
 * register writes by `actor`. Returns the same document when nothing changed.
 */
export function commit(doc: Doc, after: Board, actor: string, by: string | null, now = Date.now()): Doc {
  const c = doc.clock + 1;
  const reg = <T,>(v: T): Reg<T> => ({ v, c, t: now, a: actor, by });
  const next: Doc = { ...doc, cols: { ...doc.cols }, cards: { ...doc.cards } };
  let dirty = false;

  if (doc.title.v !== after.title) {
    next.title = reg(after.title);
    dirty = true;
  }

  // Columns
  const colKeys = assignKeys(after.columns.map((col) => (doc.cols[col.id]?.alive.v ? doc.cols[col.id].pos.v : null)));
  after.columns.forEach((col, i) => {
    const rec = doc.cols[col.id];
    if (!rec) {
      next.cols[col.id] = { title: reg(col.title), pos: reg(colKeys[i]), alive: reg(true) };
      dirty = true;
      return;
    }
    const patch = { ...rec };
    let changed = false;
    if (!rec.alive.v) { patch.alive = reg(true); changed = true; }
    if (rec.title.v !== col.title) { patch.title = reg(col.title); changed = true; }
    if (rec.pos.v !== colKeys[i]) { patch.pos = reg(colKeys[i]); changed = true; }
    if (changed) { next.cols[col.id] = patch; dirty = true; }
  });
  const keptCols = new Set(after.columns.map((col) => col.id));
  for (const [id, rec] of Object.entries(doc.cols)) {
    if (rec.alive.v && !keptCols.has(id)) {
      next.cols[id] = { ...rec, alive: reg(false) };
      dirty = true;
    }
  }

  // Cards. A card counts as moved by this edit if the edit touched it and its column or position changed.
  const before = materialize(doc);
  const beforeIndex = new Map<string, string>();
  for (const col of before.columns) col.cardIds.forEach((id, i) => beforeIndex.set(id, `${col.id}:${i}`));
  const seenCards = new Set<string>();
  for (const col of after.columns) {
    const keys = assignKeys(
      col.cardIds.map((id) => {
        const rec = doc.cards[id];
        return rec && rec.alive.v && rec.place.v.col === col.id ? rec.place.v.pos : null;
      }),
      col.cardIds.map((id, i) => {
        const was = before.cards[id];
        const now = after.cards[id];
        return !!was && !!now && now.updatedAt !== was.updatedAt && beforeIndex.get(id) !== `${col.id}:${i}`;
      }),
    );
    col.cardIds.forEach((id, i) => {
      seenCards.add(id);
      const card = after.cards[id];
      if (!card) return;
      const place: Place = { col: col.id, pos: keys[i] };
      const rec = doc.cards[id];
      if (!rec) {
        next.cards[id] = {
          title: reg(card.title), notes: reg(card.notes), due: reg(card.due), assignee: reg(card.assignee),
          place: reg(place), alive: reg(true),
        };
        dirty = true;
        return;
      }
      const patch: CardRec = { ...rec };
      let changed = false;
      if (!rec.alive.v) { patch.alive = reg(true); changed = true; }
      for (const f of CARD_FIELDS) {
        if (rec[f].v !== card[f]) {
          (patch[f] as Reg<string | null>) = reg(card[f]);
          changed = true;
        }
      }
      if (rec.place.v.col !== place.col || rec.place.v.pos !== place.pos) { patch.place = reg(place); changed = true; }
      if (changed) { next.cards[id] = patch; dirty = true; }
    });
  }
  for (const [id, rec] of Object.entries(doc.cards)) {
    if (rec.alive.v && !seenCards.has(id)) {
      next.cards[id] = { ...rec, alive: reg(false) };
      dirty = true;
    }
  }

  if (!dirty) return doc;
  next.clock = c;
  next.vv = { ...doc.vv, [actor]: c };
  return next;
}

/** A brand-new document holding `board`, written by `actor`. */
export function docFromBoard(board: Board, actor: string, by: string | null, now = Date.now()): Doc {
  return commit(emptyDoc(board.id), board, actor, by, now);
}

// ---- Conflicts ---------------------------------------------------------------

export interface Conflict {
  cardId: string | null;
  /** 'deleted-edited': you deleted it while they changed it; 'edited-deleted': the other way round. */
  field: CardField | 'place' | 'alive' | 'title' | 'column' | 'deleted-edited' | 'edited-deleted';
  /** For column clashes: the column's id. */
  columnId?: string;
  /** Whose write was kept. */
  kept: 'yours' | 'theirs';
  /** Name on the other side of the conflict. */
  other: string | null;
}

/**
 * Finds registers that you and a teammate changed without seeing each other's
 * write. The merge still decides automatically; this only lets Handrail say so
 * in plain words instead of silently dropping someone's change.
 */
export function findConflicts(local: Doc, remote: Doc, me: string): Conflict[] {
  const out: Conflict[] = [];
  const check = <T,>(cardId: string | null, field: Conflict['field'], mine: Reg<T> | undefined, theirs: Reg<T> | undefined) => {
    if (!mine || !theirs || mine.a !== me || theirs.a === me) return;
    const theyMissedMine = mine.c > (remote.vv[me] ?? 0);
    const iMissedTheirs = theirs.c > (local.vv[theirs.a] ?? 0);
    if (!theyMissedMine || !iMissedTheirs) return;
    if (JSON.stringify(mine.v) === JSON.stringify(theirs.v)) return;
    out.push({ cardId, field, kept: wins(theirs, mine) ? 'theirs' : 'yours', other: theirs.by });
  };
  check(null, 'title', local.title, remote.title);
  for (const [id, mine] of Object.entries(local.cols)) {
    const theirs = remote.cols[id];
    if (!theirs) continue;
    const before = out.length;
    check(null, 'column', mine.title, theirs.title);
    if (out.length > before) out[out.length - 1].columnId = id;
  }
  const unseenByThem = (r: Reg<unknown>) => r.a === me && r.c > (remote.vv[me] ?? 0);
  const unseenByMe = (r: Reg<unknown>) => r.a !== me && r.c > (local.vv[r.a] ?? 0);
  for (const [id, mine] of Object.entries(local.cards)) {
    const theirs = remote.cards[id];
    if (!theirs) continue;
    for (const f of CARD_FIELDS) check(id, f, mine[f], theirs[f]);
    check(id, 'place', mine.place, theirs.place);
    check(id, 'alive', mine.alive, theirs.alive);
    // A delete on one side while the other side was still editing the card.
    const theirEdit = [...CARD_FIELDS.map((f) => theirs[f]), theirs.place].find((r) => unseenByMe(r) && theirs.alive.v);
    const myEdit = [...CARD_FIELDS.map((f) => mine[f]), mine.place].find((r) => unseenByThem(r) && mine.alive.v);
    if (!mine.alive.v && unseenByThem(mine.alive) && theirEdit) {
      out.push({ cardId: id, field: 'deleted-edited', kept: wins(theirs.alive, mine.alive) ? 'theirs' : 'yours', other: theirEdit.by });
    } else if (!theirs.alive.v && unseenByMe(theirs.alive) && myEdit) {
      out.push({ cardId: id, field: 'edited-deleted', kept: 'theirs', other: theirs.alive.by });
    }
  }
  return out;
}

// ---- Validation of untrusted documents (links, files, storage) ------------

/** Names like "constructor" or "__proto__" would collide with built-in object properties. */
const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype));
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ACTOR_RE = /^[A-Za-z0-9_-]{0,40}$/;
const ID = { test: (s: string) => ID_RE.test(s) && !RESERVED.has(s) };
const ACTOR = { test: (s: string) => ACTOR_RE.test(s) && !RESERVED.has(s) };
/** Clocks stay far below 2^53 so "+1" always makes a bigger number. */
export const MAX_CLOCK = 2 ** 40;
/** Writes more than a day in the future come from a broken clock or a forged link. */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const POS = /^[0-9A-Za-z]{1,1024}$/;

function validKey(k: unknown): k is string {
  if (typeof k !== 'string' || !POS.test(k)) return false;
  try {
    generateKeyBetween(k, null);
    return true;
  } catch {
    return false;
  }
}

function vReg<T>(raw: unknown, check: (v: unknown) => v is T, max = 0): Reg<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.c !== 'number' || !Number.isInteger(r.c) || r.c < 0 || r.c > MAX_CLOCK) return null;
  // Older documents had no wall-clock time; treat it as 0.
  const t = r.t === undefined ? 0 : r.t;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > Date.now() + MAX_FUTURE_MS) return null;
  if (typeof r.a !== 'string' || !ACTOR.test(r.a)) return null;
  if (!(r.by === null || r.by === undefined || typeof r.by === 'string')) return null;
  // Over-long text is cut to size rather than throwing away the whole card.
  let v = max && typeof r.v === 'string' ? r.v.slice(0, max) : r.v;
  // Positions keep only their two known fields.
  if (v && typeof v === 'object' && 'col' in (v as object) && 'pos' in (v as object)) v = { col: (v as Place).col, pos: (v as Place).pos };
  if (!check(v)) return null;
  const by = typeof r.by === 'string' ? r.by.slice(0, 60) : null;
  return { v, c: r.c, t, a: r.a, by };
}

const str = (max: number) => (v: unknown): v is string => typeof v === 'string' && v.length <= max;
const optName = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length <= 60);
const optDue = (v: unknown): v is string | null => v === null || (typeof v === 'string' && isISODate(v));
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const place = (v: unknown): v is Place => {
  const p = v as Place;
  return !!p && typeof p === 'object' && typeof p.col === 'string' && ID.test(p.col) && validKey(p.pos);
};

/** Accepts a document from an untrusted source, or returns null. Broken entries are dropped. */
export function validateDoc(raw: unknown): Doc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'handrail-doc' || r.v !== 2 || typeof r.id !== 'string' || !ID.test(r.id)) return null;
  const title = vReg(r.title, str(200), 200);
  if (!title) return null;
  const cols: Record<string, ColRec> = {};
  for (const [id, raw] of Object.entries((r.cols as Record<string, unknown>) ?? {}).slice(0, 200)) {
    const x = raw as Record<string, unknown>;
    if (!ID.test(id) || !x) continue;
    const t = vReg(x.title, str(200), 200), p = vReg(x.pos, validKey), al = vReg(x.alive, bool);
    if (t && p && al) cols[id] = { title: t, pos: p, alive: al };
  }
  const cards: Record<string, CardRec> = {};
  for (const [id, raw] of Object.entries((r.cards as Record<string, unknown>) ?? {}).slice(0, 5000)) {
    const x = raw as Record<string, unknown>;
    if (!ID.test(id) || !x) continue;
    const rec = {
      title: vReg(x.title, str(200), 200), notes: vReg(x.notes, str(5000), 5000), due: vReg(x.due, optDue),
      assignee: vReg(x.assignee, optName, 60), place: vReg(x.place, place), alive: vReg(x.alive, bool),
    };
    if (Object.values(rec).every(Boolean)) cards[id] = rec as CardRec;
  }
  // Every receiver derives the clock and version vector from the writes themselves, the same way,
  // so a forged clock or vector can't make real updates look old.
  const regs = [title, ...Object.values(cols).flatMap((x) => [x.title, x.pos, x.alive]), ...Object.values(cards).flatMap((x) => [x.title, x.notes, x.due, x.assignee, x.place, x.alive])];
  let clock = 0;
  for (const g of regs) clock = Math.max(clock, g.c);
  const vv: VersionVector = {};
  for (const [a, c] of Object.entries((r.vv as Record<string, unknown>) ?? {}).slice(0, 200)) {
    if (ACTOR.test(a) && typeof c === 'number' && Number.isInteger(c) && c >= 0) vv[a] = Math.min(c, clock);
  }
  for (const g of regs) if (g.a) vv[g.a] = Math.max(vv[g.a] ?? 0, g.c);
  return { kind: 'handrail-doc', v: 2, id: r.id, title, cols, cards, clock, vv };
}

/**
 * Rejects (rather than trims) a teammate's document whose clock jumps implausibly far
 * ahead of ours: merging it would let one bad copy outvote every future edit.
 */
export function plausible(local: Doc | undefined, remote: Doc): boolean {
  return remote.clock <= (local?.clock ?? 0) + 1_000_000 && remote.clock <= MAX_CLOCK;
}

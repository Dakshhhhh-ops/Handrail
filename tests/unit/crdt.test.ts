import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addCard, addColumn, deleteCard, deleteColumn, moveCard, renameColumn, updateCard } from '../../src/model/board';
import {
  assignKeys, commit, docFromBoard, findConflicts, lisIndices, materialize, mergeDocs, validateDoc, type Doc,
} from '../../src/model/crdt';
import { demoBoard } from '../../src/model/seed';
import type { Board } from '../../src/model/types';

const today = new Date(2026, 9, 22);

/** The parts of a board people can see, without bookkeeping fields. */
function shape(b: Board) {
  return {
    title: b.title,
    columns: b.columns.map((c) => ({ id: c.id, title: c.title, cards: c.cardIds.map((id) => {
      const k = b.cards[id];
      return { id, title: k.title, notes: k.notes, due: k.due, assignee: k.assignee };
    }) })),
  };
}

// ---- A random edit, applied to whatever board a replica currently has -------
type Edit =
  | { t: 'move'; card: number; col: number; index: number }
  | { t: 'title'; card: number; text: string }
  | { t: 'due'; card: number; day: number | null }
  | { t: 'assign'; card: number; who: string | null }
  | { t: 'add'; col: number; text: string }
  | { t: 'delete'; card: number }
  | { t: 'renameCol'; col: number; text: string }
  | { t: 'addCol'; text: string }
  | { t: 'deleteCol'; col: number };

const edit: fc.Arbitrary<Edit> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant('move' as const), card: fc.nat(30), col: fc.nat(5), index: fc.nat(8) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('title' as const), card: fc.nat(30), text: fc.constantFrom('Slides', 'Script', 'Sources', 'Poster') }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('due' as const), card: fc.nat(30), day: fc.option(fc.integer({ min: 1, max: 28 })) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('assign' as const), card: fc.nat(30), who: fc.option(fc.constantFrom('Riya', 'Arjun', 'Priya')) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('add' as const), col: fc.nat(5), text: fc.constantFrom('New A', 'New B', 'New C') }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('delete' as const), card: fc.nat(30) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('renameCol' as const), col: fc.nat(5), text: fc.constantFrom('Backlog', 'Review', 'Shipped') }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('addCol' as const), text: fc.constantFrom('Blocked', 'Later') }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('deleteCol' as const), col: fc.nat(5) }) },
);

function applyEdit(b: Board, e: Edit, who: string): Board {
  const ids = b.columns.flatMap((c) => c.cardIds);
  const card = ids.length ? ids[('card' in e ? e.card : 0) % ids.length] : null;
  const col = b.columns.length ? b.columns[('col' in e ? e.col : 0) % b.columns.length] : null;
  switch (e.t) {
    case 'move': return card && col ? moveCard(b, card, col.id, e.index, who) : b;
    case 'title': return card ? updateCard(b, card, { title: e.text }, who) : b;
    case 'due': return card ? updateCard(b, card, { due: e.day ? `2026-11-${String(e.day).padStart(2, '0')}` : null }, who) : b;
    case 'assign': return card ? updateCard(b, card, { assignee: e.who }, who) : b;
    case 'add': return col ? addCard(b, col.id, { title: e.text }, who).board : b;
    case 'delete': return card ? deleteCard(b, card) : b;
    case 'renameCol': return col ? renameColumn(b, col.id, e.text) : b;
    case 'addCol': return b.columns.length < 6 ? addColumn(b, e.text).board : b;
    case 'deleteCol': return col ? deleteColumn(b, col.id) : b;
  }
}

/** A replica edits its own copy: change the view, then commit the difference. */
function act(doc: Doc, e: Edit, actor: string): Doc {
  return commit(doc, applyEdit(materialize(doc), e, actor), actor, actor);
}

const ACTORS = ['priya', 'riya', 'arjun'];

describe('CRDT document', () => {
  it('round-trips a board: materialize(commit(view)) shows the same board', () => {
    const b = demoBoard(today);
    expect(shape(materialize(docFromBoard(b, 'priya', 'Priya')))).toEqual(shape(b));
  });

  it('remembers who wrote each part of a card', () => {
    let doc = docFromBoard(demoBoard(today), 'priya', 'Priya');
    const v = materialize(doc);
    doc = commit(doc, moveCard(v, 'k-slides', 'c-done', 0, null), 'riya', 'Riya');
    const card = materialize(doc).cards['k-slides'];
    expect(card.fieldBy?.place).toBe('Riya');
    expect(card.fieldBy?.title).toBe('Priya');
  });

  it('moving one card writes one register and keeps every other key', () => {
    const doc = docFromBoard(demoBoard(today), 'priya', 'Priya');
    const v = materialize(doc);
    const next = commit(doc, moveCard(v, 'k-script', 'c-todo', 0, null), 'priya', 'Priya');
    const changed = Object.keys(next.cards).filter((id) => next.cards[id] !== doc.cards[id]);
    expect(changed).toEqual(['k-script']);
  });

  it('does nothing when nothing changed', () => {
    const doc = docFromBoard(demoBoard(today), 'priya', 'Priya');
    expect(commit(doc, materialize(doc), 'priya', 'Priya')).toBe(doc);
  });

  it('keeps cards of a concurrently deleted column visible', () => {
    const base = docFromBoard(demoBoard(today), 'priya', 'Priya');
    const a = commit(base, deleteColumn(materialize(base), 'c-doing'), 'priya', 'Priya');
    const b = commit(base, moveCard(materialize(base), 'k-sources', 'c-doing', 0, 'Riya'), 'riya', 'Riya');
    const merged = materialize(mergeDocs(a, b));
    expect(merged.columns.map((c) => c.title)).toEqual(['To do', 'Done']);
    expect(Object.keys(merged.cards)).toHaveLength(7);
  });
});

describe('fractional keys', () => {
  it('finds a longest increasing run', () => {
    expect([...lisIndices(['a0', 'a3', 'a1', 'a2', null, 'a4'])].sort()).toEqual([0, 2, 3, 5]);
  });

  it('only gives new keys to items that are out of order', () => {
    const keys = assignKeys(['a0', 'a3', 'a1', 'a2', null]);
    expect(keys[0]).toBe('a0');
    expect(keys[2]).toBe('a1');
    expect(keys[3]).toBe('a2');
    expect([...keys].sort()).toEqual(keys);
  });
});

describe('convergence (property-based)', () => {
  it('merge is commutative, associative and idempotent', () => {
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 8 }), fc.array(edit, { maxLength: 8 }), fc.array(edit, { maxLength: 8 }), (ea, eb, ec) => {
        const base = docFromBoard(demoBoard(today), 'seed', null);
        const [a, b, c] = [ea, eb, ec].map((es, i) => es.reduce((d, e) => act(d, e, ACTORS[i]), base));
        const ab = mergeDocs(a, b);
        expect(shape(materialize(ab))).toEqual(shape(materialize(mergeDocs(b, a))));
        expect(shape(materialize(mergeDocs(ab, c)))).toEqual(shape(materialize(mergeDocs(a, mergeDocs(b, c)))));
        expect(mergeDocs(ab, ab)).toEqual(ab);
      }),
      { numRuns: 150 },
    );
  });

  it('teammates who keep editing and swapping links in any order end up with the same board', () => {
    const step = fc.oneof(
      fc.record({ kind: fc.constant('edit' as const), who: fc.nat(2), e: edit }),
      fc.record({ kind: fc.constant('send' as const), from: fc.nat(2), to: fc.nat(2) }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const base = docFromBoard(demoBoard(today), 'seed', null);
        const docs = [base, base, base];
        for (const s of steps) {
          if (s.kind === 'edit') docs[s.who] = act(docs[s.who], s.e, ACTORS[s.who]);
          else docs[s.to] = mergeDocs(docs[s.to], docs[s.from]);
        }
        // Finally everyone sends their link to everyone.
        const all = docs.reduce(mergeDocs);
        const views = docs.map((d) => shape(materialize(mergeDocs(d, all))));
        expect(views[1]).toEqual(views[0]);
        expect(views[2]).toEqual(views[0]);
        // And the merged board is always well formed: every card in exactly one column.
        const b = materialize(all);
        const placed = b.columns.flatMap((c) => c.cardIds);
        expect(new Set(placed).size).toBe(placed.length);
        expect(placed.sort()).toEqual(Object.keys(b.cards).sort());
      }),
      { numRuns: 200 },
    );
  });

  it('a later local edit always wins over everything this replica has seen', () => {
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 10 }), fc.array(edit, { maxLength: 10 }), (ea, eb) => {
        const base = docFromBoard(demoBoard(today), 'seed', null);
        const a = ea.reduce((d, e) => act(d, e, 'priya'), base);
        const b = eb.reduce((d, e) => act(d, e, 'riya'), base);
        const merged = mergeDocs(a, b);
        const view = materialize(merged);
        const id = view.columns.flatMap((c) => c.cardIds)[0];
        if (!id) return;
        const after = commit(merged, updateCard(view, id, { title: 'Final' }, 'Priya'), 'priya', 'Priya');
        expect(materialize(mergeDocs(after, b)).cards[id].title).toBe('Final');
      }),
      { numRuns: 100 },
    );
  });
});

describe('conflicts', () => {
  it('explains when two people change the same thing without seeing each other', () => {
    const base = docFromBoard(demoBoard(today), 'seed', null);
    const mine = commit(base, updateCard(materialize(base), 'k-slides', { due: '2026-11-01' }, 'Priya'), 'priya', 'Priya');
    const theirs = commit(base, updateCard(materialize(base), 'k-slides', { due: '2026-11-05' }, 'Riya'), 'riya', 'Riya');
    const found = findConflicts(mine, theirs, 'priya');
    // Equal clocks: the tie goes to the higher actor id, the same on every device.
    expect(found).toEqual([{ cardId: 'k-slides', field: 'due', kept: 'theirs', other: 'Riya' }]);
    expect(materialize(mergeDocs(mine, theirs)).cards['k-slides'].due).toBe('2026-11-05');
    // Once Riya has seen Priya's write, her newer change is not a conflict.
    const riyaLater = commit(mergeDocs(theirs, mine), updateCard(materialize(mergeDocs(theirs, mine)), 'k-slides', { due: '2026-11-09' }, 'Riya'), 'riya', 'Riya');
    expect(findConflicts(mine, riyaLater, 'priya')).toEqual([]);
  });
});

describe('validateDoc', () => {
  it('accepts a real document and drops tampered parts', () => {
    const doc = docFromBoard(demoBoard(today), 'priya', 'Priya');
    expect(validateDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const bad = JSON.parse(JSON.stringify(doc));
    bad.cards['k-slides'].place.v.pos = '!!';
    bad.cards['k-email'].due.v = '2026-02-30';
    bad.cards['../evil'] = bad.cards['k-topic'];
    bad.clock = 0;
    const v = validateDoc(bad)!;
    expect(v.cards['k-slides']).toBeUndefined();
    expect(v.cards['k-email']).toBeUndefined();
    expect(v.cards['../evil']).toBeUndefined();
    expect(v.clock).toBe(doc.clock);
  });

  it('rejects non-documents', () => {
    expect(validateDoc(null)).toBeNull();
    expect(validateDoc({ kind: 'handrail-doc', v: 1 })).toBeNull();
    expect(validateDoc(demoBoard(today))).toBeNull();
  });
});

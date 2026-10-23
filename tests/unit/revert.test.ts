import { describe, expect, it } from 'vitest';
import { addCard, addColumn, deleteCard, deleteColumn, locate, moveCard, updateCard } from '../../src/model/board';
import { commit, docFromBoard, materialize, mergeDocs } from '../../src/model/crdt';
import { revertEdit } from '../../src/model/revert';
import { demoBoard } from '../../src/model/seed';
import type { Board } from '../../src/model/types';

const today = new Date(2026, 9, 22);
const where = (b: Board, id: string) => {
  const l = locate(b, id);
  return l ? `${l.column.title}:${l.index}` : 'gone';
};

describe('per-action undo', () => {
  it('undoes and redoes a simple move', () => {
    const before = demoBoard(today);
    const after = moveCard(before, 'k-sources', 'c-done', 0, 'Priya');
    const undone = revertEdit(after, before, after, 'Priya');
    expect(where(undone.board, 'k-sources')).toBe('To do:0');
    expect(undone.skipped).toBe(0);
    const redone = revertEdit(undone.board, after, before, 'Priya');
    expect(where(redone.board, 'k-sources')).toBe('Done:0');
  });

  it('after opening a teammate’s link, undo keeps their new card, their delete and their rename', () => {
    // Priya moves a card, then merges Riya's link, then presses Undo.
    let priya = docFromBoard(demoBoard(today), 'priya', 'Priya', 1);
    let riya = priya;
    const before = materialize(priya);
    const after = moveCard(before, 'k-sources', 'c-doing', 0, 'Priya');
    priya = commit(priya, after, 'priya', 'Priya', 2);

    let r = materialize(riya);
    r = addCard(r, 'c-todo', { title: 'Riya’s new card' }, 'Riya').board;
    r = deleteCard(r, 'k-email');
    r = updateCard(r, 'k-slides', { title: 'Slides (final)' }, 'Riya');
    riya = commit(riya, r, 'riya', 'Riya', 3);

    priya = mergeDocs(priya, riya);
    const undone = revertEdit(materialize(priya), before, after, 'Priya');
    priya = commit(priya, undone.board, 'priya', 'Priya', 4);
    const b = materialize(priya);

    expect(where(b, 'k-sources')).toBe('To do:0');
    expect(Object.values(b.cards).map((c) => c.title)).toContain('Riya’s new card');
    expect(b.cards['k-email']).toBeUndefined();
    expect(b.cards['k-slides'].title).toBe('Slides (final)');
    // And when Riya merges Priya's copy, her own work is still there.
    const back = materialize(mergeDocs(riya, priya));
    expect(Object.values(back.cards).map((c) => c.title)).toContain('Riya’s new card');
    expect(back.cards['k-email']).toBeUndefined();
  });

  it('leaves a card alone if a teammate moved it again since, and says so', () => {
    const before = demoBoard(today);
    const after = moveCard(before, 'k-sources', 'c-doing', 0, 'Priya');
    const theirs = moveCard(after, 'k-sources', 'c-done', 0, 'Riya');
    const undone = revertEdit(theirs, before, after, 'Priya');
    expect(where(undone.board, 'k-sources')).toBe('Done:0');
    expect(undone.skipped).toBe(1);
  });

  it('undo, redo, then merge converges with the teammate', () => {
    let priya = docFromBoard(demoBoard(today), 'priya', 'Priya', 1);
    const riya = commit(priya, updateCard(materialize(priya), 'k-topic', { title: 'Topic (Riya)' }, 'Riya'), 'riya', 'Riya', 2);
    const before = materialize(priya);
    const after = updateCard(before, 'k-slides', { due: '2026-11-01' }, 'Priya');
    priya = commit(priya, after, 'priya', 'Priya', 3);
    priya = commit(priya, revertEdit(materialize(priya), before, after, 'Priya').board, 'priya', 'Priya', 4);
    priya = commit(priya, revertEdit(materialize(priya), after, before, 'Priya').board, 'priya', 'Priya', 5);
    const a = materialize(mergeDocs(priya, riya));
    const b = materialize(mergeDocs(riya, priya));
    expect(a).toEqual(b);
    expect(a.cards['k-slides'].due).toBe('2026-11-01');
    expect(a.cards['k-topic'].title).toBe('Topic (Riya)');
  });

  it('brings back a deleted card, and removes an added one', () => {
    const before = demoBoard(today);
    const deleted = deleteCard(before, 'k-email');
    expect(where(revertEdit(deleted, before, deleted, 'Priya').board, 'k-email')).toBe('To do:2');
    const { board: added, cardId } = addCard(before, 'c-doing', { title: 'Temp' }, 'Priya');
    expect(revertEdit(added, before, added, 'Priya').board.cards[cardId]).toBeUndefined();
  });

  it('undoing a delete keeps a teammate’s edit made to the card after it was deleted', () => {
    const start = docFromBoard(demoBoard(today), 'priya', 'Priya', 1);
    const before = materialize(start);
    const after = deleteCard(before, 'k-email');
    const priya = commit(start, after, 'priya', 'Priya', 2);
    // Riya hadn't seen the delete, and renamed the card.
    const riya = commit(start, updateCard(before, 'k-email', { title: 'Email Dr. Mehta today' }, 'Riya'), 'riya', 'Riya', 3);
    const merged = mergeDocs(priya, riya);
    const latest = (id: string) => {
      const r = merged.cards[id];
      return r && { title: r.title.v, notes: r.notes.v, due: r.due.v, assignee: r.assignee.v };
    };
    const undone = revertEdit(materialize(merged), before, after, 'Priya', latest).board;
    expect(undone.cards['k-email'].title).toBe('Email Dr. Mehta today');
    expect(where(undone, 'k-email')).toBe('To do:2');
    // Committing the undo doesn't overwrite Riya's title with the old one.
    const back = commit(merged, undone, 'priya', 'Priya', 4);
    expect(back.cards['k-email'].title.by).toBe('Riya');
  });

  it('only reverts the fields the action changed', () => {
    const before = demoBoard(today);
    const after = updateCard(before, 'k-slides', { due: '2026-11-01' }, 'Priya');
    const teammate = updateCard(after, 'k-slides', { assignee: 'Arjun' }, 'Arjun');
    const undone = revertEdit(teammate, before, after, 'Priya').board;
    expect(undone.cards['k-slides'].due).toBe(before.cards['k-slides'].due);
    expect(undone.cards['k-slides'].assignee).toBe('Arjun');
  });

  it('undoes column changes, putting cards back', () => {
    const before = demoBoard(today);
    const after = deleteColumn(before, 'c-doing');
    const undone = revertEdit(after, before, after, 'Priya').board;
    expect(undone.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done']);
    expect(where(undone, 'k-outline')).toBe('Doing:0');
    const added = addColumn(before, 'Review');
    expect(revertEdit(added.board, before, added.board, 'Priya').board.columns).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';
import { commit, docFromBoard, findConflicts, materialize, mergeDocs } from '../../src/model/crdt';
import { describeConflicts, diffBoards, type Change } from '../../src/model/diff';
import { demoBoard, demoTeammateEdits } from '../../src/model/seed';
import { listJoin, summarize } from '../../src/model/summary';
import { updateCard } from '../../src/model/board';

const today = new Date(2026, 9, 22);

describe('summarize', () => {
  it('writes the teammate demo as one short digest, people involving you first', () => {
    const mine = docFromBoard(demoBoard(today), 'priya', 'Priya');
    let theirs = mine;
    for (const step of demoTeammateEdits(today)) theirs = commit(theirs, step.apply(materialize(theirs)), step.actor, step.by);
    const changes = diffBoards(materialize(mine), materialize(mergeDocs(mine, theirs)), 'Priya', today);
    expect(summarize(changes, 'Priya', today)).toBe(
      'Riya gave you “Email Dr. Mehta about the extension”, moved “Design slides 4 to 8” to Done and added “Rehearse together on call” to To do. ' +
        'Arjun moved “Write the presentation script” to Doing.',
    );
  });

  it('folds repeated actions and shortens long lists', () => {
    const moved = (title: string): Change => ({ kind: 'moved', title, to: 'Done', by: 'Riya', forYou: false, text: '' });
    const text = summarize(['A', 'B', 'C', 'D', 'E'].map(moved), 'Priya', today);
    expect(text).toBe('Riya moved 5 cards (“A”, “B”, “C” and 2 more) to Done.');
  });

  it('mentions removals, columns and clashes after the people', () => {
    const base = docFromBoard(demoBoard(today), 'seed', null);
    const a = commit(base, updateCard(materialize(base), 'k-slides', { due: '2026-11-01' }, 'Priya'), 'priya', 'Priya');
    const b = commit(base, updateCard(materialize(base), 'k-slides', { due: '2026-11-05' }, 'Riya'), 'riya', 'Riya');
    const changes = [
      ...describeConflicts(findConflicts(a, b, 'priya'), materialize(mergeDocs(a, b))),
      { kind: 'removed', title: 'Old card', text: '', forYou: false } as Change,
    ];
    expect(summarize(changes, 'Priya', today)).toBe('“Old card” was removed. One edit clashed with yours and was settled automatically; see the list.');
  });

  it('says so when nothing changed', () => {
    expect(summarize([], 'Priya', today)).toBe('Nothing has changed since you last looked.');
  });

  it('joins lists naturally', () => {
    expect(listJoin(['a'])).toBe('a');
    expect(listJoin(['a', 'b'])).toBe('a and b');
    expect(listJoin(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

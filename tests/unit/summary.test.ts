import { describe, expect, it } from 'vitest';
import { commit, docFromBoard, findConflicts, materialize, mergeDocs } from '../../src/model/crdt';
import { describeConflicts, diffBoards, type Change } from '../../src/model/diff';
import { demoBoard, demoTeammateEdits } from '../../src/model/seed';
import { listJoin, summarize } from '../../src/model/summary';
import { deleteCard, deleteColumn, renameColumn, updateCard } from '../../src/model/board';

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

describe('what changed: the harder cases', () => {
  const base = () => docFromBoard(demoBoard(today), 'seed', null, 1);
  const changes = (mine: ReturnType<typeof base>, theirs: ReturnType<typeof base>) => {
    const merged = mergeDocs(mine, theirs);
    return [
      ...describeConflicts(findConflicts(mine, theirs, 'priya'), materialize(merged)),
      ...diffBoards(materialize(mine), materialize(merged), 'Priya', today),
    ].map((c) => c.text);
  };

  it('says who renamed the board and who deleted a card', () => {
    const b = base();
    let v = materialize(b);
    v = { ...v, title: 'Climate talk (final)' };
    v = deleteCard(v, 'k-topic');
    const riya = commit(b, v, 'riya', 'Riya', 5);
    expect(changes(b, riya)).toEqual(['Riya renamed the board to “Climate talk (final)”.', 'Riya deleted “Pick the topic”.']);
  });

  it('explains cards that moved because their column was deleted', () => {
    const b = base();
    const riya = commit(b, deleteColumn(materialize(b), 'c-doing'), 'riya', 'Riya', 5);
    expect(changes(b, riya)).toContain('“Draft the outline” is now in To do, because the Doing column was removed.');
  });

  it('notices a delete on one side while the other side was editing', () => {
    const b = base();
    const priya = commit(b, deleteCard(materialize(b), 'k-slides'), 'priya', 'Priya', 5);
    const riya = commit(b, updateCard(materialize(b), 'k-slides', { title: 'Slides v2' }, 'Riya'), 'riya', 'Riya', 6);
    expect(changes(priya, riya)[0]).toBe('Riya changed “Slides v2” while you were deleting it. It stays deleted; undo your delete to bring it back with Riya’s changes.');
    const priya2 = commit(b, updateCard(materialize(b), 'k-slides', { title: 'Slides v2' }, 'Priya'), 'priya', 'Priya', 5);
    const riya2 = commit(b, deleteCard(materialize(b), 'k-slides'), 'riya', 'Riya', 6);
    expect(changes(priya2, riya2)[0]).toBe('Riya deleted “Slides v2” while you were changing it, so your change is not on the board.');
  });

  it('notices clashing column renames', () => {
    const b = base();
    const priya = commit(b, renameColumn(materialize(b), 'c-doing', 'In progress'), 'priya', 'Priya', 5);
    const riya = commit(b, renameColumn(materialize(b), 'c-doing', 'Working'), 'riya', 'Riya', 6);
    expect(changes(priya, riya)[0]).toBe('You and Riya both renamed the column now called “Working” at the same time. Handrail kept Riya’s. Rename it again if you want yours back.');
  });
});

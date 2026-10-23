import { describe, expect, it } from 'vitest';
import { parseCommand, type ParseContext } from '../../src/model/commands';
import { executeCommand } from '../../src/model/execute';
import { findColumn, findPerson, matchScore } from '../../src/model/match';
import { locate, peopleOn } from '../../src/model/board';
import { demoBoard } from '../../src/model/seed';
import type { Board } from '../../src/model/types';

const today = new Date(2026, 9, 22);
const board = demoBoard(today);
const ctxFor = (b: Board): ParseContext => ({
  today,
  isColumn: (t) => !!findColumn(b, t).match,
  isPerson: (t) => !!findPerson(peopleOn(b), t, 'Priya'),
});
const parse = (s: string, b: Board = board) => parseCommand(s, ctxFor(b));
const run = (s: string, b: Board = board) => executeCommand(parse(s, b), b, { today, me: 'Priya' });
const where = (b: Board, title: string) => {
  const card = Object.values(b.cards).find((c) => c.title === title)!;
  const loc = locate(b, card.id)!;
  return { column: loc.column.title, index: loc.index, card };
};

describe('parseCommand', () => {
  it('reads add commands with trailing clauses', () => {
    expect(parse('add essay outline due friday')).toEqual({ type: 'add', title: 'essay outline', due: 'friday' });
    expect(parse('Add "Book a room" to doing due tomorrow for Riya')).toEqual({
      type: 'add', title: 'Book a room', column: 'doing', due: 'tomorrow', assignee: 'Riya',
    });
  });

  it('keeps "to" and "for" inside titles when they are not a column or person', () => {
    expect(parse('add email prof to ask about grades due monday')).toEqual({
      type: 'add', title: 'email prof to ask about grades', due: 'monday',
    });
    expect(parse('add study for the quiz')).toEqual({ type: 'add', title: 'study for the quiz' });
  });

  it('reads moves, including titles that contain "to"', () => {
    expect(parse('move lab report to done')).toEqual({ type: 'move', card: 'lab report', column: 'done', position: undefined });
    expect(parse('move talk to Dr. Mehta to doing')).toMatchObject({ card: 'talk to Dr. Mehta', column: 'doing' });
    expect(parse('move slides to the top of doing')).toEqual({ type: 'move', card: 'slides', column: 'doing', position: 'top' });
    expect(parse('move slides up')).toEqual({ type: 'nudge', card: 'slides', direction: 'up' });
  });

  it('reads everyday phrasings', () => {
    expect(parse('outline is done')).toEqual({ type: 'done', card: 'outline' });
    expect(parse('mark sources as done')).toEqual({ type: 'done', card: 'sources' });
    expect(parse("I'm working on the script")).toEqual({ type: 'start', card: 'the script' });
    expect(parse('what changed')).toEqual({ type: 'changes' });
    expect(parse("what's due this week")).toEqual({ type: 'whatsDue', range: 'week' });
    expect(parse('anything overdue?')).toEqual({ type: 'whatsDue', range: 'overdue' });
    expect(parse('read doing')).toEqual({ type: 'read', target: 'doing' });
    expect(parse('slides due next friday')).toMatchObject({ type: 'due', card: 'slides', due: '2026-10-30' });
    expect(parse('assign email to me')).toEqual({ type: 'assign', card: 'email', person: 'me' });
    expect(parse('please undo')).toEqual({ type: 'undo' });
    expect(parse('what are my tasks')).toEqual({ type: 'unknown', text: 'what are my tasks' });
    expect(parse('my tasks')).toEqual({ type: 'mine' });
    expect(parse('more')).toEqual({ type: 'more' });
    expect(parse('tell me more')).toEqual({ type: 'more' });
    expect(parse('say that again')).toEqual({ type: 'repeat' });
    expect(parse('repeat')).toEqual({ type: 'repeat' });
  });

  it('does not misread edits as deletes, completions or new cards', () => {
    expect(parse('remove the due date from slides')).toMatchObject({ type: 'due', card: 'slides', due: null });
    expect(parse('delete the deadline on slides')).toMatchObject({ type: 'due', card: 'slides', due: null });
    expect(parse('finish slides by friday')).toMatchObject({ type: 'due', card: 'slides', due: '2026-10-23' });
    expect(parse('make the intro shorter')).toEqual({ type: 'unknown', text: 'make the intro shorter' });
    expect(parse('make a card called book a room')).toMatchObject({ type: 'add', title: 'book a room' });
    expect(parse('remove slides')).toEqual({ type: 'delete', card: 'slides' });
    expect(parse('finish slides')).toEqual({ type: 'done', card: 'slides' });
  });
});

describe('matching', () => {
  it('tolerates speech-recognition slips', () => {
    expect(matchScore('sorces', 'Find five sources on heat waves')).toBeGreaterThan(40);
    expect(matchScore('outline', 'Draft the outline')).toBeGreaterThanOrEqual(80);
    expect(matchScore('pizza', 'Draft the outline')).toBe(0);
  });

  it('finds columns by synonym and number', () => {
    expect(findColumn(board, 'finished').match?.title).toBe('Done');
    expect(findColumn(board, 'in progress').match?.title).toBe('Doing');
    expect(findColumn(board, 'column 2').match?.title).toBe('Doing');
    expect(findColumn(board, 'first').match?.title).toBe('To do');
  });
});

describe('executeCommand', () => {
  it('moves a card and reports its new position', () => {
    const r = run('move find sources to doing');
    expect(r.ok).toBe(true);
    expect(where(r.board!, 'Find five sources on heat waves')).toMatchObject({ column: 'Doing', index: 1 });
    expect(r.message).toBe('Moved “Find five sources on heat waves” to Doing. Doing, position 2 of 2.');
    expect(r.board!.cards['k-sources'].lastEditedBy).toBe('Priya');
  });

  it('adds a card with a due date and assignee', () => {
    const r = run('add book a study room due tomorrow for riya');
    const w = where(r.board!, 'book a study room');
    expect(w.column).toBe('To do');
    expect(w.card).toMatchObject({ due: '2026-10-23', assignee: 'Riya' });
    expect(r.message).toContain('due tomorrow');
  });

  it('marks done and starts using the right columns', () => {
    expect(where(run('outline is done').board!, 'Draft the outline').column).toBe('Done');
    expect(where(run('start the script').board!, 'Write the presentation script').column).toBe('Doing');
  });

  it('asks which one when a name is ambiguous', () => {
    const b = run('add draft the poster').board!;
    const r = run('done draft the', b);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/More than one card matches/);
  });

  it('explains when a column does not exist', () => {
    const r = run('move outline to archive');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Columns are: To do, Doing, Done');
  });

  it('answers questions without changing the board', () => {
    const due = run("what's due today");
    expect(due.board).toBeUndefined();
    expect(due.message).toMatch(/^2 cards due today or overdue\. Draft the outline/);
    expect(run('my tasks').message).toMatch(/^You have 2 open cards/);
    expect(run('summary').message).toContain('To do: 4 cards. Doing: 1 card, 1 overdue. Done: 2 cards');
  });

  it('answers who has a card and what someone is doing', () => {
    expect(parse("what's Riya doing")).toEqual({ type: 'person', person: 'Riya' });
    expect(parse('what is arjun working on')).toEqual({ type: 'person', person: 'arjun' });
    expect(parse('who has the slides')).toEqual({ type: 'owner', card: 'the slides' });
    expect(parse('what is in doing')).toEqual({ type: 'read', target: 'doing' });
    expect(run("what's riya doing").message).toBe('Riya has 1 open card. Design slides 4 to 8, in To do, due Sunday 25 October, in 3 days.');
    expect(run('who has the slides').message).toBe('“Design slides 4 to 8” is assigned to Riya.');
    expect(run('who has the email').message).toContain('Nobody has “Email Dr. Mehta about the extension” yet.');
    expect(run('what is zoe doing').ok).toBe(false);
  });

  it('deletes and suggests undo', () => {
    const r = run('delete set up the group chat');
    expect(r.board!.cards['k-groupchat']).toBeUndefined();
    expect(r.message).toContain('undo');
  });
});

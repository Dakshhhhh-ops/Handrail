import { describe, expect, it } from 'vitest';
import { peopleOn } from '../../src/model/board';
import { parseCommand } from '../../src/model/commands';
import { findColumn, findPerson } from '../../src/model/match';
import { previewCommand } from '../../src/model/preview';
import { demoBoard } from '../../src/model/seed';

const today = new Date(2026, 9, 22);
const board = demoBoard(today);
const preview = (text: string) =>
  previewCommand(
    parseCommand(text, {
      today,
      isColumn: (t) => !!findColumn(board, t).match,
      isPerson: (t) => !!findPerson(peopleOn(board), t, 'Priya'),
    }),
    board,
    { today, me: 'Priya' },
  );

describe('previewCommand', () => {
  it.each([
    ['move find sources to doing', 'Move “Find five sources on heat waves” to Doing'],
    ['outline is done', 'Move “Draft the outline” to Done'],
    ['start the script', 'Move “Write the presentation script” to Doing'],
    ['move slides to the top of doing', 'Move “Design slides 4 to 8” to Doing at the top'],
    ['move slides up', 'Move “Design slides 4 to 8” up one place'],
    ['add book a room due tomorrow for riya', 'Add “book a room” to To do, due tomorrow, Friday 23 October, for Riya'],
    ['assign email to me', 'Assign “Email Dr. Mehta about the extension” to you'],
    ['slides due next friday', 'Set “Design slides 4 to 8” due Friday 30 October'],
    ['delete group chat', 'Delete “Set up the group chat” (you can undo)'],
    ['read doing', 'Read the Doing column'],
    ["what's due this week", 'List cards due in the next 7 days'],
    ['what changed', 'Read what changed since you last looked'],
  ])('%s', (text, expected) => {
    expect(preview(text)).toEqual({ text: expected, ok: true });
  });

  it('flags commands that would fail', () => {
    expect(preview('blorp')).toEqual({ text: 'I don’t understand that yet', ok: false });
    expect(preview('move pizza to done')).toEqual({ text: 'No card called “pizza”', ok: false });
    expect(preview('move outline to archive')).toEqual({ text: 'No column called “archive”', ok: false });
  });
});

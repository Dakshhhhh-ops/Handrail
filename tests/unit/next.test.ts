import { describe, expect, it } from 'vitest';
import { moveCard, updateCard } from '../../src/model/board';
import { diffBoards } from '../../src/model/diff';
import { nextStep } from '../../src/model/next';
import { parseCommand } from '../../src/model/commands';
import { demoBoard, demoTeammateUpdate } from '../../src/model/seed';

const today = new Date(2026, 9, 22);

describe('what should I do next?', () => {
  it('picks the most overdue card first', () => {
    expect(nextStep(demoBoard(today), 'Priya', today)?.text).toBe('Your next step: “Draft the outline”. It’s overdue by 1 day.');
  });

  it('then a card a teammate just gave you, saying who gave it', () => {
    const before = moveCard(demoBoard(today), 'k-outline', 'c-done', 0, 'Priya');
    const after = demoTeammateUpdate(before, today);
    const changes = diffBoards(before, after, 'Priya', today);
    const next = nextStep(after, 'Priya', today, changes)!;
    expect(next.cardId).toBe('k-email');
    expect(next.text).toBe('Your next step: “Email Dr. Mehta about the extension”. Riya gave it to you, and it’s due today.');
  });

  it('then the one due soonest, and ignores cards that are done or not yours', () => {
    let b = moveCard(demoBoard(today), 'k-outline', 'c-done', 0, 'Priya');
    b = updateCard(b, 'k-email', { assignee: 'Riya' }, 'Priya');
    expect(nextStep(b, 'Priya', today)?.text).toBe('Your next step: “Find five sources on heat waves”. It’s due tomorrow.');
    expect(nextStep(b, 'Zoe', today)).toBeNull();
    expect(nextStep(b, null, today)).toBeNull();
  });

  it('is asked for in plain words', () => {
    const ctx = { today, isColumn: () => false, isPerson: () => false };
    for (const s of ['what next', "what's next", 'what should I do next', 'what do i do now', 'next step']) {
      expect(parseCommand(s, ctx)).toEqual({ type: 'next' });
    }
  });
});

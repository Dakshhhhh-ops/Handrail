import { doneColumn } from './board';
import { daysUntil, describeDue } from './dates';
import { sameName } from './describe';
import type { Change } from './diff';
import type { Board, Card } from './types';

export interface NextStep {
  cardId: string;
  /** "Your next step: “Email Dr. Mehta”. Riya gave it to you, and it’s due today." */
  text: string;
}

/**
 * The one card to do next, out of your open cards: the most overdue first, then cards a
 * teammate just gave you, then the one due soonest, then anything else of yours (in board
 * order). Deterministic, so the same board always gives the same answer.
 */
export function nextStep(board: Board, me: string | null, today: Date, changes: Change[] = []): NextStep | null {
  if (!me) return null;
  const done = doneColumn(board);
  const mine: Card[] = [];
  for (const col of board.columns) {
    if (col.id === done?.id) continue;
    for (const id of col.cardIds) {
      const k = board.cards[id];
      if (k && sameName(k.assignee, me)) mine.push(k);
    }
  }
  if (mine.length === 0) return null;

  const givenBy = new Map<string, string | null>();
  for (const c of changes) {
    if (c.kind === 'assigned' && c.cardId && sameName(c.to ?? null, me)) givenBy.set(c.cardId, c.by ?? null);
  }
  const rank = (k: Card): [number, number] => {
    const days = k.due ? daysUntil(k.due, today) : null;
    if (days !== null && days < 0) return [0, days];
    if (givenBy.has(k.id)) return [1, days ?? 9999];
    if (days !== null) return [2, days];
    return [3, 0];
  };
  const pick = [...mine].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1];
  })[0];

  // "overdue by 1 day", "due today", "due tomorrow", "due Monday 26 October"
  const due = pick.due ? describeDue(pick.due, today).spoken.split(', ')[0] : '';
  const by = givenBy.has(pick.id) ? givenBy.get(pick.id) || 'A teammate' : '';
  const why = by && due ? `${by} gave it to you, and it’s ${due}.`
    : by ? `${by} gave it to you.`
    : due ? `It’s ${due}.`
    : 'It’s yours and not done yet.';
  return { cardId: pick.id, text: `Your next step: “${pick.title}”. ${why}` };
}

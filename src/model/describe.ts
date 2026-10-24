import { daysUntil, describeDue } from './dates';
import { doneColumn, locate } from './board';
import type { DueRange } from './commands';
import type { Board, Card, Column } from './types';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * Whether two names are the same person. A first name on its own matches a full name that
 * starts with it ("Priya" and "Priya Sharma"), since Trello uses full names and people often
 * give Handrail just their first name. Two different full names never match.
 */
export function sameName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = a.trim().toLowerCase().replace(/\s+/g, ' ');
  const y = b.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return !short.includes(' ') && long.startsWith(`${short} `);
}

export function whoLabel(name: string | null, me: string | null): string {
  if (!name) return '';
  return sameName(name, me) ? 'you' : name;
}

/** Due date and assignee, for speech: "due tomorrow, Friday 24 October, assigned to Riya". */
export function cardDetails(card: Card, today: Date, me: string | null): string {
  const parts: string[] = [];
  if (card.due) parts.push(describeDue(card.due, today).spoken);
  if (card.assignee) parts.push(`assigned to ${whoLabel(card.assignee, me)}`);
  if (card.notes.trim()) parts.push('has notes');
  return parts.join(', ');
}

/** What a screen reader hears when a card gets focus. */
export function cardLabel(board: Board, cardId: string, today: Date, me: string | null): string {
  const card = board.cards[cardId];
  const loc = locate(board, cardId);
  if (!card || !loc) return '';
  const details = cardDetails(card, today, me);
  return `${card.title}${details ? `, ${details}` : ''}. ${loc.index + 1} of ${loc.column.cardIds.length} in ${loc.column.title}`;
}

export function positionText(board: Board, cardId: string): string {
  const loc = locate(board, cardId);
  if (!loc) return '';
  return `${loc.column.title}, position ${loc.index + 1} of ${loc.column.cardIds.length}`;
}

export function columnReport(board: Board, column: Column, today: Date, me: string | null): string {
  const n = column.cardIds.length;
  if (n === 0) return `${column.title} is empty.`;
  const items = column.cardIds.map((id, i) => {
    const c = board.cards[id];
    const d = cardDetails(c, today, me);
    return `${i + 1}: ${c.title}${d ? `, ${d}` : ''}.`;
  });
  return `${column.title} has ${plural(n, 'card')}. ${items.join(' ')}`;
}

function openCards(board: Board): Card[] {
  const done = doneColumn(board);
  return board.columns
    .filter((c) => c.id !== done?.id || board.columns.length === 1)
    .flatMap((c) => c.cardIds.map((id) => board.cards[id]));
}

export function boardSummary(board: Board, today: Date, me: string | null): string {
  const done = doneColumn(board);
  const cols = board.columns.map((c) => {
    const overdue = c.id === done?.id ? 0 : c.cardIds.filter((id) => {
      const due = board.cards[id].due;
      return due && daysUntil(due, today) < 0;
    }).length;
    return `${c.title}: ${plural(c.cardIds.length, 'card')}${overdue ? `, ${overdue} overdue` : ''}`;
  });
  const mine = me ? openCards(board).filter((k) => sameName(k.assignee, me)).length : 0;
  const mineText = me ? ` ${mine === 0 ? 'Nothing open is' : plural(mine, 'open card is', 'open cards are')} assigned to you.` : '';
  return `${board.title}. ${plural(board.columns.length, 'column')}. ${cols.join('. ')}.${mineText}`;
}

export function dueReport(board: Board, range: DueRange, today: Date, me: string | null): string {
  const cards = openCards(board)
    .filter((k) => {
      if (!k.due) return false;
      const d = daysUntil(k.due, today);
      if (range === 'overdue') return d < 0;
      if (range === 'today') return d <= 0;
      if (range === 'tomorrow') return d === 1;
      if (range === 'week') return d <= 7;
      return true;
    })
    .sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const label = { overdue: 'overdue', today: 'due today or overdue', tomorrow: 'due tomorrow', week: 'due in the next 7 days', all: 'with a due date' }[range];
  if (cards.length === 0) return `Nothing ${label}.`;
  const items = cards.map((k) => {
    const where = locate(board, k.id)?.column.title ?? '';
    const who = k.assignee ? `, ${whoLabel(k.assignee, me)}` : '';
    return `${k.title}, ${describeDue(k.due!, today).spoken}, in ${where}${who}.`;
  });
  return `${plural(cards.length, 'card')} ${label}. ${items.join(' ')}`;
}

/** "Riya has 2 open cards: …" */
export function personReport(board: Board, person: string, today: Date, me: string | null): string {
  if (sameName(person, me)) return mineReport(board, today, me);
  const cards = openCards(board).filter((k) => sameName(k.assignee, person));
  if (cards.length === 0) return `Nothing open is assigned to ${person}.`;
  const items = cards.map((k) => {
    const where = locate(board, k.id)?.column.title ?? '';
    const due = k.due ? `, ${describeDue(k.due, today).spoken}` : '';
    return `${k.title}, in ${where}${due}.`;
  });
  return `${person} has ${plural(cards.length, 'open card')}. ${items.join(' ')}`;
}

export function mineReport(board: Board, today: Date, me: string | null): string {
  if (!me) return 'Set your name in Settings first, so Handrail knows which cards are yours.';
  const cards = openCards(board).filter((k) => sameName(k.assignee, me));
  if (cards.length === 0) return 'Nothing open is assigned to you.';
  const items = cards.map((k) => {
    const where = locate(board, k.id)?.column.title ?? '';
    const due = k.due ? `, ${describeDue(k.due, today).spoken}` : '';
    return `${k.title}, in ${where}${due}.`;
  });
  return `You have ${plural(cards.length, 'open card')}. ${items.join(' ')}`;
}

import { addDays, toISODate } from './dates';
import type { Board, Card } from './types';

/**
 * The sample board: a three-person group project. Priya (the viewer) uses a
 * screen reader; Riya and Arjun use the board with a mouse.
 */
export function demoBoard(today: Date): Board {
  const d = (n: number) => toISODate(addDays(today, n));
  const card = (id: string, title: string, due: string | null, assignee: string | null, notes = ''): Card => ({
    id, title, notes, due, assignee, lastEditedBy: assignee, updatedAt: 0,
  });
  const cards: Card[] = [
    card('k-sources', 'Find five sources on heat waves', d(1), 'Priya', 'At least two peer-reviewed. Library database works off campus with the student login.'),
    card('k-slides', 'Design slides 4 to 8', d(3), 'Riya'),
    card('k-email', 'Email Dr. Mehta about the extension', d(0), null),
    card('k-script', 'Write the presentation script', d(4), 'Arjun'),
    card('k-outline', 'Draft the outline', d(-1), 'Priya', 'Intro, three causes, local data, what students can do.'),
    card('k-topic', 'Pick the topic', null, 'Arjun'),
    card('k-groupchat', 'Set up the group chat', null, 'Riya'),
  ];
  return {
    id: 'demo-climate-project',
    title: 'Climate talk: group project',
    columns: [
      { id: 'c-todo', title: 'To do', cardIds: ['k-sources', 'k-slides', 'k-email', 'k-script'] },
      { id: 'c-doing', title: 'Doing', cardIds: ['k-outline'] },
      { id: 'c-done', title: 'Done', cardIds: ['k-topic', 'k-groupchat'] },
    ],
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    updatedAt: 0,
  };
}

/**
 * What the board looks like after Riya and Arjun worked on it overnight.
 * Opening this as a shared link shows off "Since you last looked".
 */
export function demoTeammateUpdate(board: Board, today: Date): Board {
  const next: Board = structuredClone(board);
  const col = (id: string) => next.columns.find((c) => c.id === id);
  const take = (cardId: string) => next.columns.forEach((c) => (c.cardIds = c.cardIds.filter((x) => x !== cardId)));
  const stamp = (id: string, by: string) => {
    if (next.cards[id]) next.cards[id] = { ...next.cards[id], lastEditedBy: by, updatedAt: Date.now() };
  };

  if (next.cards['k-slides'] && col('c-done')) {
    take('k-slides');
    col('c-done')!.cardIds.unshift('k-slides');
    stamp('k-slides', 'Riya');
  }
  if (next.cards['k-script'] && col('c-doing')) {
    take('k-script');
    col('c-doing')!.cardIds.push('k-script');
    stamp('k-script', 'Arjun');
  }
  if (next.cards['k-email']) {
    next.cards['k-email'] = { ...next.cards['k-email'], assignee: 'Priya' };
    stamp('k-email', 'Riya');
  }
  if (col('c-todo')) {
    next.cards['k-rehearse'] = {
      id: 'k-rehearse', title: 'Rehearse together on call', notes: 'Riya will share the slides link in the chat.',
      due: toISODate(addDays(today, 5)), assignee: null, lastEditedBy: 'Riya', updatedAt: Date.now(),
    };
    col('c-todo')!.cardIds.push('k-rehearse');
  }
  next.updatedAt = Date.now();
  return next;
}

/** The same overnight changes, split by who made them, for the CRDT demo. */
export function demoTeammateEdits(today: Date): { actor: string; by: string; apply: (b: Board) => Board }[] {
  const move = (b: Board, id: string, col: string, front: boolean, by: string): Board => {
    if (!b.cards[id] || !b.columns.some((c) => c.id === col)) return b;
    const next: Board = structuredClone(b);
    next.columns.forEach((c) => (c.cardIds = c.cardIds.filter((x) => x !== id)));
    const target = next.columns.find((c) => c.id === col)!;
    if (front) target.cardIds.unshift(id);
    else target.cardIds.push(id);
    next.cards[id] = { ...next.cards[id], lastEditedBy: by };
    return next;
  };
  return [
    {
      actor: 'demo-riya', by: 'Riya',
      apply: (b) => {
        let next = move(b, 'k-slides', 'c-done', true, 'Riya');
        next = structuredClone(next);
        if (next.cards['k-email']) next.cards['k-email'] = { ...next.cards['k-email'], assignee: 'Priya', lastEditedBy: 'Riya' };
        const todo = next.columns.find((c) => c.id === 'c-todo');
        if (todo && !next.cards['k-rehearse']) {
          next.cards['k-rehearse'] = {
            id: 'k-rehearse', title: 'Rehearse together on call', notes: 'Riya will share the slides link in the chat.',
            due: toISODate(addDays(today, 5)), assignee: null, lastEditedBy: 'Riya', updatedAt: Date.now(),
          };
          todo.cardIds.push('k-rehearse');
        }
        return next;
      },
    },
    { actor: 'demo-arjun', by: 'Arjun', apply: (b) => move(b, 'k-script', 'c-doing', false, 'Arjun') },
  ];
}

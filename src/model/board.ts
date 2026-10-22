import type { Board, Card, CardLocation, Column } from './types';

export function newId(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function createBoard(title: string, columnTitles: string[] = ['To do', 'Doing', 'Done']): Board {
  return {
    id: newId('b'),
    title,
    columns: columnTitles.map((t) => ({ id: newId('c'), title: t, cardIds: [] })),
    cards: {},
    updatedAt: Date.now(),
  };
}

export function locate(board: Board, cardId: string): CardLocation | null {
  for (let ci = 0; ci < board.columns.length; ci++) {
    const index = board.columns[ci].cardIds.indexOf(cardId);
    if (index >= 0) return { column: board.columns[ci], columnIndex: ci, index };
  }
  return null;
}

export function columnById(board: Board, columnId: string): Column | undefined {
  return board.columns.find((c) => c.id === columnId);
}

function touch(board: Board, columns: Column[], cards: Record<string, Card>): Board {
  return { ...board, columns, cards, updatedAt: Date.now() };
}

export interface NewCardInput {
  title: string;
  notes?: string;
  due?: string | null;
  assignee?: string | null;
}

export function addCard(
  board: Board,
  columnId: string,
  input: NewCardInput,
  by: string | null,
  index?: number,
): { board: Board; cardId: string } {
  const id = newId('k');
  const card: Card = {
    id,
    title: input.title.trim(),
    notes: input.notes?.trim() ?? '',
    due: input.due ?? null,
    assignee: input.assignee?.trim() || null,
    lastEditedBy: by,
    updatedAt: Date.now(),
  };
  const columns = board.columns.map((c) => {
    if (c.id !== columnId) return c;
    const ids = [...c.cardIds];
    ids.splice(index ?? ids.length, 0, id);
    return { ...c, cardIds: ids };
  });
  return { board: touch(board, columns, { ...board.cards, [id]: card }), cardId: id };
}

/** Moves a card to a column and position. The index is clamped to the column's length. */
export function moveCard(board: Board, cardId: string, toColumnId: string, toIndex: number, by: string | null): Board {
  const from = locate(board, cardId);
  if (!from || !columnById(board, toColumnId)) return board;
  const without = board.columns.map((c) =>
    c.id === from.column.id ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) } : c,
  );
  const columns = without.map((c) => {
    if (c.id !== toColumnId) return c;
    const ids = [...c.cardIds];
    const i = Math.max(0, Math.min(toIndex, ids.length));
    ids.splice(i, 0, cardId);
    return { ...c, cardIds: ids };
  });
  const card = { ...board.cards[cardId], lastEditedBy: by, updatedAt: Date.now() };
  return touch(board, columns, { ...board.cards, [cardId]: card });
}

export function updateCard(board: Board, cardId: string, patch: Partial<Omit<Card, 'id'>>, by: string | null): Board {
  const card = board.cards[cardId];
  if (!card) return board;
  const next: Card = { ...card, ...patch, lastEditedBy: by, updatedAt: Date.now() };
  if (patch.title !== undefined) next.title = patch.title.trim() || card.title;
  if (patch.assignee !== undefined) next.assignee = patch.assignee?.trim() || null;
  return touch(board, board.columns, { ...board.cards, [cardId]: next });
}

export function deleteCard(board: Board, cardId: string): Board {
  if (!board.cards[cardId]) return board;
  const cards = { ...board.cards };
  delete cards[cardId];
  const columns = board.columns.map((c) => ({ ...c, cardIds: c.cardIds.filter((id) => id !== cardId) }));
  return touch(board, columns, cards);
}

export function addColumn(board: Board, title: string): { board: Board; columnId: string } {
  const id = newId('c');
  return { board: touch(board, [...board.columns, { id, title: title.trim(), cardIds: [] }], board.cards), columnId: id };
}

export function renameColumn(board: Board, columnId: string, title: string): Board {
  const t = title.trim();
  if (!t) return board;
  return touch(board, board.columns.map((c) => (c.id === columnId ? { ...c, title: t } : c)), board.cards);
}

export function moveColumn(board: Board, columnId: string, delta: number): Board {
  const i = board.columns.findIndex((c) => c.id === columnId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= board.columns.length) return board;
  const columns = [...board.columns];
  [columns[i], columns[j]] = [columns[j], columns[i]];
  return touch(board, columns, board.cards);
}

/** Deletes a column. Its cards move to the neighbouring column so nothing is lost. */
export function deleteColumn(board: Board, columnId: string): Board {
  if (board.columns.length <= 1) return board;
  const i = board.columns.findIndex((c) => c.id === columnId);
  if (i < 0) return board;
  const orphaned = board.columns[i].cardIds;
  const target = i > 0 ? i - 1 : 1;
  const columns = board.columns
    .map((c, ci) => (ci === target ? { ...c, cardIds: [...c.cardIds, ...orphaned] } : c))
    .filter((c) => c.id !== columnId);
  return touch(board, columns, board.cards);
}

export function renameBoard(board: Board, title: string): Board {
  const t = title.trim();
  return t ? { ...board, title: t, updatedAt: Date.now() } : board;
}

const DONE_WORDS = /^(done|finished|complete|completed|closed|shipped|submitted)$/i;

/** The column that means "finished": one named like Done, otherwise the last column. */
export function doneColumn(board: Board): Column | undefined {
  return board.columns.find((c) => DONE_WORDS.test(c.title.trim())) ?? board.columns[board.columns.length - 1];
}

const DOING_WORDS = /^(doing|in progress|progress|working on it|working|started|active|current|now)$/i;

/** The column that means "in progress": one named like Doing, otherwise the second column. */
export function doingColumn(board: Board): Column | undefined {
  return board.columns.find((c) => DOING_WORDS.test(c.title.trim())) ?? board.columns[Math.min(1, board.columns.length - 1)];
}

/** Everyone named on the board, in first-seen order. */
export function peopleOn(board: Board): string[] {
  const seen = new Map<string, string>();
  for (const col of board.columns) {
    for (const id of col.cardIds) {
      for (const name of [board.cards[id]?.assignee, board.cards[id]?.lastEditedBy]) {
        if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
      }
    }
  }
  return [...seen.values()];
}

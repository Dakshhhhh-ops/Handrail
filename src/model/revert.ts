/**
 * Per-action undo for a shared board.
 *
 * Undoing by restoring "the board as it was before my action" would also wipe out
 * everything teammates did since (their edits arrive by link or live session).
 * Instead, an action is remembered as two snapshots, `before` and `after`, and
 * undo puts back only what that action changed, and only where the board still
 * shows the action's result. Anything a teammate has changed again since is left
 * alone and counted in `skipped`, so the app can say so.
 *
 * Redo is the same operation with the snapshots swapped.
 */
import { deleteCard, locate, moveCard, renameBoard, renameColumn, updateCard } from './board';
import type { Board, Card } from './types';

const FIELDS = ['title', 'notes', 'due', 'assignee'] as const;

export interface RevertResult {
  board: Board;
  /** Parts of the action that were not undone because someone changed them again. */
  skipped: number;
}

function insertCard(board: Board, card: Card, columnId: string, index: number): Board {
  const col = board.columns.find((c) => c.id === columnId) ?? board.columns[0];
  if (!col) return board;
  return {
    ...board,
    cards: { ...board.cards, [card.id]: card },
    columns: board.columns.map((c) => {
      if (c.id !== col.id) return c;
      const ids = [...c.cardIds];
      ids.splice(Math.min(index, ids.length), 0, card.id);
      return { ...c, cardIds: ids };
    }),
  };
}

export function revertEdit(
  current: Board, before: Board, after: Board, by: string | null,
  /** The newest known fields of a deleted card (teammates may have edited it after it was deleted here). */
  latest?: (cardId: string) => Partial<Pick<Card, (typeof FIELDS)[number]>> | undefined,
): RevertResult {
  let b = current;
  let skipped = 0;

  if (before.title !== after.title) {
    if (b.title === after.title) b = renameBoard(b, before.title);
    else skipped++;
  }

  // Columns the action added, removed or renamed.
  const beforeCols = new Map(before.columns.map((c, i) => [c.id, { c, i }]));
  const afterCols = new Map(after.columns.map((c) => [c.id, c]));
  for (const [id, { c, i }] of beforeCols) {
    if (!afterCols.has(id) && !b.columns.some((x) => x.id === id)) {
      const columns = [...b.columns];
      columns.splice(Math.min(i, columns.length), 0, { id, title: c.title, cardIds: [] });
      b = { ...b, columns };
    }
  }
  for (const c of after.columns) {
    const was = beforeCols.get(c.id)?.c;
    const now = b.columns.find((x) => x.id === c.id);
    if (!was) {
      // Added by the action: remove it again, unless someone has put cards in it since.
      if (now && now.cardIds.every((id) => !b.cards[id] || after.cards[id])) {
        const keep = now.cardIds.filter((id) => !after.cards[id] || before.cards[id]);
        if (keep.length === 0 && b.columns.length > 1) b = { ...b, columns: b.columns.filter((x) => x.id !== c.id) };
        else skipped++;
      }
    } else if (was.title !== c.title) {
      if (now && now.title === c.title) b = renameColumn(b, c.id, was.title);
      else skipped++;
    }
  }

  // Cards the action added: take them away again.
  for (const id of Object.keys(after.cards)) {
    if (!before.cards[id] && b.cards[id]) b = deleteCard(b, id);
  }

  // Cards the action deleted: bring them back where they were, unless someone else brought them back already.
  for (const [id, card] of Object.entries(before.cards)) {
    if (after.cards[id] || b.cards[id]) continue;
    const loc = locate(before, id);
    if (loc) b = insertCard(b, { ...card, ...latest?.(id), lastEditedBy: by, updatedAt: Date.now() }, loc.column.id, loc.index);
  }

  // Cards the action edited or moved.
  for (const [id, was] of Object.entries(before.cards)) {
    const done = after.cards[id];
    const now = b.cards[id];
    if (!done || !now) continue;
    const patch: Partial<Card> = {};
    for (const f of FIELDS) {
      if (was[f] === done[f]) continue;
      if (now[f] === done[f]) (patch as Record<string, unknown>)[f] = was[f];
      else skipped++;
    }
    if (Object.keys(patch).length) b = updateCard(b, id, patch, by);

    const from = locate(before, id);
    const to = locate(after, id);
    const here = locate(b, id);
    if (from && to && here && (from.column.id !== to.column.id || from.index !== to.index)) {
      if (here.column.id === to.column.id && b.columns.some((c) => c.id === from.column.id)) {
        b = moveCard(b, id, from.column.id, from.index, by);
      } else skipped++;
    }
  }

  return { board: b, skipped };
}

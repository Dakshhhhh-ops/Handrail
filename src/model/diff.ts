import { describeDue } from './dates';
import { locate } from './board';
import { sameName, whoLabel } from './describe';
import type { Conflict } from './crdt';
import type { Board } from './types';

export type ChangeKind = 'added' | 'removed' | 'moved' | 'renamed' | 'due' | 'assigned' | 'notes' | 'column' | 'conflict';

export interface Change {
  kind: ChangeKind;
  cardId?: string;
  text: string;
  /** True when the change involves a card assigned to the viewer. */
  forYou: boolean;
  /** Who made the change, when known. */
  by?: string | null;
  /** The card's title, for grouping changes into a summary. */
  title?: string;
  /** Where it went: the column for moves and additions, the person for assignments, the date for due dates. */
  to?: string | null;
}

/**
 * Compares the version of a board you last looked at with the current one and
 * describes every difference in a sentence. Your own edits are left out.
 */
export function diffBoards(before: Board, after: Board, me: string | null, today: Date): Change[] {
  const out: Change[] = [];
  const by = (name: string | null) => (name ? `${whoLabel(name, me) === 'you' ? 'You' : name}` : 'Someone');
  const mine = (name: string | null) => sameName(name, me);

  const beforeCols = new Map(before.columns.map((c) => [c.id, c]));
  const afterCols = new Map(after.columns.map((c) => [c.id, c]));
  if (before.title !== after.title && !mine(after.titleBy ?? null)) {
    out.push({ kind: 'column', text: `${by(after.titleBy ?? null)} renamed the board to “${after.title}”.`, forYou: false, by: after.titleBy ?? null });
  }
  for (const c of after.columns) {
    const old = beforeCols.get(c.id);
    if (!old) out.push({ kind: 'column', text: `New column “${c.title}”.`, forYou: false });
    else if (old.title !== c.title) out.push({ kind: 'column', text: `Column “${old.title}” is now called “${c.title}”.`, forYou: false });
  }
  for (const c of before.columns) {
    if (!afterCols.has(c.id)) out.push({ kind: 'column', text: `Column “${c.title}” was removed.`, forYou: false });
  }

  for (const col of after.columns) {
    for (const id of col.cardIds) {
      const now = after.cards[id];
      const was = before.cards[id];
      // Credit each part of the change to whoever wrote that part (falls back to the last editor).
      const author = (f: 'title' | 'notes' | 'due' | 'assignee' | 'place' | 'alive') =>
        now.fieldBy && now.fieldBy[f] !== undefined ? now.fieldBy[f] ?? null : now.lastEditedBy;
      const push = (c: Omit<Change, 'by'>, who: string | null) => {
        if (!mine(who)) out.push({ ...c, by: who });
      };
      const forYou = mine(now.assignee);

      if (!was) {
        const extra: string[] = [];
        if (now.due) extra.push(describeDue(now.due, today).spoken);
        if (now.assignee) extra.push(`assigned to ${whoLabel(now.assignee, me)}`);
        const who = author('alive');
        push({ kind: 'added', cardId: id, title: now.title, to: col.title, text: `${by(who)} added “${now.title}” to ${col.title}${extra.length ? `, ${extra.join(', ')}` : ''}.`, forYou }, who);
        continue;
      }
      if (was.title !== now.title) {
        const who = author('title');
        push({ kind: 'renamed', cardId: id, title: now.title, to: now.title, text: `${by(who)} renamed “${was.title}” to “${now.title}”.`, forYou }, who);
      }

      const oldLoc = locate(before, id);
      if (oldLoc && oldLoc.column.id !== col.id) {
        if (!afterCols.has(oldLoc.column.id)) {
          // Its column was deleted, so it now shows in the neighbouring column.
          out.push({ kind: 'moved', cardId: id, title: now.title, to: col.title, text: `“${now.title}” is now in ${col.title}, because the ${oldLoc.column.title} column was removed.`, forYou, by: null });
        } else {
          const fromName = afterCols.get(oldLoc.column.id)?.title ?? oldLoc.column.title;
          const who = author('place');
          push({ kind: 'moved', cardId: id, title: now.title, to: col.title, text: `${by(who)} moved “${now.title}” from ${fromName} to ${col.title}.`, forYou }, who);
        }
      }
      if (!sameName(was.assignee, now.assignee) && (was.assignee || now.assignee)) {
        const who = author('assignee');
        const text = now.assignee
          ? `${by(who)} assigned “${now.title}” to ${whoLabel(now.assignee, me)}.`
          : `${by(who)} unassigned “${now.title}”${was.assignee ? ` (was ${whoLabel(was.assignee, me)})` : ''}.`;
        push({ kind: 'assigned', cardId: id, title: now.title, to: now.assignee, text, forYou: forYou || mine(was.assignee) }, who);
      }
      if (was.due !== now.due) {
        const who = author('due');
        const text = now.due
          ? `${by(who)} set “${now.title}” ${describeDue(now.due, today).spoken}.`
          : `${by(who)} removed the due date from “${now.title}”.`;
        push({ kind: 'due', cardId: id, title: now.title, to: now.due, text, forYou }, who);
      }
      if (was.notes.trim() !== now.notes.trim()) {
        const who = author('notes');
        push({ kind: 'notes', cardId: id, title: now.title, text: `${by(who)} updated the notes on “${now.title}”.`, forYou }, who);
      }
    }
  }

  for (const id of Object.keys(before.cards)) {
    if (!after.cards[id] && locate(before, id)) {
      const was = before.cards[id];
      const who = after.removed?.[id]?.by ?? null;
      if (who && mine(who)) continue;
      out.push({ kind: 'removed', title: was.title, text: who ? `${by(who)} deleted “${was.title}”.` : `“${was.title}” was removed.`, forYou: mine(was.assignee), by: who });
    }
  }

  // Changes that involve you come first; otherwise keep board order.
  return out.map((c, i) => ({ c, i })).sort((a, b) => Number(b.c.forYou) - Number(a.c.forYou) || a.i - b.i).map((x) => x.c);
}

/** Plain-language notes for edits that crossed, so nobody's change disappears silently. */
export function describeConflicts(conflicts: Conflict[], board: Board): Change[] {
  return conflicts.map((c) => {
    const title = c.cardId ? board.cards[c.cardId]?.title ?? 'a card that was deleted since' : null;
    const other = c.other ?? 'a teammate';
    const otherOwn = c.other ? `${c.other}’s` : 'theirs';
    if (c.field === 'deleted-edited') {
      return {
        kind: 'conflict' as const,
        cardId: c.cardId && board.cards[c.cardId] ? c.cardId : undefined,
        title: board.removed?.[c.cardId ?? '']?.title ?? title ?? undefined,
        text: `${other} changed “${board.removed?.[c.cardId ?? '']?.title ?? title}” while you were deleting it. It stays deleted; undo your delete to bring it back with ${c.other ? `${c.other}’s` : 'their'} changes.`,
        forYou: true,
        by: c.other,
      };
    }
    if (c.field === 'edited-deleted') {
      return {
        kind: 'conflict' as const,
        title: board.removed?.[c.cardId ?? '']?.title ?? undefined,
        text: `${other} deleted “${board.removed?.[c.cardId ?? '']?.title ?? 'a card'}” while you were changing it, so your change is not on the board.`,
        forYou: true,
        by: c.other,
      };
    }
    const colTitle = c.columnId ? board.columns.find((x) => x.id === c.columnId)?.title : null;
    const what = {
      column: `renamed the column now called “${colTitle ?? '?'}”`,
      'deleted-edited': '',
      'edited-deleted': '',
      title: c.cardId ? `renamed “${title}”` : 'renamed the board',
      notes: `edited the notes on “${title}”`,
      due: `changed the due date of “${title}”`,
      assignee: `changed who owns “${title}”`,
      place: `moved “${title}”`,
      alive: `changed whether “${title}” exists (one of you deleted it)`,
    }[c.field];
    const fix = c.field === 'column' || (c.field === 'title' && !c.cardId) ? 'Rename it again' : 'Edit the card';
    const kept = c.kept === 'yours' ? 'kept yours' : `kept ${otherOwn}. ${fix} if you want yours back`;
    return {
      kind: 'conflict' as const,
      cardId: c.cardId && board.cards[c.cardId] ? c.cardId : undefined,
      title: title ?? undefined,
      text: `You and ${other} both ${what} at the same time. Handrail ${kept}.`,
      forYou: true,
      by: c.other,
    };
  });
}

import { describeDue } from './dates';
import { locate } from './board';
import { sameName, whoLabel } from './describe';
import type { Board } from './types';

export type ChangeKind = 'added' | 'removed' | 'moved' | 'renamed' | 'due' | 'assigned' | 'notes' | 'column';

export interface Change {
  kind: ChangeKind;
  cardId?: string;
  text: string;
  /** True when the change involves a card assigned to the viewer. */
  forYou: boolean;
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
      const who = now.lastEditedBy;
      if (mine(who)) continue;
      const forYou = mine(now.assignee);

      if (!was) {
        const extra: string[] = [];
        if (now.due) extra.push(describeDue(now.due, today).spoken);
        if (now.assignee) extra.push(`assigned to ${whoLabel(now.assignee, me)}`);
        out.push({ kind: 'added', cardId: id, text: `${by(who)} added “${now.title}” to ${col.title}${extra.length ? `, ${extra.join(', ')}` : ''}.`, forYou });
        continue;
      }
      if (was.title !== now.title)
        out.push({ kind: 'renamed', cardId: id, text: `${by(who)} renamed “${was.title}” to “${now.title}”.`, forYou });

      const oldLoc = locate(before, id);
      if (oldLoc && oldLoc.column.id !== col.id) {
        const fromName = afterCols.get(oldLoc.column.id)?.title ?? oldLoc.column.title;
        out.push({ kind: 'moved', cardId: id, text: `${by(who)} moved “${now.title}” from ${fromName} to ${col.title}.`, forYou });
      }
      if (!sameName(was.assignee, now.assignee) && (was.assignee || now.assignee)) {
        const text = now.assignee
          ? `${by(who)} assigned “${now.title}” to ${whoLabel(now.assignee, me)}.`
          : `${by(who)} unassigned “${now.title}”${was.assignee ? ` (was ${whoLabel(was.assignee, me)})` : ''}.`;
        out.push({ kind: 'assigned', cardId: id, text, forYou: forYou || mine(was.assignee) });
      }
      if (was.due !== now.due) {
        const text = now.due
          ? `${by(who)} set “${now.title}” ${describeDue(now.due, today).spoken}.`
          : `${by(who)} removed the due date from “${now.title}”.`;
        out.push({ kind: 'due', cardId: id, text, forYou });
      }
      if (was.notes.trim() !== now.notes.trim())
        out.push({ kind: 'notes', cardId: id, text: `${by(who)} updated the notes on “${now.title}”.`, forYou });
    }
  }

  for (const id of Object.keys(before.cards)) {
    if (!after.cards[id] && locate(before, id)) {
      const was = before.cards[id];
      out.push({ kind: 'removed', text: `“${was.title}” was removed.`, forYou: mine(was.assignee) });
    }
  }

  // Changes that involve you come first; otherwise keep board order.
  return out.map((c, i) => ({ c, i })).sort((a, b) => Number(b.c.forYou) - Number(a.c.forYou) || a.i - b.i).map((x) => x.c);
}

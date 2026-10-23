import { doingColumn, doneColumn, peopleOn } from './board';
import type { Command } from './commands';
import { describeDue, parseDue } from './dates';
import { whoLabel } from './describe';
import { findCard, findColumn, findPerson } from './match';
import type { Board } from './types';

export interface Preview {
  text: string;
  /** False when the command would fail (unknown wording, or a card or column that can't be found). */
  ok: boolean;
}

const q = (s: string) => `“${s}”`;

/** Describes, without doing anything, what a parsed command would do on this board. */
export function previewCommand(cmd: Command, board: Board, ctx: { today: Date; me: string | null }): Preview {
  const card = (query: string): { title?: string; problem?: string } => {
    const r = findCard(board, query);
    if (r.match) return { title: r.match.title };
    if (r.ambiguous) return { problem: `More than one card matches ${q(query)}` };
    return { problem: `No card called ${q(query)}` };
  };
  const column = (query: string): { title?: string; problem?: string } => {
    const r = findColumn(board, query);
    return r.match ? { title: r.match.title } : { problem: `No column called ${q(query)}` };
  };
  const withCard = (query: string, f: (title: string) => string): Preview => {
    const c = card(query);
    return c.title ? { text: f(c.title), ok: true } : { text: c.problem!, ok: false };
  };

  switch (cmd.type) {
    case 'add': {
      const col = cmd.column ? column(cmd.column) : { title: board.columns[0]?.title };
      if (!col.title) return { text: col.problem!, ok: false };
      const due = cmd.due ? parseDue(cmd.due, ctx.today) : null;
      const who = cmd.assignee ? findPerson(peopleOn(board), cmd.assignee, ctx.me) ?? cmd.assignee : null;
      const extra = [due ? describeDue(due, ctx.today).spoken : '', who ? `for ${whoLabel(who, ctx.me)}` : ''].filter(Boolean).join(', ');
      return { text: `Add ${q(cmd.title)} to ${col.title}${extra ? `, ${extra}` : ''}`, ok: true };
    }
    case 'addColumn':
      return { text: `Add a column called ${q(cmd.title)}`, ok: true };
    case 'move': {
      const col = cmd.column ? column(cmd.column) : { title: undefined };
      if (cmd.column && !col.title) return { text: col.problem!, ok: false };
      const where = col.title ? ` to ${col.title}` : '';
      const pos = cmd.position ? ` ${col.title ? 'at the' : 'to the'} ${cmd.position}` : '';
      return withCard(cmd.card, (t) => `Move ${q(t)}${where}${pos}`);
    }
    case 'nudge':
      return withCard(cmd.card, (t) => `Move ${q(t)} ${cmd.direction} one place`);
    case 'done':
      return withCard(cmd.card, (t) => `Move ${q(t)} to ${doneColumn(board)?.title ?? 'the last column'}`);
    case 'start':
      return withCard(cmd.card, (t) => `Move ${q(t)} to ${doingColumn(board)?.title ?? 'the second column'}`);
    case 'delete':
      return withCard(cmd.card, (t) => `Delete ${q(t)} (you can undo)`);
    case 'rename':
      return withCard(cmd.card, (t) => `Rename ${q(t)} to ${q(cmd.title)}`);
    case 'due':
      return withCard(cmd.card, (t) => (cmd.due ? `Set ${q(t)} ${describeDue(cmd.due, ctx.today).spoken}` : `Remove the due date from ${q(t)}`));
    case 'assign':
      return withCard(cmd.card, (t) => {
        if (!cmd.person) return `Unassign ${q(t)}`;
        const who = findPerson(peopleOn(board), cmd.person, ctx.me) ?? cmd.person;
        return `Assign ${q(t)} to ${whoLabel(who, ctx.me)}`;
      });
    case 'note':
      return withCard(cmd.card, (t) => `Add a note to ${q(t)}`);
    case 'read': {
      const col = column(cmd.target);
      return col.title ? { text: `Read the ${col.title} column`, ok: true } : { text: col.problem!, ok: false };
    }
    case 'readCard':
      return withCard(cmd.card, (t) => `Read ${q(t)}`);
    case 'find':
      return withCard(cmd.card, (t) => `Find ${q(t)}`);
    case 'whatsDue':
      return {
        text: { overdue: 'List overdue cards', today: 'List cards due today or overdue', tomorrow: 'List cards due tomorrow', week: 'List cards due in the next 7 days', all: 'List cards with a due date' }[cmd.range],
        ok: true,
      };
    case 'person': {
      const who = findPerson(peopleOn(board), cmd.person, ctx.me);
      return who ? { text: `List ${whoLabel(who, ctx.me) === 'you' ? 'your' : `${who}’s`} open cards`, ok: true } : { text: `Nobody called ${q(cmd.person)} on this board`, ok: false };
    }
    case 'owner':
      return withCard(cmd.card, (t) => `Say who has ${q(t)}`);
    case 'mine':
      return { text: 'List your open cards', ok: true };
    case 'summary':
      return { text: 'Read a summary of the board', ok: true };
    case 'changes':
      return { text: 'Read what changed since you last looked', ok: true };
    case 'more':
      return { text: 'Read the rest of the summary', ok: true };
    case 'repeat':
      return { text: 'Say the last message again', ok: true };
    case 'undo':
      return { text: 'Undo the last change', ok: true };
    case 'redo':
      return { text: 'Redo the last undone change', ok: true };
    case 'help':
      return { text: 'Open help', ok: true };
    case 'unknown':
    default:
      return { text: 'I don’t understand that yet', ok: false };
  }
}

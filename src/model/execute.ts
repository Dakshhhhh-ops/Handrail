import {
  addCard, addColumn, deleteCard, doingColumn, doneColumn, locate, moveCard, peopleOn, updateCard,
} from './board';
import type { Command } from './commands';
import { parseDue } from './dates';
import { boardSummary, cardDetails, columnReport, dueReport, mineReport, personReport, positionText, whoLabel } from './describe';
import { findCard, findColumn, findPerson, type MatchResult } from './match';
import type { Board, Card, Column } from './types';

export interface ExecContext {
  today: Date;
  me: string | null;
}

export interface ExecResult {
  ok: boolean;
  /** Spoken and shown to the user. */
  message: string;
  /** New board state, when the command changed something. */
  board?: Board;
  /** Short description used for undo ("Undid: moved …"). */
  label?: string;
  /** Card that should receive keyboard focus afterwards. */
  focusCardId?: string;
  /** Something the app itself must do. */
  effect?: 'undo' | 'redo' | 'help' | 'changes';
}

const quote = (s: string) => `“${s}”`;

function whichOne<T>(r: MatchResult<T>, name: (t: T) => string, what: string, query: string): string {
  if (r.ambiguous && r.candidates.length > 1) {
    const opts = r.candidates.slice(0, 3).map((c) => quote(name(c)));
    return `More than one ${what} matches ${quote(query)}: ${opts.join(' or ')}. Say a bit more of the name.`;
  }
  return `I couldn't find a ${what} called ${quote(query)}.`;
}

function resolveCard(board: Board, query: string): { card?: Card; error?: string } {
  const r = findCard(board, query);
  if (r.match) return { card: r.match };
  return { error: whichOne(r, (c) => c.title, 'card', query) };
}

function resolveColumn(board: Board, query: string): { column?: Column; error?: string } {
  const r = findColumn(board, query);
  if (r.match) return { column: r.match };
  const names = board.columns.map((c) => c.title).join(', ');
  return { error: `${whichOne(r, (c) => c.title, 'column', query)} Columns are: ${names}.` };
}

function moveTo(board: Board, card: Card, column: Column, position: 'top' | 'bottom' | undefined, ctx: ExecContext): ExecResult {
  const from = locate(board, card.id)!;
  const index = position === 'top' ? 0 : column.cardIds.filter((id) => id !== card.id).length;
  if (from.column.id === column.id && position === undefined) {
    return { ok: true, message: `${quote(card.title)} is already in ${column.title}.`, focusCardId: card.id };
  }
  const next = moveCard(board, card.id, column.id, index, ctx.me);
  const verb = from.column.id === column.id ? `Moved ${quote(card.title)} to the ${position}` : `Moved ${quote(card.title)} to ${column.title}`;
  return {
    ok: true,
    board: next,
    label: `${verb.replace(/^Moved/, 'move')}`,
    message: `${verb}. ${positionText(next, card.id)}.`,
    focusCardId: card.id,
  };
}

export function executeCommand(cmd: Command, board: Board, ctx: ExecContext): ExecResult {
  const { today, me } = ctx;
  switch (cmd.type) {
    case 'undo': return { ok: true, message: '', effect: 'undo' };
    case 'redo': return { ok: true, message: '', effect: 'redo' };
    case 'help': return { ok: true, message: '', effect: 'help' };
    case 'changes': return { ok: true, message: '', effect: 'changes' };
    case 'summary': return { ok: true, message: boardSummary(board, today, me) };
    case 'mine': return { ok: true, message: mineReport(board, today, me) };
    case 'person': {
      const who = findPerson(peopleOn(board), cmd.person, me);
      if (!who) return { ok: false, message: `Nobody called ${quote(cmd.person)} has cards on this board. People here: ${peopleOn(board).join(', ') || 'none yet'}.` };
      return { ok: true, message: personReport(board, who, today, me) };
    }
    case 'owner': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      return {
        ok: true,
        message: c.card.assignee ? `${quote(c.card.title)} is assigned to ${whoLabel(c.card.assignee, me)}.` : `Nobody has ${quote(c.card.title)} yet. Say “assign ${c.card.title.toLowerCase()} to me” to take it.`,
        focusCardId: c.card.id,
      };
    }
    case 'whatsDue': return { ok: true, message: dueReport(board, cmd.range, today, me) };

    case 'add': {
      let column = board.columns[0];
      if (cmd.column) {
        const r = resolveColumn(board, cmd.column);
        if (!r.column) return { ok: false, message: r.error! };
        column = r.column;
      }
      const due = cmd.due ? parseDue(cmd.due, today) : null;
      let assignee: string | null = null;
      if (cmd.assignee) assignee = findPerson(peopleOn(board), cmd.assignee, me) ?? cmd.assignee.replace(/^./, (c) => c.toUpperCase());
      const { board: next, cardId } = addCard(board, column.id, { title: cmd.title, due, assignee }, me);
      const details = cardDetails(next.cards[cardId], today, me);
      return {
        ok: true,
        board: next,
        label: `add ${quote(cmd.title)}`,
        message: `Added ${quote(cmd.title)} to ${column.title}${details ? `, ${details}` : ''}.`,
        focusCardId: cardId,
      };
    }

    case 'addColumn': {
      const { board: next } = addColumn(board, cmd.title);
      return { ok: true, board: next, label: `add column ${quote(cmd.title)}`, message: `Added a column called ${quote(cmd.title)} at the end.` };
    }

    case 'move': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      let column = locate(board, c.card.id)!.column;
      if (cmd.column) {
        const r = resolveColumn(board, cmd.column);
        if (!r.column) return { ok: false, message: r.error! };
        column = r.column;
      }
      return moveTo(board, c.card, column, cmd.position, ctx);
    }

    case 'nudge': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      const loc = locate(board, c.card.id)!;
      const to = loc.index + (cmd.direction === 'up' ? -1 : 1);
      if (to < 0 || to >= loc.column.cardIds.length) {
        return { ok: true, message: `${quote(c.card.title)} is already at the ${cmd.direction === 'up' ? 'top' : 'bottom'} of ${loc.column.title}.`, focusCardId: c.card.id };
      }
      const next = moveCard(board, c.card.id, loc.column.id, to, me);
      return { ok: true, board: next, label: `move ${quote(c.card.title)} ${cmd.direction}`, message: `Moved ${cmd.direction}. ${positionText(next, c.card.id)}.`, focusCardId: c.card.id };
    }

    case 'done':
    case 'start': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      const column = cmd.type === 'done' ? doneColumn(board) : doingColumn(board);
      if (!column) return { ok: false, message: 'This board has no columns.' };
      return moveTo(board, c.card, column, undefined, ctx);
    }

    case 'delete': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      const loc = locate(board, c.card.id)!;
      const next = deleteCard(board, c.card.id);
      const neighbour = loc.column.cardIds[loc.index + 1] ?? loc.column.cardIds[loc.index - 1];
      return {
        ok: true,
        board: next,
        label: `delete ${quote(c.card.title)}`,
        message: `Deleted ${quote(c.card.title)} from ${loc.column.title}. Say “undo” or press Control Z to bring it back.`,
        focusCardId: neighbour,
      };
    }

    case 'rename': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      const next = updateCard(board, c.card.id, { title: cmd.title }, me);
      return { ok: true, board: next, label: `rename ${quote(c.card.title)}`, message: `Renamed ${quote(c.card.title)} to ${quote(cmd.title)}.`, focusCardId: c.card.id };
    }

    case 'due': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      const next = updateCard(board, c.card.id, { due: cmd.due }, me);
      const msg = cmd.due ? `${quote(c.card.title)} is now ${cardDetails({ ...next.cards[c.card.id], assignee: null, notes: '' }, today, me)}.` : `Removed the due date from ${quote(c.card.title)}.`;
      return { ok: true, board: next, label: `change the due date of ${quote(c.card.title)}`, message: msg, focusCardId: c.card.id };
    }

    case 'assign': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      let person: string | null = null;
      if (cmd.person) {
        person = findPerson(peopleOn(board), cmd.person, me);
        if (!person) {
          if (/^(me|myself|i)$/i.test(cmd.person)) return { ok: false, message: 'Set your name in Settings first, so Handrail knows who “me” is.' };
          person = cmd.person.replace(/^./, (ch) => ch.toUpperCase());
        }
      }
      const next = updateCard(board, c.card.id, { assignee: person }, me);
      const msg = person ? `Assigned ${quote(c.card.title)} to ${whoLabel(person, me)}.` : `${quote(c.card.title)} is no longer assigned to anyone.`;
      return { ok: true, board: next, label: `assign ${quote(c.card.title)}`, message: msg, focusCardId: c.card.id };
    }

    case 'note': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      const notes = c.card.notes.trim() ? `${c.card.notes.trim()}\n${cmd.text}` : cmd.text;
      const next = updateCard(board, c.card.id, { notes }, me);
      return { ok: true, board: next, label: `add a note to ${quote(c.card.title)}`, message: `Added a note to ${quote(c.card.title)}.`, focusCardId: c.card.id };
    }

    case 'read': {
      const r = resolveColumn(board, cmd.target);
      if (!r.column) return { ok: false, message: r.error! };
      return { ok: true, message: columnReport(board, r.column, today, me), focusCardId: r.column.cardIds[0] };
    }

    case 'readCard':
    case 'find': {
      const c = resolveCard(board, cmd.card);
      if (!c.card) return { ok: false, message: c.error! };
      const details = cardDetails(c.card, today, me);
      const notes = cmd.type === 'readCard' && c.card.notes.trim() ? ` Notes: ${c.card.notes.trim()}` : '';
      return {
        ok: true,
        message: `${c.card.title}${details ? `, ${details.replace(', has notes', '')}` : ''}. In ${positionText(board, c.card.id)}.${notes}`,
        focusCardId: c.card.id,
      };
    }

    case 'unknown':
    default:
      return {
        ok: false,
        message: `Sorry, I didn't understand ${quote((cmd as { text: string }).text)}. Try “add essay outline due friday”, “move lab report to done”, or say “help”.`,
      };
  }
}

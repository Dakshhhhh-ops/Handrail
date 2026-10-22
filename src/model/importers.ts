import { createBoard, newId } from './board';
import { describeDue, isISODate } from './dates';
import { validateBoard } from './validate';
import type { Board, Card } from './types';

/**
 * Imports the JSON file Trello gives you from Board menu → Print, export and share → Export as JSON.
 * Archived lists and cards are skipped.
 */
export function importTrello(raw: unknown): Board | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.lists) || !Array.isArray(r.cards)) return null;

  const members = new Map<string, string>();
  for (const m of Array.isArray(r.members) ? r.members : []) {
    const mm = m as Record<string, unknown>;
    if (typeof mm.id === 'string') members.set(mm.id, String(mm.fullName || mm.username || '').trim());
  }

  type L = { id: string; name: string; pos: number; closed?: boolean };
  type C = { id: string; name: string; desc?: string; due?: string | null; idList: string; pos: number; closed?: boolean; idMembers?: string[] };
  const lists = (r.lists as L[]).filter((l) => l && !l.closed && typeof l.id === 'string').sort((a, b) => a.pos - b.pos);
  const cards = (r.cards as C[]).filter((c) => c && !c.closed && typeof c.name === 'string').sort((a, b) => a.pos - b.pos);

  const board: Board = {
    id: newId('b'),
    title: typeof r.name === 'string' && r.name.trim() ? r.name : 'Imported from Trello',
    columns: lists.map((l) => ({ id: newId('c'), title: String(l.name || 'Untitled'), cardIds: [] as string[] })),
    cards: {},
    updatedAt: Date.now(),
  };
  const colByList = new Map(lists.map((l, i) => [l.id, board.columns[i]]));
  for (const c of cards) {
    const col = colByList.get(c.idList);
    if (!col) continue;
    const id = newId('k');
    const due = typeof c.due === 'string' ? c.due.slice(0, 10) : null;
    const assignee = (c.idMembers ?? []).map((m) => members.get(m)).find(Boolean) ?? null;
    board.cards[id] = {
      id, title: c.name, notes: c.desc ?? '', due: due && isISODate(due) ? due : null,
      assignee, lastEditedBy: null, updatedAt: Date.now(),
    };
    col.cardIds.push(id);
  }
  if (board.columns.length === 0) return null;
  return validateBoard(board);
}

/** Imports a board saved with Handrail's own "Download backup". */
export function importHandrailJson(raw: unknown): Board | null {
  const r = raw as Record<string, unknown> | null;
  if (r && r.app === 'handrail' && r.board) return validateBoard(r.board);
  return validateBoard(raw);
}

export function exportJson(board: Board): string {
  return JSON.stringify({ app: 'handrail', version: 1, board }, null, 2);
}

// ---- CSV -------------------------------------------------------------------

const CSV_HEADERS = ['Column', 'Title', 'Due', 'Assignee', 'Notes'];

function csvCell(v: string): string {
  // Guard against spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function exportCsv(board: Board): string {
  const rows = [CSV_HEADERS];
  for (const col of board.columns) {
    for (const id of col.cardIds) {
      const k = board.cards[id];
      rows.push([col.title, k.title, k.due ?? '', k.assignee ?? '', k.notes]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function importCsv(text: string, title = 'Imported board'): Board | null {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iCol = idx(['column', 'list', 'status', 'stage']);
  const iTitle = idx(['title', 'name', 'card', 'task']);
  if (iTitle < 0) return null;
  const iDue = idx(['due', 'due date', 'deadline']);
  const iWho = idx(['assignee', 'assigned to', 'owner', 'member']);
  const iNotes = idx(['notes', 'description', 'desc']);

  const board = createBoard(title, []);
  for (const r of rows.slice(1)) {
    const name = (r[iTitle] ?? '').trim();
    if (!name) continue;
    const colName = (iCol >= 0 ? r[iCol] : '')?.trim() || 'To do';
    let col = board.columns.find((c) => c.title.toLowerCase() === colName.toLowerCase());
    if (!col) {
      col = { id: newId('c'), title: colName, cardIds: [] };
      board.columns.push(col);
    }
    const due = iDue >= 0 ? (r[iDue] ?? '').trim().slice(0, 10) : '';
    const id = newId('k');
    const card: Card = {
      id, title: name.replace(/^'(?=[=+\-@])/, ''), notes: iNotes >= 0 ? r[iNotes] ?? '' : '',
      due: isISODate(due) ? due : null, assignee: iWho >= 0 ? (r[iWho] ?? '').trim() || null : null,
      lastEditedBy: null, updatedAt: Date.now(),
    };
    board.cards[id] = card;
    col.cardIds.push(id);
  }
  return board.columns.length ? validateBoard(board) : null;
}

/** A plain-text version that reads well in email, chat, or a screen reader. */
export function exportMarkdown(board: Board, today: Date): string {
  const lines = [`# ${board.title}`, ''];
  for (const col of board.columns) {
    lines.push(`## ${col.title} (${col.cardIds.length})`, '');
    if (col.cardIds.length === 0) lines.push('_Empty_', '');
    for (const id of col.cardIds) {
      const k = board.cards[id];
      const extra = [k.due ? describeDue(k.due, today).spoken : '', k.assignee ? `assigned to ${k.assignee}` : ''].filter(Boolean);
      lines.push(`- ${k.title}${extra.length ? ` (${extra.join(', ')})` : ''}`);
      if (k.notes.trim()) lines.push(...k.notes.trim().split('\n').map((n) => `  - ${n}`));
    }
    lines.push('');
  }
  return lines.join('\n');
}

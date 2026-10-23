/**
 * Turns a list of changes into a short written digest, grouped by person:
 *
 *   "Riya gave you “Email Dr. Mehta”, moved “Design slides” to Done and added
 *    “Rehearse together on call”. Arjun moved “Write the script” to Doing."
 *
 * Rules: people whose changes involve you come first; repeated actions are
 * folded together ("moved 3 cards to Done: …"); long lists are cut short with
 * "and 2 more" so the digest stays readable when spoken.
 */
import { describeDue } from './dates';
import { sameName } from './describe';
import type { Change } from './diff';

const MAX_LISTED = 3;

const q = (s: string) => `“${s}”`;

/** "A", "A and B", "A, B and C". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Up to three quoted titles, then "and N more". */
function titles(list: string[]): string {
  const unique = [...new Set(list)];
  const shown = unique.slice(0, MAX_LISTED).map(q);
  const rest = unique.length - shown.length;
  return listJoin(rest > 0 ? [...shown, `${rest} more`] : shown);
}

function cards(list: string[], noun = 'card'): string {
  const n = new Set(list).size;
  return n === 1 ? titles(list) : `${n} ${noun}s (${titles(list)})`;
}

/** Folds one person's changes into verb phrases, most relevant first. */
function phrases(changes: Change[], me: string | null, today: Date): string[] {
  const out: string[] = [];
  const of = (kind: Change['kind']) => changes.filter((c) => c.kind === kind && c.title);

  const toYou = of('assigned').filter((c) => sameName(c.to ?? null, me));
  if (toYou.length) out.push(`gave you ${cards(toYou.map((c) => c.title!))}`);

  const moves = new Map<string, string[]>();
  for (const c of of('moved')) moves.set(c.to ?? '?', [...(moves.get(c.to ?? '?') ?? []), c.title!]);
  for (const [to, list] of moves) out.push(`moved ${cards(list)} to ${to}`);

  const added = of('added');
  if (added.length) {
    const cols = new Set(added.map((c) => c.to));
    out.push(`added ${cards(added.map((c) => c.title!))}${cols.size === 1 ? ` to ${[...cols][0]}` : ''}`);
  }

  const due = of('due');
  if (due.length === 1) {
    const c = due[0];
    out.push(c.to ? `made ${q(c.title!)} ${describeDue(c.to, today).spoken}` : `cleared the due date on ${q(c.title!)}`);
  } else if (due.length) out.push(`changed due dates on ${cards(due.map((c) => c.title!))}`);

  const toOthers = of('assigned').filter((c) => !sameName(c.to ?? null, me));
  const byPerson = new Map<string, string[]>();
  for (const c of toOthers) {
    const key = c.to ?? '';
    byPerson.set(key, [...(byPerson.get(key) ?? []), c.title!]);
  }
  for (const [who, list] of byPerson) out.push(who ? `assigned ${cards(list)} to ${who}` : `unassigned ${cards(list)}`);

  const renamed = of('renamed');
  if (renamed.length) out.push(`renamed ${cards(renamed.map((c) => c.title!))}`);
  const notes = of('notes');
  if (notes.length) out.push(`updated notes on ${cards(notes.map((c) => c.title!))}`);
  return out;
}

export function summarize(changes: Change[], me: string | null, today: Date): string {
  return summarySentences(changes, me, today).join(' ');
}

/** The summary as separate sentences (one per person, then removals, columns and clashes), so it can be read a piece at a time. */
export function summarySentences(changes: Change[], me: string | null, today: Date): string[] {
  if (changes.length === 0) return ['Nothing has changed since you last looked.'];

  const people = new Map<string, Change[]>();
  for (const c of changes) {
    if (c.kind === 'conflict' || c.kind === 'column' || c.kind === 'removed') continue;
    const key = c.by ?? '';
    people.set(key, [...(people.get(key) ?? []), c]);
  }
  const order = [...people.entries()].sort(([, a], [, b]) => Number(b.some((c) => c.forYou)) - Number(a.some((c) => c.forYou)));

  const sentences: string[] = [];
  for (const [who, list] of order) {
    const ps = phrases(list, me, today);
    if (ps.length) sentences.push(`${who || 'Someone'} ${listJoin(ps)}.`);
  }

  const removed = changes.filter((c) => c.kind === 'removed' && c.title);
  if (removed.length) sentences.push(`${removed.length === 1 ? `${q(removed[0].title!)} was` : `${cards(removed.map((c) => c.title!))} were`} removed.`);
  const columns = changes.filter((c) => c.kind === 'column');
  if (columns.length) sentences.push(columns.length === 1 ? columns[0].text : `${columns.length} column changes.`);
  const clashes = changes.filter((c) => c.kind === 'conflict');
  if (clashes.length) {
    sentences.push(`${clashes.length === 1 ? 'One edit' : `${clashes.length} edits`} clashed with yours and ${clashes.length === 1 ? 'was' : 'were'} settled automatically; see the list.`);
  }
  return sentences;
}

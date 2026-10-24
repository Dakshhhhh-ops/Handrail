import { parseDue } from './dates';

export type DueRange = 'today' | 'tomorrow' | 'week' | 'overdue' | 'all';

export type Command =
  | { type: 'add'; title: string; column?: string; due?: string; assignee?: string }
  | { type: 'addColumn'; title: string }
  | { type: 'move'; card: string; column?: string; position?: 'top' | 'bottom' }
  | { type: 'nudge'; card: string; direction: 'up' | 'down' }
  | { type: 'done'; card: string }
  | { type: 'start'; card: string }
  | { type: 'delete'; card: string }
  | { type: 'rename'; card: string; title: string }
  | { type: 'due'; card: string; due: string | null; dueText: string }
  | { type: 'assign'; card: string; person: string | null }
  | { type: 'note'; card: string; text: string }
  | { type: 'read'; target: string }
  | { type: 'readCard'; card: string }
  | { type: 'whatsDue'; range: DueRange }
  | { type: 'mine' }
  | { type: 'person'; person: string }
  | { type: 'owner'; card: string }
  | { type: 'summary' }
  | { type: 'changes' }
  | { type: 'more' }
  | { type: 'next' }
  | { type: 'repeat' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'help' }
  | { type: 'find'; card: string }
  | { type: 'unknown'; text: string };

export interface ParseContext {
  today: Date;
  /** True when the text names one of the board's columns. */
  isColumn: (text: string) => boolean;
  /** True when the text names someone on the board (or "me"). */
  isPerson: (text: string) => boolean;
}

const clean = (s: string) => s.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

/** Splits "<title> due friday to doing for Riya" into the title and its trailing clauses. */
function splitClauses(text: string, ctx: ParseContext) {
  let rest = text;
  const out: { column?: string; due?: string; assignee?: string } = {};
  const kw = /\s+(due|by|on|to|into|in|for|assigned to|assign to|assign it to)\s+/gi;

  for (let guard = 0; guard < 5; guard++) {
    const matches = [...rest.matchAll(kw)];
    if (matches.length === 0) break;
    let accepted = false;
    // Try the clause closest to the end first.
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const word = m[1].toLowerCase();
      const value = clean(rest.slice((m.index ?? 0) + m[0].length));
      if (!value) continue;
      let ok = false;
      if (['due', 'by', 'on'].includes(word) && !out.due && parseDue(value, ctx.today)) {
        out.due = value;
        ok = true;
      } else if (['to', 'into', 'in'].includes(word) && !out.column && ctx.isColumn(value)) {
        out.column = value;
        ok = true;
      } else if (word.startsWith('assign') && !out.assignee) {
        out.assignee = value;
        ok = true;
      } else if (word === 'for' && !out.assignee && ctx.isPerson(value)) {
        out.assignee = value;
        ok = true;
      }
      if (ok) {
        rest = rest.slice(0, m.index);
        accepted = true;
      }
      break; // only the last clause can be peeled off each round
    }
    if (!accepted) break;
  }
  return { title: clean(rest), ...out };
}

/** Finds the last " to <column>" split, so card titles may themselves contain "to". */
function splitAtColumn(text: string, ctx: ParseContext): { card: string; column: string } | null {
  const re = /\s+(?:to|into|onto|in|over to)\s+/gi;
  const ms = [...text.matchAll(re)];
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    const column = clean(text.slice((m.index ?? 0) + m[0].length));
    if (ctx.isColumn(column)) return { card: clean(text.slice(0, m.index)), column };
  }
  if (ms.length === 0) return null;
  const last = ms[ms.length - 1];
  return { card: clean(text.slice(0, last.index)), column: clean(text.slice((last.index ?? 0) + last[0].length)) };
}

/**
 * Understands plain-language commands, typed or spoken. Works offline with no AI service,
 * so it is fast, private and predictable.
 */
export function parseCommand(raw: string, ctx: ParseContext): Command {
  const text = raw.trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const orig = text
    .replace(/^(?:(?:please|hey handrail|handrail|ok|okay|can you|could you)[, ]+)+/i, '')
    .replace(/[, ]+please$/i, '');
  const t = orig.toLowerCase();

  if (!t) return { type: 'unknown', text: raw };
  if (/^(undo|undo that|take that back|oops)$/.test(t)) return { type: 'undo' };
  if (/^(redo|redo that)$/.test(t)) return { type: 'redo' };
  if (/^(more|tell me more|go on|continue|the rest|and)$/.test(t)) return { type: 'more' };
  if (/^(what('?s| is)? next|what now|next step|my next step|what should i do( next| now)?|what do i do( next| now)?|where do i start)$/.test(t)) return { type: 'next' };
  if (/^(repeat|repeat that|again|say (that|it) again|what did you say|pardon|sorry)$/.test(t)) return { type: 'repeat' };
  if (/^(help|what can i (say|do)|commands|\?)$/.test(t)) return { type: 'help' };
  if (/^(summary|summarise|summarize|status|overview|where am i|read (the )?board|read everything|read all|what'?s on the board)$/.test(t))
    return { type: 'summary' };
  if (/^(what('?s| has| is)? (changed|new)|changes|show changes|what did (they|people|the team) change|catch me up|whats new)$/.test(t))
    return { type: 'changes' };
  if (/^(what'?s|what is|whats|show|list|read)? ?(mine|my (cards|tasks|stuff|work)|assigned to me|what do i have|what am i doing)$/.test(t))
    return { type: 'mine' };

  let p = orig.match(/^(?:what(?:'s| is)|whats|show(?: me)?|list)\s+(.+?)(?:'s)?\s+(?:doing|working on|cards|tasks|work)$/i)
    ?? orig.match(/^what (?:does|has) (.+?) (?:have|got|own)$/i)
    ?? orig.match(/^(?:cards|tasks) (?:for|of) (.+)$/i);
  if (p && !/^(i|me|my)$/i.test(p[1].trim()) && !/^(in|the|on|at)/i.test(p[1].trim()) && !ctx.isColumn(p[1]))
    return { type: 'person', person: clean(p[1]) };
  p = orig.match(/^(?:who(?:'s| is)? (?:has|owns|on|doing|working on)|who has|who owns|whose is) (.+)$/i);
  if (p) return { type: 'owner', card: clean(p[1]) };

  let m = t.match(/^(?:what'?s|what is|whats|show|list|read|anything)?\s*(overdue|late)(?: cards| tasks)?$/);
  if (m) return { type: 'whatsDue', range: 'overdue' };
  m = t.match(/^(?:what'?s|what is|whats|show|list|read|anything)?\s*(?:cards |tasks |stuff )?due\s*(today|tomorrow|this week|soon|next|)$/);
  if (m) {
    const w = m[1];
    return { type: 'whatsDue', range: w === 'today' ? 'today' : w === 'tomorrow' ? 'tomorrow' : w ? 'week' : 'all' };
  }

  m = orig.match(/^(?:add|create|make|new)\s+(?:a\s+)?(?:new\s+)?(?:column|list|lane)\s+(?:called\s+|named\s+)?(.+)$/i);
  if (m) return { type: 'addColumn', title: clean(m[1]) };

  // "make" only adds a card when it says so ("make a card called …"): "make the intro shorter" is an edit, not a new card.
  m = orig.match(/^(?:add|create|new|remind me to)\s+(?:a\s+)?(?:new\s+)?(?:card|task|item)?\s*(?:called\s+|named\s+|to\s+)?(.+)$/i)
    ?? orig.match(/^make\s+(?:a\s+)?(?:new\s+)?(?:card|task|item)\s+(?:called\s+|named\s+|to\s+)?(.+)$/i);
  if (m && !/^(note|notes)\b/i.test(m[1])) {
    const c = splitClauses(m[1], ctx);
    if (c.title) return { type: 'add', ...c };
  }

  m = orig.match(/^(?:add\s+(?:a\s+)?note|note)\s+(?:to|on)\s+(.+?)\s*:\s*(.+)$/i);
  if (m) return { type: 'note', card: clean(m[1]), text: m[2].trim() };

  m = orig.match(/^rename\s+(.+?)\s+(?:to|as)\s+(.+)$/i);
  if (m) return { type: 'rename', card: clean(m[1]), title: clean(m[2]) };

  m = orig.match(/^(?:move|put|send|drag|shift|bump)\s+(.+?)\s+(up|down)(?:\s+one)?$/i);
  if (m) return { type: 'nudge', card: clean(m[1]), direction: m[2].toLowerCase() as 'up' | 'down' };

  m = orig.match(/^(?:move|put|send|drag|shift|bump)\s+(.+?)\s+(?:to|at)\s+(?:the\s+)?(top|bottom|start|end)(?:\s+of\s+(.+))?$/i);
  if (m) {
    const pos = /top|start/i.test(m[2]) ? 'top' : 'bottom';
    return { type: 'move', card: clean(m[1]), column: m[3] ? clean(m[3]) : undefined, position: pos };
  }

  m = orig.match(/^(?:move|put|send|drag|shift)\s+(.+)$/i);
  if (m) {
    let body = m[1];
    let position: 'top' | 'bottom' | undefined;
    const pm = body.match(/\s+(?:at|to|on)\s+(?:the\s+)?(top|bottom|start|end)$/i);
    if (pm) {
      position = /top|start/i.test(pm[1]) ? 'top' : 'bottom';
      body = body.slice(0, pm.index);
    }
    const split = splitAtColumn(body, ctx);
    if (split) return { type: 'move', card: split.card, column: split.column, position };
  }

  // "finish the slides by friday" is a deadline, not "it's done".
  m = orig.match(/^(?:finish|complete|do|submit|send)\s+(.+?)\s+(?:by|before)\s+(.+)$/i);
  if (m) {
    const due = parseDue(m[2], ctx.today);
    if (due) return { type: 'due', card: clean(m[1]), due, dueText: m[2] };
  }

  m = orig.match(/^mark\s+(.+?)\s+(?:as\s+)?(done|finished|complete|completed)$/i)
    ?? orig.match(/^(?:done with|done|finished|finish|complete|completed|tick off|check off|close)\s+(.+)$/i)
    ?? orig.match(/^(.+?)\s+is\s+(?:done|finished|complete|completed)$/i)
    ?? orig.match(/^(?:i\s+)?(?:finished|completed|did)\s+(.+)$/i);
  if (m) return { type: 'done', card: clean(m[1]) };

  m = orig.match(/^mark\s+(.+?)\s+as\s+(.+)$/i);
  if (m) return { type: 'move', card: clean(m[1]), column: clean(m[2]) };

  m = orig.match(/^(?:start|begin|start on|work on|working on|i'?m working on|i am working on)\s+(.+)$/i);
  if (m) return { type: 'start', card: clean(m[1]) };

  // Checked before "remove X", so "remove the due date from X" never deletes the card.
  m = orig.match(/^(?:clear|remove|delete|drop) (?:the )?(?:due date|deadline) (?:of|on|for|from)\s+(.+)$/i);
  if (m) return { type: 'due', card: clean(m[1]), due: null, dueText: '' };

  m = orig.match(/^(?:delete|remove|trash|archive|get rid of)\s+(.+)$/i);
  if (m) return { type: 'delete', card: clean(m[1]) };

  m = orig.match(/^(?:unassign|clear (?:the )?assignee (?:of|on|for))\s+(.+)$/i);
  if (m) return { type: 'assign', card: clean(m[1]), person: null };

  m = orig.match(/^(?:assign|give)\s+(.+?)\s+to\s+(.+)$/i);
  if (m) return { type: 'assign', card: clean(m[1]), person: clean(m[2]) };


  m = orig.match(/^(?:set\s+)?(?:the\s+)?due date (?:of|on|for)\s+(.+?)\s+(?:to|as|is)\s+(.+)$/i)
    ?? orig.match(/^(?:set\s+)?(.+?)\s+(?:is\s+)?due\s+(.+)$/i);
  if (m) {
    const due = parseDue(m[2], ctx.today);
    if (due) return { type: 'due', card: clean(m[1]), due, dueText: m[2] };
  }

  m = orig.match(/^(?:read|what'?s in|what is in|whats in|list|show|open)\s+(?:the\s+)?(.+?)(?:\s+(?:column|list|lane))?$/i);
  if (m) {
    const target = clean(m[1]);
    if (ctx.isColumn(target)) return { type: 'read', target };
    return { type: 'readCard', card: target };
  }

  m = orig.match(/^(?:find|go to|goto|focus|jump to|where is|where'?s)\s+(.+)$/i);
  if (m) return { type: 'find', card: clean(m[1]) };

  return { type: 'unknown', text: raw };
}

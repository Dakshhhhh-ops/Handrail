import { describe, expect, it } from 'vitest';
import { addCard, deleteColumn, moveCard } from '../../src/model/board';
import { diffBoards } from '../../src/model/diff';
import { exportCsv, importCsv, importTrello, parseCsv, exportMarkdown } from '../../src/model/importers';
import { demoBoard, demoTeammateUpdate } from '../../src/model/seed';
import { boardFromHash, decodeBoard, docFromHash, encodeBoard, encodeDoc, shareUrl } from '../../src/model/share';
import { docFromBoard, materialize } from '../../src/model/crdt';
import { validateBoard } from '../../src/model/validate';

const today = new Date(2026, 9, 22);

describe('diffBoards (“Since you last looked”)', () => {
  it('describes teammate changes with what involves you first', () => {
    const before = demoBoard(today);
    const after = demoTeammateUpdate(before, today);
    const changes = diffBoards(before, after, 'Priya', today);
    expect(changes.map((c) => c.text)).toEqual([
      'Riya assigned “Email Dr. Mehta about the extension” to you.',
      'Riya added “Rehearse together on call” to To do, due Tuesday 27 October, in 5 days.',
      'Arjun moved “Write the presentation script” from To do to Doing.',
      'Riya moved “Design slides 4 to 8” from To do to Done.',
    ]);
    expect(changes[0].forYou).toBe(true);
  });

  it('leaves out your own edits', () => {
    const before = demoBoard(today);
    const after = moveCard(before, 'k-sources', 'c-doing', 0, 'Priya');
    expect(diffBoards(before, after, 'Priya', today)).toEqual([]);
  });

  it('notices removed cards and columns', () => {
    const before = demoBoard(today);
    const after = deleteColumn(before, 'c-doing');
    const texts = diffBoards(before, after, 'Priya', today).map((c) => c.text);
    expect(texts).toContain('Column “Doing” was removed.');
  });
});

describe('share links', () => {
  it('round-trips a board document through a URL', () => {
    const doc = docFromBoard(demoBoard(today), 'priya', 'Priya');
    const url = shareUrl(doc, 'https://example.org/handrail/#old');
    expect(url.startsWith('https://example.org/handrail/#board=v2.')).toBe(true);
    expect(docFromHash(new URL(url).hash)).toEqual(doc);
    expect(boardFromHash(new URL(url).hash)!.title).toBe('Climate talk: group project');
  });

  it('still opens old board-only links', () => {
    const b = demoBoard(today);
    const doc = docFromHash(`#board=${encodeBoard(b)}`)!;
    expect(materialize(doc).columns.map((c) => c.cardIds)).toEqual(b.columns.map((c) => c.cardIds));
  });

  it('rejects garbage safely', () => {
    expect(decodeBoard('v1.not-really')).toBeNull();
    expect(decodeBoard('hello')).toBeNull();
    expect(boardFromHash('#nothing')).toBeNull();
  });

  it('keeps the demo board link short enough to paste in chat', () => {
    expect(encodeDoc(docFromBoard(demoBoard(today), 'priya', 'Priya')).length).toBeLessThan(2500);
  });
});

describe('validateBoard', () => {
  it('drops broken cards, duplicates and oversize text', () => {
    const b = validateBoard({
      id: 'x', title: 'T',
      columns: [{ id: 'a', title: 'A', cardIds: ['1', '1', 'missing', '2'] }, { id: 'a', title: 'B', cardIds: ['2'] }],
      cards: { 1: { title: 'One', due: '2026-02-30' }, 2: { title: 'x'.repeat(500), assignee: 5 } },
    })!;
    expect(b.columns[0].cardIds).toEqual(['1', '2']);
    expect(b.columns[1].cardIds).toEqual([]);
    expect(b.columns[1].id).not.toBe('a');
    expect(b.cards['1'].due).toBeNull();
    expect(b.cards['2'].title).toHaveLength(200);
    expect(b.cards['2'].assignee).toBeNull();
  });

  it('rejects non-boards', () => {
    expect(validateBoard(null)).toBeNull();
    expect(validateBoard({ columns: [] })).toBeNull();
    expect(validateBoard('board')).toBeNull();
  });
});

describe('importers', () => {
  it('imports a Trello export, skipping archived items', () => {
    const b = importTrello({
      name: 'Bio lab',
      lists: [{ id: 'L2', name: 'Doing', pos: 2 }, { id: 'L1', name: 'To Do', pos: 1 }, { id: 'L3', name: 'Old', pos: 3, closed: true }],
      cards: [
        { id: 'c1', name: 'Write method', idList: 'L1', pos: 1, due: '2026-10-30T12:00:00.000Z', idMembers: ['m1'], desc: 'Use template' },
        { id: 'c2', name: 'Graphs', idList: 'L2', pos: 1 },
        { id: 'c3', name: 'Gone', idList: 'L1', pos: 2, closed: true },
      ],
      members: [{ id: 'm1', fullName: 'Riya Sharma' }],
    })!;
    expect(b.title).toBe('Bio lab');
    expect(b.columns.map((c) => c.title)).toEqual(['To Do', 'Doing']);
    const first = b.cards[b.columns[0].cardIds[0]];
    expect(first).toMatchObject({ title: 'Write method', due: '2026-10-30', assignee: 'Riya Sharma', notes: 'Use template' });
    expect(Object.keys(b.cards)).toHaveLength(2);
  });

  it('round-trips CSV, including commas, quotes, new lines and formula-looking text', () => {
    let b = demoBoard(today);
    b = addCard(b, 'c-todo', { title: '=SUM(A1) "quoted", ok', notes: 'line 1\nline 2' }, null).board;
    const back = importCsv(exportCsv(b))!;
    expect(back.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done']);
    const titles = Object.values(back.cards).map((c) => c.title);
    expect(titles).toContain('=SUM(A1) "quoted", ok');
    expect(Object.values(back.cards).find((c) => c.notes === 'line 1\nline 2')).toBeTruthy();
    expect(exportCsv(b)).toContain(`"'=SUM(A1) ""quoted"", ok"`);
  });

  it('parses CSV edge cases', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });

  it('exports readable Markdown', () => {
    const md = exportMarkdown(demoBoard(today), today);
    expect(md).toContain('## Doing (1)');
    expect(md).toContain('- Draft the outline (overdue by 1 day, was due Wednesday 21 October, assigned to Priya)');
  });
});

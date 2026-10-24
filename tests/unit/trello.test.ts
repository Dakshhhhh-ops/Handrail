import { describe, expect, it } from 'vitest';
import { addCard, locate, moveCard } from '../../src/model/board';
import { commit } from '../../src/model/crdt';
import { importTrello, trelloAuthors, TRELLO_SOMEONE } from '../../src/model/importers';
import { DEFAULT_SETTINGS, importFromTrello, view, type Saved } from '../../src/store/useHandrail';

const lists = [
  { id: 'L1', name: 'To Do', pos: 1 },
  { id: 'L2', name: 'Doing', pos: 2 },
  { id: 'L3', name: 'Done', pos: 3 },
];
const members = [{ id: 'm1', fullName: 'Riya Sharma' }, { id: 'm2', fullName: 'Arjun Rao' }];
const riya = { fullName: 'Riya Sharma' };
const arjun = { fullName: 'Arjun Rao' };

const firstExport = {
  id: 'B1', name: 'Bio lab', lists, members,
  cards: [
    { id: 'c1', name: 'Write method', idList: 'L1', pos: 1 },
    { id: 'c2', name: 'Graphs', idList: 'L1', pos: 2 },
    { id: 'c3', name: 'Poster', idList: 'L2', pos: 1 },
  ],
  actions: [{ type: 'createCard', date: '2026-10-20T09:00:00.000Z', memberCreator: riya, data: { card: { id: 'c1' } } }],
};

// A week later in Trello: Riya started the method and added an abstract; Arjun renamed the graphs and archived the poster.
const laterExport = {
  id: 'B1', name: 'Bio lab', lists, members,
  cards: [
    { id: 'c1', name: 'Write method', idList: 'L2', pos: 2 },
    { id: 'c2', name: 'Graphs for the results', idList: 'L1', pos: 2 },
    { id: 'c3', name: 'Poster', idList: 'L2', pos: 1, closed: true },
    { id: 'c4', name: 'Abstract', idList: 'L1', pos: 3 },
  ],
  // Newest first, as Trello lists them.
  actions: [
    { type: 'commentCard', date: '2026-10-27T11:00:00.000Z', memberCreator: arjun, data: { card: { id: 'c1' }, text: 'Looks good' } },
    { type: 'createCard', date: '2026-10-27T10:00:00.000Z', memberCreator: riya, data: { card: { id: 'c4' } } },
    { type: 'updateCard', date: '2026-10-26T15:00:00.000Z', memberCreator: arjun, data: { card: { id: 'c3' }, old: { closed: false } } },
    { type: 'updateCard', date: '2026-10-26T14:00:00.000Z', memberCreator: arjun, data: { card: { id: 'c2' }, old: { name: 'Graphs' } } },
    { type: 'updateCard', date: '2026-10-25T09:00:00.000Z', memberCreator: riya, data: { card: { id: 'c1' }, old: { idList: 'L1' } } },
    { type: 'updateCard', date: '2026-10-20T09:00:00.000Z', memberCreator: arjun, data: { card: { id: 'c1' }, old: { desc: '' } } },
  ],
};

function emptySaved(): Saved {
  return { actor: 'd-priya', docs: {}, currentId: '', seen: {}, inbox: {}, acknowledged: {}, settings: { ...DEFAULT_SETTINGS, name: 'Priya' } };
}

function load(saved: Saved, raw: unknown) {
  return importFromTrello(saved, importTrello(raw)!, trelloAuthors(raw), TRELLO_SOMEONE);
}

describe('Trello re-import', () => {
  it('keeps Trello’s ids, so a newer export updates the same board', () => {
    const a = importTrello(firstExport)!;
    const b = importTrello(laterExport)!;
    expect(a.id).toBe('t-B1');
    expect(b.id).toBe(a.id);
    expect(a.columns.map((c) => c.id)).toEqual(['tl-L1', 'tl-L2', 'tl-L3']);
    expect(Object.keys(b.cards)).toContain('tc-c1');
  });

  it('credits each kind of change to whoever made it in Trello, ignoring comments', () => {
    expect(trelloAuthors(laterExport)).toEqual({
      'tc-c1': { place: 'Riya Sharma', notes: 'Arjun Rao' },
      'tc-c2': { title: 'Arjun Rao' },
      'tc-c3': { alive: 'Arjun Rao' },
      'tc-c4': { any: 'Riya Sharma' },
    });
    expect(trelloAuthors({ lists: [], cards: [] })).toEqual({});
  });

  it('a later comment doesn’t take credit for someone else’s move', () => {
    const first = load(emptySaved(), firstExport);
    const later = {
      ...firstExport,
      cards: [{ id: 'c1', name: 'Write method', idList: 'L2', pos: 1 }, ...firstExport.cards.slice(1)],
      actions: [
        { type: 'commentCard', date: '2026-10-26T10:00:00.000Z', memberCreator: riya, data: { card: { id: 'c1' }, text: 'Nice' } },
        { type: 'updateCard', date: '2026-10-25T10:00:00.000Z', memberCreator: arjun, data: { card: { id: 'c1' }, old: { idList: 'L1' } } },
      ],
    };
    expect(load(first.saved, later).fresh.map((c) => c.text)).toEqual(['Arjun Rao moved “Write method” from To Do to Doing.']);
  });

  it('matches Priya to her full Trello name, so changes for her are marked “for you”', () => {
    const withPriya = { ...firstExport, members: [...members, { id: 'm3', fullName: 'Priya Sharma' }] };
    const first = load(emptySaved(), withPriya);
    const later = {
      ...withPriya,
      cards: [{ ...withPriya.cards[0], idMembers: ['m3'] }, ...withPriya.cards.slice(1)],
      actions: [{ type: 'addMemberToCard', date: '2026-10-26T10:00:00.000Z', memberCreator: riya, data: { card: { id: 'c1' } } }],
    };
    const fresh = load(first.saved, later).fresh;
    expect(fresh[0]).toMatchObject({ forYou: true, text: 'Riya Sharma assigned “Write method” to you.' });
  });

  it('credits changes the activity log doesn’t cover to “Someone in Trello”', () => {
    const first = load(emptySaved(), firstExport);
    const second = load(first.saved, { ...laterExport, actions: [] });
    expect(second.fresh.map((c) => c.text)).toContain('Someone in Trello added “Abstract” to To Do.');
  });

  it('lists what changed in Trello since the last import, and who did it', () => {
    const first = load(emptySaved(), firstExport);
    expect(first.updated).toBe(false);
    expect(first.fresh).toEqual([]);

    const second = load(first.saved, laterExport);
    expect(second.updated).toBe(true);
    const texts = second.fresh.map((c) => c.text);
    expect(texts).toContain('Riya Sharma moved “Write method” from To Do to Doing.');
    expect(texts).toContain('Riya Sharma added “Abstract” to To Do.');
    expect(texts.some((t) => t.startsWith('Arjun Rao') && t.includes('Graphs for the results'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Arjun Rao') && t.includes('Poster'))).toBe(true);
    expect(second.saved.inbox['t-B1']).toHaveLength(texts.length);
  });

  it('keeps cards added in Handrail between imports', () => {
    const first = load(emptySaved(), firstExport);
    const s = first.saved;
    const mine = addCard(view(s.docs['t-B1']), 'tl-L1', { title: 'Book a lab slot' }, 'Priya').board;
    const doc = commit(s.docs['t-B1'], mine, s.actor, 'Priya');
    const edited: Saved = { ...s, docs: { ...s.docs, 't-B1': doc }, seen: { ...s.seen, 't-B1': view(doc) } };

    const after = view(load(edited, laterExport).saved.docs['t-B1']);
    const titles = Object.values(after.cards).map((c) => c.title);
    expect(titles).toContain('Book a lab slot');
    expect(titles).toContain('Abstract');
    expect(titles).not.toContain('Poster');
  });

  it('a card Priya moved stays put when Trello adds a card above it, with no false conflict', () => {
    const first = load(emptySaved(), firstExport);
    const s = first.saved;
    const board = view(s.docs['t-B1']);
    const moved = moveCard(board, 'tc-c2', 'tl-L3', 0, 'Priya');
    const doc = commit(s.docs['t-B1'], moved, s.actor, 'Priya');
    const edited: Saved = { ...s, docs: { ...s.docs, 't-B1': doc }, seen: { ...s.seen, 't-B1': view(doc) } };
    // In Trello, someone adds a card at the top of To Do; c2 is unchanged there.
    const later = { ...firstExport, cards: [{ id: 'c0', name: 'Read the brief', idList: 'L1', pos: 0 }, ...firstExport.cards] };
    const r = load(edited, later);
    const after = view(r.saved.docs['t-B1']);
    expect(locate(after, 'tc-c2')?.column.title).toBe('Done');
    expect(r.fresh.map((c) => c.text)).toEqual(['Someone in Trello added “Read the brief” to To Do.']);
  });

  it('reads Trello due times as dates in the local time zone', () => {
    const due = '2026-10-30T23:30:00.000Z';
    const b = importTrello({ ...firstExport, cards: [{ id: 'c1', name: 'Write method', idList: 'L1', pos: 1, due }] })!;
    const t = new Date(due);
    const local = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    expect(b.cards['tc-c1'].due).toBe(local);
  });

  it('Trello wins when the same card was changed in both places', () => {
    const first = load(emptySaved(), firstExport);
    const s = first.saved;
    const board = view(s.docs['t-B1']);
    const renamed = { ...board, cards: { ...board.cards, 'tc-c2': { ...board.cards['tc-c2'], title: 'Charts', updatedAt: board.cards['tc-c2'].updatedAt + 1 } } };
    // Many local edits push this device's clock well past Trello's.
    let doc = s.docs['t-B1'];
    for (let i = 0; i < 5; i++) doc = commit(doc, { ...renamed, cards: { ...renamed.cards, 'tc-c2': { ...renamed.cards['tc-c2'], notes: `try ${i}` } } }, s.actor, 'Priya');
    const edited: Saved = { ...s, docs: { ...s.docs, 't-B1': doc }, seen: { ...s.seen, 't-B1': view(doc) } };
    const after = view(load(edited, laterExport).saved.docs['t-B1']);
    expect(after.cards['tc-c2'].title).toBe('Graphs for the results');
    // Notes were not changed in Trello, so Priya's stay.
    expect(after.cards['tc-c2'].notes).toBe('try 4');
  });

  it('says nothing changed when the same export is imported twice', () => {
    const first = load(emptySaved(), laterExport);
    const again = load(first.saved, laterExport);
    expect(again.updated).toBe(true);
    expect(again.fresh).toEqual([]);
  });
});

describe('Trello connection', () => {
  it('asks Trello for read-only access and reads the token it sends back', async () => {
    const { authorizeUrl, tokenFromHash } = await import('../../src/lib/trello');
    const url = new URL(authorizeUrl('abcdef123456', 'https://example.org/Handrail/?board'));
    expect(url.origin + url.pathname).toBe('https://trello.com/1/authorize');
    expect(url.searchParams.get('scope')).toBe('read');
    expect(url.searchParams.get('return_url')).toBe('https://example.org/Handrail/?board');
    expect(tokenFromHash(`#token=${'a1'.repeat(32)}`)).toBe('a1'.repeat(32));
    expect(tokenFromHash('#board=v2.abc')).toBeNull();
    expect(tokenFromHash('#token=<script>')).toBeNull();
  });
});

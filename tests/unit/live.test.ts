import { describe, expect, it } from 'vitest';
import { moveCard, updateCard } from '../../src/model/board';
import { commit, docFromBoard, materialize, mergeDocs, type Doc } from '../../src/model/crdt';
import { demoBoard } from '../../src/model/seed';
import { covers, createSession, type LivePeer, type Transport } from '../../src/lib/live';

const today = new Date(2026, 9, 22);

/** An in-memory network: every message is delivered, in order, to the named peers. */
function network() {
  const nodes = new Map<string, { msg: ((c: 'hello' | 'doc', d: string, from: string) => void)[]; join: ((p: string) => void)[]; leave: ((p: string) => void)[] }>();
  let sent = 0;
  const transport = (id: string): Transport => {
    const node = { msg: [] as never[], join: [] as never[], leave: [] as never[] };
    nodes.set(id, node);
    return {
      send(channel, data, to) {
        for (const [peer, n] of nodes) {
          if (peer === id || (to && to !== peer)) continue;
          sent++;
          n.msg.forEach((h) => h(channel, data, id));
        }
      },
      onMessage: (fn) => node.msg.push(fn as never),
      onJoin: (fn) => node.join.push(fn as never),
      onLeave: (fn) => node.leave.push(fn as never),
      leave() {
        nodes.delete(id);
        for (const n of nodes.values()) n.leave.forEach((h) => h(id));
      },
    };
  };
  /** Tells everyone already there that `id` arrived, and tells `id` about them. */
  const connect = (id: string) => {
    for (const [peer, n] of nodes) {
      if (peer === id) continue;
      n.join.forEach((h) => h(id));
      nodes.get(id)!.join.forEach((h) => h(peer));
    }
  };
  return { transport, connect, sent: () => sent };
}

function replica(net: ReturnType<typeof network>, id: string, name: string, start: Doc) {
  let doc = start;
  const heard: { from: LivePeer; doc: Doc }[] = [];
  let peers: LivePeer[] = [];
  const session = createSession(net.transport(id), name, {
    getDoc: () => doc,
    onDoc: (d, from) => {
      heard.push({ from, doc: d });
      doc = mergeDocs(doc, d);
    },
    onPeers: (p) => (peers = p),
  });
  return {
    get doc() { return doc; },
    get peers() { return peers; },
    heard,
    edit(fn: (b: ReturnType<typeof materialize>) => ReturnType<typeof materialize>) {
      doc = commit(doc, fn(materialize(doc)), id, name);
      session.publish(doc);
    },
    session,
  };
}

describe('live sessions', () => {
  it('peers exchange names and boards when they join, then stream every edit', () => {
    const net = network();
    const base = docFromBoard(demoBoard(today), 'seed', null);
    const priya = replica(net, 'priya', 'Priya', base);
    const riya = replica(net, 'riya', 'Riya', base);
    net.connect('riya');
    expect(priya.peers).toEqual([{ id: 'riya', name: 'Riya' }]);
    expect(riya.peers).toEqual([{ id: 'priya', name: 'Priya' }]);

    riya.edit((b) => moveCard(b, 'k-slides', 'c-done', 0, 'Riya'));
    expect(materialize(priya.doc).columns[2].cardIds[0]).toBe('k-slides');
    expect(priya.heard.at(-1)!.from.name).toBe('Riya');

    priya.edit((b) => updateCard(b, 'k-email', { assignee: 'Priya' }, 'Priya'));
    expect(materialize(riya.doc).cards['k-email'].assignee).toBe('Priya');
    expect(materialize(riya.doc)).toEqual(materialize(priya.doc));
  });

  it('a late joiner catches up with everything at once', () => {
    const net = network();
    const base = docFromBoard(demoBoard(today), 'seed', null);
    const priya = replica(net, 'priya', 'Priya', base);
    priya.edit((b) => moveCard(b, 'k-sources', 'c-doing', 0, 'Priya'));
    const arjun = replica(net, 'arjun', 'Arjun', base);
    net.connect('arjun');
    expect(materialize(arjun.doc)).toEqual(materialize(priya.doc));
  });

  it('never echoes a board that brings nothing new', () => {
    const net = network();
    const base = docFromBoard(demoBoard(today), 'seed', null);
    const priya = replica(net, 'priya', 'Priya', base);
    const riya = replica(net, 'riya', 'Riya', base);
    net.connect('riya');
    const before = net.sent();
    riya.edit((b) => moveCard(b, 'k-slides', 'c-done', 0, 'Riya'));
    // One message out; Priya merges it and publishing her merged copy sends nothing.
    priya.session.publish(priya.doc);
    expect(net.sent() - before).toBe(1);
    expect(priya.heard).toHaveLength(1);
  });

  it('notices when peers leave', () => {
    const net = network();
    const base = docFromBoard(demoBoard(today), 'seed', null);
    const priya = replica(net, 'priya', 'Priya', base);
    const riya = replica(net, 'riya', 'Riya', base);
    net.connect('riya');
    riya.session.leave();
    expect(priya.peers).toEqual([]);
  });

  it('ignores garbage and other boards', () => {
    const net = network();
    const base = docFromBoard(demoBoard(today), 'seed', null);
    const priya = replica(net, 'priya', 'Priya', base);
    const evil = net.transport('evil');
    net.connect('evil');
    evil.send('doc', 'not a document');
    evil.send('hello', '{"name": 42}');
    const other = docFromBoard({ ...demoBoard(today), id: 'other-board' }, 'evil', 'Eve');
    evil.send('doc', JSON.stringify(other));
    expect(priya.heard).toHaveLength(0);
    expect(priya.peers).toEqual([{ id: 'evil', name: null }]);
  });

  it('compares version vectors', () => {
    expect(covers({ a: 3, b: 1 }, { a: 2 })).toBe(true);
    expect(covers({ a: 3 }, { a: 3, b: 1 })).toBe(false);
  });
});

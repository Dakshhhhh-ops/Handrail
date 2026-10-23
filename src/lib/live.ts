/**
 * Live sessions: teammates on the same board see each other's changes as they
 * happen, with no Handrail server. Browsers find each other through public
 * Nostr relays (signalling only, encrypted with the room password) and then
 * talk directly over WebRTC data channels.
 *
 * Because boards are CRDT documents, the protocol is tiny: say hello with your
 * name, send your whole document when someone joins, and send it again after
 * each of your own edits. Every receiver merges; order and duplicates don't
 * matter. A document that brings nothing new is ignored, so peers never echo.
 */
import { validateDoc, type Doc, type VersionVector } from '../model/crdt';
import LZString from 'lz-string';

export interface Transport {
  /** Sends to everyone, or to one peer. */
  send(channel: 'hello' | 'doc', data: string, to?: string): void;
  onMessage(fn: (channel: 'hello' | 'doc', data: string, from: string) => void): void;
  onJoin(fn: (peer: string) => void): void;
  onLeave(fn: (peer: string) => void): void;
  leave(): void;
}

export interface LivePeer {
  id: string;
  name: string | null;
}

export interface LiveCallbacks {
  /** Latest local document (read when a peer joins). */
  getDoc: () => Doc;
  /** A peer sent a document that contains something new. */
  onDoc: (doc: Doc, from: LivePeer) => void;
  onPeers: (peers: LivePeer[]) => void;
}

/** True when `a` has seen every write `b` has (so merging b changes nothing). */
export function covers(a: VersionVector, b: VersionVector): boolean {
  return Object.entries(b).every(([actor, c]) => (a[actor] ?? 0) >= c);
}

export const packDoc = (doc: Doc) => LZString.compressToUTF16(JSON.stringify(doc));
export function unpackDoc(data: string): Doc | null {
  try {
    const json = LZString.decompressFromUTF16(data);
    return json ? validateDoc(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

export interface LiveSession {
  /** Call after every local edit. */
  publish(doc: Doc): void;
  setName(name: string | null): void;
  peers(): LivePeer[];
  leave(): void;
}

export function createSession(transport: Transport, name: string | null, cb: LiveCallbacks): LiveSession {
  const peers = new Map<string, LivePeer>();
  let myName = name;
  let known: VersionVector = { ...cb.getDoc().vv };
  const emit = () => cb.onPeers([...peers.values()]);

  transport.onJoin((id) => {
    peers.set(id, peers.get(id) ?? { id, name: null });
    emit();
    transport.send('hello', JSON.stringify({ name: myName }), id);
    transport.send('doc', packDoc(cb.getDoc()), id);
  });
  transport.onLeave((id) => {
    peers.delete(id);
    emit();
  });
  transport.onMessage((channel, data, from) => {
    const peer = peers.get(from) ?? { id: from, name: null };
    peers.set(from, peer);
    if (channel === 'hello') {
      try {
        const n = (JSON.parse(data) as { name?: unknown }).name;
        peer.name = typeof n === 'string' ? n.slice(0, 60) : null;
      } catch {
        /* ignore */
      }
      emit();
      return;
    }
    if (data.length > 2_000_000) return;
    const doc = unpackDoc(data);
    if (!doc || doc.id !== cb.getDoc().id) return;
    if (covers(known, doc.vv)) return; // nothing new: never echo
    known = mergeVV(known, doc.vv);
    cb.onDoc(doc, peer);
  });

  return {
    publish(doc) {
      if (covers(known, doc.vv)) return;
      known = mergeVV(known, doc.vv);
      if (peers.size) transport.send('doc', packDoc(doc));
    },
    setName(n) {
      myName = n;
      transport.send('hello', JSON.stringify({ name: n }));
    },
    peers: () => [...peers.values()],
    leave: () => transport.leave(),
  };
}

function mergeVV(a: VersionVector, b: VersionVector): VersionVector {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

/** Real network transport: Trystero over Nostr relays, loaded only when a session starts. */
export async function trysteroTransport(boardId: string, room: string): Promise<Transport> {
  const { joinRoom } = await import('trystero/nostr');
  const r = joinRoom({ appId: 'handrail-live-v1', password: room }, `${boardId}:${room}`);
  const [sendHello, getHello] = r.makeAction<string>('hello');
  const [sendDoc, getDoc] = r.makeAction<string>('doc');
  const handlers: ((c: 'hello' | 'doc', d: string, from: string) => void)[] = [];
  getHello((d, from) => handlers.forEach((h) => h('hello', d, from)));
  getDoc((d, from) => handlers.forEach((h) => h('doc', d, from)));
  return {
    send: (channel, data, to) => void (channel === 'hello' ? sendHello : sendDoc)(data, to ?? null),
    onMessage: (fn) => handlers.push(fn),
    onJoin: (fn) => r.onPeerJoin(fn),
    onLeave: (fn) => r.onPeerLeave(fn),
    leave: () => void r.leave(),
  };
}

/** A random, unguessable room code (also the encryption password for signalling). */
export function newRoomCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

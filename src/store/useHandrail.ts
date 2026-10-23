import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { commit, docFromBoard, findConflicts, materialize, mergeDocs, plausible, validateDoc, type Doc } from '../model/crdt';
import { describeConflicts, diffBoards, type Change } from '../model/diff';
import { newId } from '../model/board';
import { demoBoard, demoTeammateEdits } from '../model/seed';
import { validateBoard } from '../model/validate';
import { revertEdit } from '../model/revert';
import { docFromHash } from '../model/share';
import { covers } from '../lib/live';
import type { Board } from '../model/types';

export interface Settings {
  name: string;
  theme: 'system' | 'light' | 'dark' | 'contrast';
  textSize: number;
  font: 'system' | 'atkinson' | 'opendyslexic';
  spacing: 'normal' | 'relaxed';
  layout: 'columns' | 'stacked';
  speak: boolean;
  speechRate: number;
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  theme: 'dark',
  textSize: 100,
  font: 'atkinson',
  spacing: 'normal',
  layout: 'columns',
  speak: false,
  speechRate: 1,
  reduceMotion: false,
};

interface Saved {
  /** This device's id in the shared documents. */
  actor: string;
  /** The source of truth: one conflict-free document per board. */
  docs: Record<string, Doc>;
  currentId: string;
  /** The board as the user last saw it (their own edits count as seen). */
  seen: Record<string, Board>;
  /** Teammates' changes not yet acknowledged, worked out when a shared link was opened. */
  inbox: Record<string, Change[]>;
  /** Boards whose inbox the user acknowledged with "Got it" (shown collapsed until new changes arrive). */
  acknowledged: Record<string, boolean>;
  settings: Settings;
}

/** One undoable action: the board just before and just after it. */
export interface Entry {
  before: Board;
  after: Board;
  label: string;
}

interface State {
  saved: Saved;
  past: Entry[];
  future: Entry[];
  /** The last batch of changes that arrived from a live session, for announcing. */
  live: { seq: number; changes: Change[]; from: string | null };
}

type Action =
  | { type: 'apply'; board: Board; label: string }
  | { type: 'replace'; board: Board }
  | { type: 'commitFrom'; origin: Board; label: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'markSeen' }
  | { type: 'loadShared'; doc: Doc }
  | { type: 'mergeLive'; doc: Doc; from: string | null }
  | { type: 'create'; board: Board }
  | { type: 'simulate' }
  | { type: 'switch'; id: string }
  | { type: 'deleteBoard'; id: string }
  | { type: 'settings'; patch: Partial<Settings> };

const KEY = 'handrail:v1';
const HISTORY = 60;

// Views are derived from documents; cache them so React sees stable objects.
const views = new WeakMap<Doc, Board>();
export function view(doc: Doc): Board {
  let b = views.get(doc);
  if (!b) {
    b = materialize(doc);
    views.set(doc, b);
  }
  return b;
}

const nameOf = (s: Saved) => s.settings.name.trim() || null;

function freshSaved(): Saved {
  const actor = newId('d');
  // Opened from a teammate's link on a new device: start with just their board, and no
  // name yet (the app asks), instead of a sample board that would then be merged in.
  let shared: Doc | null = null;
  try {
    shared = typeof window !== 'undefined' ? docFromHash(window.location.hash) : null;
  } catch {
    shared = null;
  }
  if (shared) {
    return {
      actor, docs: { [shared.id]: shared }, currentId: shared.id, seen: { [shared.id]: view(shared) },
      inbox: {}, acknowledged: {}, settings: { ...DEFAULT_SETTINGS },
    };
  }
  const doc = docFromBoard(demoBoard(new Date()), actor, 'Priya');
  return {
    actor,
    docs: { [doc.id]: doc },
    currentId: doc.id,
    seen: { [doc.id]: view(doc) },
    inbox: {},
    acknowledged: {},
    settings: { ...DEFAULT_SETTINGS, name: 'Priya' },
  };
}

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSaved();
    const parsed = JSON.parse(raw) as Partial<Saved> & { boards?: Record<string, unknown> };
    const settings = cleanSettings(parsed.settings);
    const actor = typeof parsed.actor === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(parsed.actor) ? parsed.actor : newId('d');

    const docs: Record<string, Doc> = {};
    for (const d of Object.values(parsed.docs ?? {})) {
      const v = validateDoc(d);
      if (v) docs[v.id] = v;
    }
    // Data saved before boards became documents.
    for (const b of Object.values(parsed.boards ?? {})) {
      const v = validateBoard(b);
      if (v && !docs[v.id]) docs[v.id] = docFromBoard(v, actor, settings.name.trim() || null);
    }
    const ids = Object.keys(docs);
    if (ids.length === 0) return freshSaved();

    const seen: Record<string, Board> = {};
    for (const [id, b] of Object.entries(parsed.seen ?? {})) {
      const v = validateBoard(b);
      if (v && docs[id]) seen[id] = v;
    }
    const inbox: Record<string, Change[]> = {};
    for (const [id, list] of Object.entries(parsed.inbox ?? {})) {
      if (!docs[id] || !Array.isArray(list)) continue;
      inbox[id] = list
        .filter((c) => c && typeof c.text === 'string')
        .slice(0, 200)
        .map((c) => ({
          kind: c.kind, text: c.text.slice(0, 500), forYou: !!c.forYou,
          cardId: typeof c.cardId === 'string' ? c.cardId : undefined,
          by: typeof c.by === 'string' ? c.by.slice(0, 60) : null,
        }));
    }
    return {
      actor,
      docs,
      currentId: parsed.currentId && docs[parsed.currentId] ? parsed.currentId : ids[0],
      seen,
      inbox,
      acknowledged: Object.fromEntries(Object.entries(parsed.acknowledged ?? {}).filter(([id, v]) => inbox[id] && v === true)),
      settings,
    };
  } catch {
    // Keep whatever was there before starting over, so nothing is silently lost.
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(`${KEY}:backup:${Date.now()}`, raw);
    } catch {
      /* ignore */
    }
    return freshSaved();
  }
}

/** Settings from storage, field by field, so one bad value can't reset everything. */
function cleanSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const one = <T,>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  return {
    name: typeof s.name === 'string' ? s.name.slice(0, 60) : DEFAULT_SETTINGS.name,
    theme: one(s.theme, ['system', 'light', 'dark', 'contrast'] as const, DEFAULT_SETTINGS.theme),
    textSize: one(s.textSize, [100, 125, 150, 175, 200] as const, DEFAULT_SETTINGS.textSize),
    font: one(s.font, ['system', 'atkinson', 'opendyslexic'] as const, DEFAULT_SETTINGS.font),
    spacing: one(s.spacing, ['normal', 'relaxed'] as const, DEFAULT_SETTINGS.spacing),
    layout: one(s.layout, ['columns', 'stacked'] as const, DEFAULT_SETTINGS.layout),
    speak: typeof s.speak === 'boolean' ? s.speak : DEFAULT_SETTINGS.speak,
    speechRate: one(s.speechRate, [0.75, 1, 1.25, 1.5, 2] as const, DEFAULT_SETTINGS.speechRate),
    reduceMotion: typeof s.reduceMotion === 'boolean' ? s.reduceMotion : DEFAULT_SETTINGS.reduceMotion,
  };
}

const without = <T,>(rec: Record<string, T>, id: string) => {
  const copy = { ...rec };
  delete copy[id];
  return copy;
};

/** Records an edited view of the current board as writes by this device. */
function write(saved: Saved, board: Board, markSeen: boolean): Saved {
  const doc = saved.docs[board.id];
  const next = doc ? commit(doc, board, saved.actor, nameOf(saved)) : docFromBoard(board, saved.actor, nameOf(saved));
  if (next === doc && !markSeen) return saved;
  return {
    ...saved,
    docs: { ...saved.docs, [board.id]: next },
    // You have always seen your own edits.
    seen: markSeen ? { ...saved.seen, [board.id]: view(next) } : saved.seen,
  };
}

/** Merges a teammate's copy into ours and works out what they changed since we last looked. */
function receive(saved: Saved, remote: Doc, open = true): { saved: Saved; fresh: Change[] } {
  const local = saved.docs[remote.id];
  const merged = local ? mergeDocs(local, remote) : remote;
  const me = nameOf(saved);
  const now = view(merged);
  // A board you have never seen before has nothing to compare against.
  const base = saved.seen[remote.id] ?? (local ? view(local) : null);
  const fresh = [
    ...(local ? describeConflicts(findConflicts(local, remote, saved.actor), now) : []),
    ...(base ? diffBoards(base, now, me, new Date()) : []),
  ];
  // New changes replace an acknowledged list; otherwise they add to what is still unread.
  const wasAcknowledged = !!saved.acknowledged[remote.id];
  const unread = fresh.length && wasAcknowledged ? fresh : [...(saved.inbox[remote.id] ?? []), ...fresh];
  return {
    fresh,
    saved: {
      ...saved,
      docs: { ...saved.docs, [remote.id]: merged },
      currentId: open ? remote.id : saved.currentId,
      seen: { ...saved.seen, [remote.id]: now },
      inbox: unread.length ? { ...saved.inbox, [remote.id]: unread } : without(saved.inbox, remote.id),
      acknowledged: fresh.length ? without(saved.acknowledged, remote.id) : saved.acknowledged,
    },
  };
}

function created(saved: Saved, board: Board): Saved {
  const doc = docFromBoard(board, saved.actor, nameOf(saved));
  return {
    ...saved,
    docs: { ...saved.docs, [doc.id]: doc },
    currentId: doc.id,
    seen: { ...saved.seen, [doc.id]: view(doc) },
    inbox: without(saved.inbox, doc.id),
    acknowledged: without(saved.acknowledged, doc.id),
  };
}

function reducer(state: State, action: Action): State {
  const { saved } = state;
  const current = view(saved.docs[saved.currentId]);
  switch (action.type) {
    case 'apply':
      return {
        ...state,
        saved: write(saved, action.board, true),
        past: [...state.past, { before: current, after: action.board, label: action.label }].slice(-HISTORY),
        future: [],
      };
    case 'replace':
      return { ...state, saved: write(saved, action.board, false) };
    case 'commitFrom':
      return {
        ...state,
        saved: write(saved, current, true),
        past: [...state.past, { before: action.origin, after: current, label: action.label }].slice(-HISTORY),
        future: [],
      };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      // Put back only what that action changed, leaving teammates' later edits alone.
      // It is a new edit, so it syncs like any other change.
      const { board } = revertEdit(current, prev.before, prev.after, nameOf(saved));
      return {
        ...state,
        saved: write(saved, board, true),
        past: state.past.slice(0, -1),
        future: [prev, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      const { board } = revertEdit(current, next.after, next.before, nameOf(saved));
      return {
        ...state,
        saved: write(saved, board, true),
        past: [...state.past, next],
        future: state.future.slice(1),
      };
    }
    case 'markSeen':
      return {
        ...state,
        saved: { ...saved, seen: { ...saved.seen, [saved.currentId]: current }, acknowledged: { ...saved.acknowledged, [saved.currentId]: true } },
      };
    case 'loadShared': {
      if (!plausible(saved.docs[action.doc.id], action.doc)) return state;
      // A merge is not undoable, but earlier actions still are: they only touch what they changed.
      const sameBoardOpen = action.doc.id === saved.currentId;
      return {
        ...state,
        saved: receive(saved, action.doc).saved,
        past: sameBoardOpen ? state.past : [],
        future: sameBoardOpen ? state.future : [],
      };
    }
    case 'mergeLive': {
      const local = saved.docs[action.doc.id];
      if (!local || covers(local.vv, action.doc.vv) || !plausible(local, action.doc)) return state;
      const { saved: next, fresh } = receive(saved, action.doc, false);
      return { ...state, saved: next, live: { seq: state.live.seq + 1, changes: fresh, from: action.from } };
    }
    case 'create':
      return { ...state, saved: created(saved, action.board), past: [], future: [] };
    case 'simulate': {
      // Start the sample board fresh, then let "Riya" and "Arjun" edit it on their own devices.
      const start = created(saved, demoBoard(new Date()));
      let theirs = start.docs[start.currentId];
      for (const step of demoTeammateEdits(new Date())) {
        theirs = commit(theirs, step.apply(view(theirs)), step.actor, step.by);
      }
      return { ...state, saved: receive(start, theirs).saved, past: [], future: [] };
    }
    case 'switch':
      if (!saved.docs[action.id] || action.id === saved.currentId) return state;
      return { ...state, saved: { ...saved, currentId: action.id }, past: [], future: [] };
    case 'deleteBoard': {
      let next: Saved = {
        ...saved,
        docs: without(saved.docs, action.id),
        seen: without(saved.seen, action.id),
        inbox: without(saved.inbox, action.id),
        acknowledged: without(saved.acknowledged, action.id),
      };
      if (Object.keys(next.docs).length === 0) next = created(next, demoBoard(new Date()));
      const currentId = next.docs[saved.currentId] ? saved.currentId : Object.keys(next.docs)[0];
      return { ...state, saved: { ...next, currentId }, past: currentId === saved.currentId ? state.past : [], future: [] };
    }
    case 'settings':
      return { ...state, saved: { ...saved, settings: { ...saved.settings, ...action.patch } } };
  }
}

export function useHandrail() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ saved: loadSaved(), past: [], future: [], live: { seq: 0, changes: [], from: null } }));
  const { saved } = state;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* Storage full or blocked: the app still works for this session. */
    }
  }, [saved]);

  const doc = saved.docs[saved.currentId];
  const board = view(doc);
  const boards = useMemo(() => Object.values(saved.docs).map(view), [saved.docs]);
  const changes = useMemo(() => saved.inbox[saved.currentId] ?? [], [saved.inbox, saved.currentId]);

  return {
    board,
    doc,
    actor: saved.actor,
    boards,
    settings: saved.settings,
    me: saved.settings.name.trim() || null,
    changes,
    changesAcknowledged: !!saved.acknowledged[saved.currentId],
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undoLabel: state.past[state.past.length - 1]?.label ?? null,
    redoLabel: state.future[0]?.label ?? null,
    undoEntry: state.past[state.past.length - 1] ?? null,
    redoEntry: state.future[0] ?? null,
    apply: useCallback((b: Board, label: string) => dispatch({ type: 'apply', board: b, label }), []),
    replace: useCallback((b: Board) => dispatch({ type: 'replace', board: b }), []),
    commitFrom: useCallback((origin: Board, label: string) => dispatch({ type: 'commitFrom', origin, label }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    markSeen: useCallback(() => dispatch({ type: 'markSeen' }), []),
    loadShared: useCallback((d: Doc) => dispatch({ type: 'loadShared', doc: d }), []),
    mergeLive: useCallback((d: Doc, from: string | null) => dispatch({ type: 'mergeLive', doc: d, from }), []),
    liveArrivals: state.live,
    isPlausible: (d: Doc) => plausible(saved.docs[d.id], d),
    createBoard: useCallback((b: Board) => dispatch({ type: 'create', board: b }), []),
    simulateTeammates: useCallback(() => dispatch({ type: 'simulate' }), []),
    switchBoard: useCallback((id: string) => dispatch({ type: 'switch', id }), []),
    deleteBoard: useCallback((id: string) => dispatch({ type: 'deleteBoard', id }), []),
    updateSettings: useCallback((patch: Partial<Settings>) => dispatch({ type: 'settings', patch }), []),
  };
}

export type Handrail = ReturnType<typeof useHandrail>;

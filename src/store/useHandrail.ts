import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { diffBoards, type Change } from '../model/diff';
import { demoBoard } from '../model/seed';
import { validateBoard } from '../model/validate';
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
  theme: 'system',
  textSize: 100,
  font: 'atkinson',
  spacing: 'normal',
  layout: 'columns',
  speak: false,
  speechRate: 1,
  reduceMotion: false,
};

interface Saved {
  boards: Record<string, Board>;
  currentId: string;
  /** The version of each board the user last looked at (or edited themselves). */
  seen: Record<string, Board>;
  /** Teammates' changes not yet acknowledged, per board, worked out when a shared link was opened. */
  inbox: Record<string, Change[]>;
  /** Boards whose inbox the user has acknowledged with "Got it" (shown collapsed until new changes arrive). */
  acknowledged: Record<string, boolean>;
  settings: Settings;
}

interface Entry {
  board: Board;
  label: string;
}

interface State {
  saved: Saved;
  past: Entry[];
  future: Entry[];
}

type Action =
  | { type: 'apply'; board: Board; label: string }
  | { type: 'replace'; board: Board }
  | { type: 'commitFrom'; origin: Board; label: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'markSeen' }
  | { type: 'loadShared'; board: Board }
  | { type: 'create'; board: Board }
  | { type: 'switch'; id: string }
  | { type: 'deleteBoard'; id: string }
  | { type: 'settings'; patch: Partial<Settings> };

const KEY = 'handrail:v1';
const HISTORY = 60;

function freshSaved(): Saved {
  const b = demoBoard(new Date());
  return { boards: { [b.id]: b }, currentId: b.id, seen: { [b.id]: b }, inbox: {}, acknowledged: {}, settings: { ...DEFAULT_SETTINGS, name: 'Priya' } };
}

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSaved();
    const parsed = JSON.parse(raw) as Partial<Saved>;
    const boards: Record<string, Board> = {};
    for (const b of Object.values(parsed.boards ?? {})) {
      const v = validateBoard(b);
      if (v) boards[v.id] = v;
    }
    const ids = Object.keys(boards);
    if (ids.length === 0) return freshSaved();
    const seen: Record<string, Board> = {};
    for (const [id, b] of Object.entries(parsed.seen ?? {})) {
      const v = validateBoard(b);
      if (v && boards[id]) seen[id] = v;
    }
    const inbox: Record<string, Change[]> = {};
    for (const [id, list] of Object.entries(parsed.inbox ?? {})) {
      if (!boards[id] || !Array.isArray(list)) continue;
      inbox[id] = list
        .filter((c) => c && typeof c.text === 'string')
        .slice(0, 200)
        .map((c) => ({ kind: c.kind, text: c.text.slice(0, 500), forYou: !!c.forYou, cardId: typeof c.cardId === 'string' ? c.cardId : undefined }));
    }
    return {
      boards,
      currentId: parsed.currentId && boards[parsed.currentId] ? parsed.currentId : ids[0],
      seen,
      inbox,
      acknowledged: Object.fromEntries(Object.entries(parsed.acknowledged ?? {}).filter(([id, v]) => inbox[id] && v === true)),
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    };
  } catch {
    return freshSaved();
  }
}

/** Saves a new version of the current board. You have always seen your own edits. */
function withBoard(saved: Saved, board: Board): Saved {
  return { ...saved, boards: { ...saved.boards, [board.id]: board }, seen: { ...saved.seen, [board.id]: board } };
}

const without = <T,>(rec: Record<string, T>, id: string) => {
  const copy = { ...rec };
  delete copy[id];
  return copy;
};

function reducer(state: State, action: Action): State {
  const { saved } = state;
  const current = saved.boards[saved.currentId];
  switch (action.type) {
    case 'apply':
      return {
        saved: withBoard(saved, action.board),
        past: [...state.past, { board: current, label: action.label }].slice(-HISTORY),
        future: [],
      };
    case 'replace':
      return { ...state, saved: { ...saved, boards: { ...saved.boards, [action.board.id]: action.board } } };
    case 'commitFrom':
      return {
        saved: withBoard(saved, current),
        past: [...state.past, { board: action.origin, label: action.label }].slice(-HISTORY),
        future: [],
      };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        saved: { ...saved, boards: { ...saved.boards, [prev.board.id]: prev.board } },
        past: state.past.slice(0, -1),
        future: [{ board: current, label: prev.label }, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        saved: { ...saved, boards: { ...saved.boards, [next.board.id]: next.board } },
        past: [...state.past, { board: current, label: next.label }],
        future: state.future.slice(1),
      };
    }
    case 'markSeen':
      return {
        ...state,
        saved: { ...saved, seen: { ...saved.seen, [saved.currentId]: current }, acknowledged: { ...saved.acknowledged, [saved.currentId]: true } },
      };
    case 'loadShared': {
      const b = action.board;
      const sameBoardOpen = b.id === saved.currentId;
      // A board you have never seen before has nothing to compare against.
      const base = saved.seen[b.id] ?? saved.boards[b.id];
      const fresh = base ? diffBoards(base, b, saved.settings.name.trim() || null, new Date()) : [];
      // New changes replace an acknowledged list; otherwise they add to what is still unread.
      const wasAcknowledged = !!saved.acknowledged[b.id];
      const unread = fresh.length && wasAcknowledged ? fresh : [...(saved.inbox[b.id] ?? []), ...fresh];
      return {
        saved: {
          ...saved,
          boards: { ...saved.boards, [b.id]: b },
          currentId: b.id,
          seen: { ...saved.seen, [b.id]: b },
          inbox: unread.length ? { ...saved.inbox, [b.id]: unread } : without(saved.inbox, b.id),
          acknowledged: fresh.length ? without(saved.acknowledged, b.id) : saved.acknowledged,
        },
        past: sameBoardOpen ? [...state.past, { board: current, label: 'open the shared version' }] : [],
        future: [],
      };
    }
    case 'create':
      return {
        saved: {
          ...saved,
          boards: { ...saved.boards, [action.board.id]: action.board },
          currentId: action.board.id,
          seen: { ...saved.seen, [action.board.id]: action.board },
          inbox: without(saved.inbox, action.board.id),
          acknowledged: without(saved.acknowledged, action.board.id),
        },
        past: [],
        future: [],
      };
    case 'switch':
      if (!saved.boards[action.id] || action.id === saved.currentId) return state;
      return { saved: { ...saved, currentId: action.id }, past: [], future: [] };
    case 'deleteBoard': {
      const boards = without(saved.boards, action.id);
      const seen = without(saved.seen, action.id);
      const inbox = without(saved.inbox, action.id);
      const acknowledged = without(saved.acknowledged, action.id);
      if (Object.keys(boards).length === 0) {
        const b = demoBoard(new Date());
        boards[b.id] = b;
        seen[b.id] = b;
      }
      const currentId = boards[saved.currentId] ? saved.currentId : Object.keys(boards)[0];
      return { saved: { ...saved, boards, seen, inbox, acknowledged, currentId }, past: currentId === saved.currentId ? state.past : [], future: [] };
    }
    case 'settings':
      return { ...state, saved: { ...saved, settings: { ...saved.settings, ...action.patch } } };
  }
}

export function useHandrail() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ saved: loadSaved(), past: [], future: [] }));
  const { saved } = state;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* Storage full or blocked: the app still works for this session. */
    }
  }, [saved]);

  const board = saved.boards[saved.currentId];
  const changes = useMemo(() => saved.inbox[saved.currentId] ?? [], [saved.inbox, saved.currentId]);

  return {
    board,
    boards: Object.values(saved.boards),
    settings: saved.settings,
    me: saved.settings.name.trim() || null,
    changes,
    changesAcknowledged: !!saved.acknowledged[saved.currentId],
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undoLabel: state.past[state.past.length - 1]?.label ?? null,
    redoLabel: state.future[0]?.label ?? null,
    apply: useCallback((b: Board, label: string) => dispatch({ type: 'apply', board: b, label }), []),
    replace: useCallback((b: Board) => dispatch({ type: 'replace', board: b }), []),
    commitFrom: useCallback((origin: Board, label: string) => dispatch({ type: 'commitFrom', origin, label }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    markSeen: useCallback(() => dispatch({ type: 'markSeen' }), []),
    loadShared: useCallback((b: Board) => dispatch({ type: 'loadShared', board: b }), []),
    createBoard: useCallback((b: Board) => dispatch({ type: 'create', board: b }), []),
    switchBoard: useCallback((id: string) => dispatch({ type: 'switch', id }), []),
    deleteBoard: useCallback((id: string) => dispatch({ type: 'deleteBoard', id }), []),
    updateSettings: useCallback((patch: Partial<Settings>) => dispatch({ type: 'settings', patch }), []),
  };
}

export type Handrail = ReturnType<typeof useHandrail>;

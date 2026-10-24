import type { CardAuthors } from './model/crdt';
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addCard, addColumn, deleteCard, deleteColumn, doneColumn, locate, moveCard, moveColumn, peopleOn, renameBoard, renameColumn, updateCard,
} from './model/board';
import { parseCommand } from './model/commands';
import { cardDetails, positionText, sameName } from './model/describe';
import { daysUntil, describeDue } from './model/dates';
import { executeCommand } from './model/execute';
import { previewCommand } from './model/preview';
import { revertEdit } from './model/revert';
import { summarize, summarySentences } from './model/summary';
import { nextStep } from './model/next';
import { findColumn, findPerson } from './model/match';
import { demoBoard } from './model/seed';
import { TRELLO_SOMEONE, importTrello, trelloAuthors } from './model/importers';
import { fetchBoard, loadLink, saveLink, tokenFromHash, whoAmI } from './lib/trello';
import { docFromHash, parseHash } from './model/share';
import { materialize } from './model/crdt';
import type { Board } from './model/types';
import { useHandrail, type Handrail } from './store/useHandrail';
import { AnnouncerProvider, useAnnounce } from './components/Announcer';
import { BoardView } from './components/BoardView';
import { CommandBar } from './components/CommandBar';
import { ChangesPanel } from './components/ChangesPanel';
import { ActivityContent, ComingUp, LiveBar, NamePrompt, type HistoryEntry, type LiveStatus } from './components/ActivityPanel';
import { createSession, newRoomCode, trysteroTransport, type LiveSession } from './lib/live';
import { entrance, replay } from './lib/motion';
import { personClass } from './components/BoardView';
import type { Change } from './model/diff';
import { Modal } from './components/Modal';
// The story is only for first visits, so it loads separately and the board opens faster.
const Landing = lazy(() => import('./components/Landing').then((m) => ({ default: m.Landing })));
import { Blindfold } from './components/Blindfold';
import { useMediaQuery } from './lib/useMediaQuery';
import { CheckIcon, ChevronDownIcon, CloseIcon, GearIcon, HelpIcon, RedoIcon, ShareIcon, UndoIcon } from './components/Icons';
import type { ChangeKind } from './model/diff';
import { CardActionsDialog, CardEditorDialog, ColumnDialog, type EditorValue } from './components/CardDialogs';
import { BoardsDialog, HelpDialog, SettingsDialog, ShareDialog } from './components/AppDialogs';

type DialogName = 'settings' | 'help' | 'share' | 'boards' | null;

const STORY_SEEN = 'handrail:story-seen';
/** Set for the rest of the browser session once someone opens the board from the story. */
const STORY_SHOWN = 'handrail:story-shown';

/**
 * The scroll story is the front page, once per browser session: a new visit starts with
 * it, and reloading while you work goes straight to the board. Share links and the
 * eyes-closed challenge always skip it; ?story always shows it.
 */
function showStoryFirst(): boolean {
  try {
    if (window.location.hash.startsWith('#board=')) return false;
    const q = new URLSearchParams(window.location.search);
    if (q.has('story')) return true;
    if (q.has('blindfold') || q.has('board')) return false;
    return !sessionStorage.getItem(STORY_SHOWN);
  } catch {
    return false;
  }
}

function isNewHere(): boolean {
  try {
    return !localStorage.getItem(STORY_SEEN) && !localStorage.getItem('handrail:v1') && !window.location.hash.startsWith('#board=');
  } catch {
    return false;
  }
}

/**
 * A first visit (nothing saved yet) starts with teammates' changes already waiting, so the
 * main feature is the first thing anyone sees. Not for share links or the eyes-closed
 * challenge, which set up their own boards.
 */
function isFirstVisit(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    return !localStorage.getItem(STORY_SEEN) && !localStorage.getItem('handrail:v1') && !window.location.hash.startsWith('#board=') && !q.has('blindfold');
  } catch {
    return false;
  }
}

export default function App() {
  // Read before the store saves anything.
  const [firstVisit] = useState(isFirstVisit);
  const [story, setStory] = useState(showStoryFirst);
  const [newHere, setNewHere] = useState(isNewHere);
  const [arrived, setArrived] = useState(false);
  const store = useHandrail();
  const enter = useCallback(() => {
    try {
      localStorage.setItem(STORY_SEEN, '1');
      sessionStorage.setItem(STORY_SHOWN, '1');
      const q = new URLSearchParams(window.location.search);
      if (q.has('story')) {
        q.delete('story');
        const rest = q.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
      }
    } catch {
      /* ignore */
    }
    window.scrollTo(0, 0);
    // They've had the introduction; the "New here" line would repeat it.
    setNewHere(false);
    setArrived(true);
    setStory(false);
  }, []);
  return (
    <AnnouncerProvider speakAloud={store.settings.speak} rate={store.settings.speechRate}>
      {story ? (
        <Suspense fallback={<div className="landing" aria-busy="true" />}>
        <Landing
          onEnter={enter}
          onChallenge={() => {
            window.history.replaceState(null, '', '?blindfold');
            enter();
          }}
        />
        </Suspense>
      ) : <Shell store={store} arrived={arrived} newHere={newHere} firstVisit={firstVisit} onStory={() => { window.scrollTo(0, 0); setNewHere(false); setStory(true); }} />}
    </AnnouncerProvider>
  );
}

/**
 * Puts focus back where it was before a dialog opened, one frame later (after the
 * dialog has closed). Skips it if the user has already moved focus somewhere else.
 */
function restoreFocus(el: HTMLElement | null) {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    const idle = !active || active === document.body || !!active.closest('dialog:not([open])');
    if (!idle) return;
    (el && document.contains(el) ? el : document.getElementById('command-input'))?.focus();
  });
}

function useToday(): Date {
  const [day, setDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const t = window.setInterval(() => setDay(new Date().toDateString()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return useMemo(() => new Date(day), [day]);
}

function Shell({ store, onStory, arrived, newHere, firstVisit }: { store: Handrail; onStory: () => void; arrived: boolean; newHere: boolean; firstVisit: boolean }) {
  const { announce, message: lastMessage } = useAnnounce();
  const today = useToday();
  const { board, me, settings } = store;

  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ cardId: string | null; columnId: string } | null>(null);
  const [columnDlg, setColumnDlg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  /** The rest of a summary that was cut short, for the "more" command. */
  const moreToSay = useRef('');
  const justOpened = useRef<string | null>(null);
  // Breakpoints follow the chosen text size: at 200% text a 1280px window has the room of a 640px one.
  const scale = store.settings.textSize / 100;
  const wide = useMediaQuery(`(min-width: ${Math.round(1000 * scale)}px)`);
  const compact = useMediaQuery(`(max-width: ${Math.round(640 * scale)}px)`);
  const [activityOpen, setActivityOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyId = useRef(0);
  const [justMine, setJustMine] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [welcome, setWelcome] = useState((newHere || firstVisit) && !new URLSearchParams(window.location.search).has('blindfold'));
  const dismissWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem(STORY_SEEN, '1');
    } catch {
      /* ignore */
    }
  };
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => { setOnline(true); };
    const down = () => {
      setOnline(false);
      announce('You are offline. Handrail keeps working and saves on this device.');
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [announce]);
  const [blindfold, setBlindfold] = useState(() => new URLSearchParams(window.location.search).has('blindfold'));
  const before = store.beforeBoard;
  const viewing = showBefore && before ? before : store.board;
  // Any change to the real board (yours or a teammate's) brings you back to now.
  const docNow = store.doc;
  useEffect(() => setShowBefore(false), [docNow]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const session = useRef<LiveSession | null>(null);
  const liveBoard = useRef<string | null>(null);
  const docRef = useRef(store.doc);
  docRef.current = store.doc;
  const meRef = useRef(store.me);
  meRef.current = store.me;
  const dockRef = useRef<HTMLDivElement>(null);

  // Keep the phone dock's height in a CSS variable so nothing hides behind it.
  useEffect(() => {
    const el = dockRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty('--dock-h');
      return;
    }
    const set = () => root.style.setProperty('--dock-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide, activityOpen]);

  const addHistory = useCallback((who: HistoryEntry['who'], text: string, ok?: boolean) => {
    setHistory((h) => [...h, { id: ++historyId.current, who, text, ok }].slice(-80));
  }, []);

  const focusLater = useCallback((id: string) => setFocusTarget({ id, n: Date.now() }), []);
  const focusCardLater = useCallback((cardId: string | undefined | null) => {
    if (cardId) {
      setFocusedCardId(cardId);
      focusLater(`card-${cardId}`);
    } else focusLater('command-input');
  }, [focusLater]);

  useEffect(() => {
    if (!focusTarget) return;
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById(focusTarget.id);
      if (el) {
        el.focus();
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusTarget]);

  // Briefly highlight a card the command bar acted on, so sighted users see it too.
  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`card-${highlightId}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const t = window.setTimeout(() => setHighlightId(null), 2500);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  // ---- Display settings ----------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    root.dataset.spacing = settings.spacing;
    root.dataset.motion = settings.reduceMotion ? 'reduce' : 'auto';
    root.style.fontSize = `${settings.textSize}%`;
  }, [settings]);

  useEffect(() => {
    if (compact) document.documentElement.dataset.compact = '';
    else delete document.documentElement.dataset.compact;
  }, [compact]);

  // The tab title shows how many teammates' changes are waiting, so you notice from another tab.
  const waiting = store.changesAcknowledged ? 0 : store.changes.length;
  useEffect(() => {
    document.title = `${waiting ? `(${waiting}) ` : ''}${board.title} · Handrail`;
  }, [board.title, waiting]);

  // ---- Opening a shared link ------------------------------------------------
  useEffect(() => {
    const open = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#board=')) return;
      // Clear the link first, so a bad link can never break the page again on reload.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const shared = docFromHash(hash);
      const room = parseHash(hash)?.live ?? null;
      if (!shared) {
        announce('That share link is broken or incomplete. Ask your teammate to copy it again.');
        return;
      }
      if (!store.isPlausible(shared)) {
        announce('That share link looks damaged or forged, so it was not merged. Ask your teammate to copy it again.');
        return;
      }
      justOpened.current = materialize(shared).title;
      store.loadShared(shared);
      if (room) void startLive(room, shared.id);
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!justOpened.current) return;
    const title = justOpened.current;
    justOpened.current = null;
    const n = store.changes.length;
    if (n > 0) {
      const forYou = store.changes.filter((c) => c.forYou).length;
      // Focus moves to the short heading first; the summary follows, so a screen reader
      // reads the summary instead of every item in the panel, and focus speech can't cut it off.
      // First sentence only, so it's short enough to hear in full; "more" reads the rest.
      const parts = summarySentences(store.changes, me, today);
      moreToSay.current = parts.slice(1).join(' ');
      const next = nextStep(store.board, me, today, store.changes);
      const said = `Opened the shared “${title}”. ${n} ${n === 1 ? 'change' : 'changes'} since you last looked${forYou ? `, ${forYou} for you` : ''}. ${parts[0]}${next ? ` ${next.text}` : ''}${parts.length > 1 ? ' Say or type “more” for the rest of the changes.' : ''}`;
      const pending = window.setTimeout(() => announce(said), 400);
      // If they act straight away, their action's announcement wins over the summary.
      const cancel = () => window.clearTimeout(pending);
      window.addEventListener('pointerdown', cancel, { once: true, capture: true });
      window.addEventListener('keydown', cancel, { once: true, capture: true });
      if (wide) {
        focusLater('changes-h');
        window.setTimeout(() => replayChanges(store.changes), 700);
      } else {
        lastFocus.current = null;
        setActivityOpen(true);
      }
    } else {
      announce(`Opened the shared “${title}”. Nothing new since you last looked.`);
    }
  }, [store.changes, focusLater, announce, wide]);

  // ---- Live sessions ----------------------------------------------------------
  async function startLive(room: string, boardId = store.board.id) {
    session.current?.leave();
    session.current = null;
    liveBoard.current = boardId;
    setLive({ room, peers: [] });
    try {
      const transport = await trysteroTransport(boardId, room);
      let known = new Map<string, string | null>();
      session.current = createSession(transport, store.me, {
        getDoc: () => docRef.current,
        onDoc: (doc, from) => store.mergeLive(doc, from.name),
        onPeers: (peers) => {
          // Say who came and went, once each.
          const now = new Map(peers.map((p) => [p.id, p.name]));
          for (const [id, name] of now) if (!known.has(id) && name) announce(`${name} joined the live session.`);
          for (const [id, name] of known) if (!now.has(id)) announce(`${name ?? 'A teammate'} left the live session.`);
          for (const [id, name] of now) if (known.has(id) && !known.get(id) && name) announce(`${name} joined the live session.`);
          known = now;
          setLive((l) => (l ? { ...l, peers } : l));
        },
      }, store.actor, 150);
      // The name may have been entered while connecting (e.g. a teammate who just opened the invite).
      if (meRef.current) session.current.setName(meRef.current);
      announce('Live session open. Teammates who open the invite link will join, and their changes will be read out as they arrive.');
    } catch {
      setLive({ room, peers: [], error: 'Couldn’t start a live session. Check your connection; share links still work.' });
    }
  }

  function leaveLive() {
    session.current?.leave();
    session.current = null;
    setLive(null);
    announce('You left the live session. Your board stays as it is.');
  }

  useEffect(() => () => session.current?.leave(), []);
  // Send each of your own edits to the room (merged copies that add nothing are skipped).
  useEffect(() => {
    session.current?.publish(store.doc);
  }, [store.doc]);
  useEffect(() => {
    session.current?.setName(store.me);
  }, [store.me]);
  // A live room belongs to one board.
  useEffect(() => {
    if (session.current && liveBoard.current && store.board.id !== liveBoard.current) leaveLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.board.id]);
  // Read out teammates' edits as they arrive.
  useEffect(() => {
    const { changes, seq } = store.liveArrivals;
    if (!seq || !changes.length) return;
    const text = summarize(changes, me, today);
    announce(text);
    replayChanges(changes);
    // In a background tab, and only if asked for: a system notification.
    if (document.hidden && settings.notify && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`Handrail · ${store.board.title}`, { body: text, tag: 'handrail-live' });
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.liveArrivals.seq]);

  /** Name-tagged cursors fly from Activity to each card a teammate changed (or the cards flash, with motion off). */
  function replayChanges(list: Change[]) {
    const seen = new Set<string>();
    const steps = list
      .filter((c) => c.cardId && !seen.has(c.cardId) && seen.add(c.cardId))
      .map((c) => ({ cardId: c.cardId!, who: c.by ?? 'Someone', colour: personClass(c.by) }));
    void replay(steps);
  }

  useEffect(() => {
    entrance(document.querySelector<HTMLElement>('main'));
    if (firstVisit) {
      // First visit: the teammates' changes are waiting; the arrival flow announces them and moves focus there.
      simulateTeammates();
    } else if (arrived) {
      // Coming from the story: land somewhere useful, and say where.
      focusLater('board-switcher');
      announce(`Board opened: ${store.board.title}. Press slash to type a command, or Tab to reach the cards.`);
    } else if (!window.location.hash.startsWith('#board=') && !store.changesAcknowledged && store.changes.length) {
      // Unread teammates' changes from before: say so straight away.
      const n = store.changes.length;
      window.setTimeout(() => announce(`${n} ${n === 1 ? 'change is' : 'changes are'} waiting since you last looked. Say “what changed” to hear them.`), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Undo / redo -----------------------------------------------------------
  const undo = useCallback((): string => {
    const e = store.undoEntry;
    let msg = 'Nothing to undo.';
    if (e) {
      const { skipped } = revertEdit(store.board, e.before, e.after, store.me);
      msg = `Undid: ${e.label}.${skipped ? ` A teammate has changed ${skipped === 1 ? 'part of it' : `${skipped} parts of it`} since, so ${skipped === 1 ? 'that was' : 'those were'} left as they are.` : ''}`;
    }
    announce(msg);
    store.undo();
    return msg;
  }, [store, announce]);
  const redo = useCallback((): string => {
    const e = store.redoEntry;
    let msg = 'Nothing to redo.';
    if (e) {
      const { skipped } = revertEdit(store.board, e.after, e.before, store.me);
      msg = `Redid: ${e.label}.${skipped ? ` ${skipped === 1 ? 'One part was' : `${skipped} parts were`} changed by a teammate since and left as they are.` : ''}`;
    }
    announce(msg);
    store.redo();
    return msg;
  }, [store, announce]);

  // ---- Global shortcuts --------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // An empty command box doesn't need text undo, so Ctrl+Z there undoes the last board change.
      const emptyCommand = t.id === 'command-input' && !(t as HTMLInputElement).value;
      const typing = !(emptyCommand && (e.ctrlKey || e.metaKey)) && t.closest('input, textarea, select, [contenteditable="true"]');
      if (document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
        return;
      }
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '/') { e.preventDefault(); document.getElementById('command-input')?.focus(); }
      else if (e.key === '?') { e.preventDefault(); openDialog('help'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function openDialog(name: DialogName) {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setDialog(name);
  }
  function closeDialog() {
    setDialog(null);
    const el = lastFocus.current;
    restoreFocus(el);
  }

  // ---- Commands ----------------------------------------------------------
  function parse(text: string) {
    return parseCommand(text, {
      today,
      isColumn: (t) => !!findColumn(board, t).match,
      isPerson: (t) => !!findPerson(peopleOn(board), t, me),
    });
  }
  const previewText = (text: string) => previewCommand(parse(text), board, { today, me });

  function runCommand(text: string): boolean {
    const cmd = parse(text);
    const r = executeCommand(cmd, board, { today, me });
    let reply = r.message;
    if (r.effect === 'undo') reply = undo();
    else if (r.effect === 'redo') reply = redo();
    else if (r.effect === 'help') { openDialog('help'); reply = 'Opened help.'; }
    else if (r.effect === 'changes') reply = store.changes.length === 0 ? 'Nothing has changed since you last looked.' : readChanges();
    else if (r.effect === 'more') {
      reply = moreToSay.current || 'That’s everything. Say “what changed” to hear it all again.';
      moreToSay.current = '';
    } else if (r.effect === 'repeat') reply = lastMessage || 'Nothing to repeat yet.';
    else if (r.effect === 'next') {
      const next = nextStep(board, me, today, store.changes);
      reply = next ? next.text : me ? 'Nothing open is assigned to you. Say “my tasks” or “summary” to look around.' : 'Set your name in Settings first, so Handrail knows which cards are yours.';
      if (next) focusCardLater(next.cardId);
    }
    if (r.board) store.apply(r.board, r.label ?? 'change');
    if (reply && r.effect !== 'undo' && r.effect !== 'redo') announce(reply);
    addHistory('you', text);
    addHistory('handrail', reply, r.ok);
    if (r.focusCardId) {
      setFocusedCardId(r.focusCardId);
      setHighlightId(r.focusCardId);
    }
    return r.ok;
  }

  /** The spoken digest: a count, then the grouped summary ("Riya moved 2 cards to Done…"). */
  function readChanges() {
    const list = justMine ? store.changes.filter((c) => c.forYou) : store.changes;
    const n = list.length;
    if (n === 0) return justMine ? 'Nothing that involves you has changed since you last looked.' : 'Nothing has changed since you last looked.';
    return `${n} ${n === 1 ? 'change' : 'changes'} since you last looked. ${summarize(list, me, today)}`;
  }

  // ---- Card actions ------------------------------------------------------
  function closeActions(focusId?: string | null) {
    const id = focusId === undefined ? actionsFor : focusId;
    setActionsFor(null);
    focusCardLater(id);
  }

  function moveFromMenu(cardId: string, columnId: string, position: 'top' | 'bottom') {
    const target = board.columns.find((c) => c.id === columnId)!;
    const index = position === 'top' ? 0 : target.cardIds.filter((x) => x !== cardId).length;
    const next = moveCard(board, cardId, columnId, index, me);
    store.apply(next, `move “${board.cards[cardId].title}”`);
    announce(`Moved to ${target.title}${position === 'top' ? ', at the top' : ''}. ${positionText(next, cardId)}.`);
    closeActions(cardId);
  }

  function nudge(cardId: string, delta: number) {
    const loc = locate(board, cardId)!;
    const next = moveCard(board, cardId, loc.column.id, loc.index + delta, me);
    store.apply(next, `move “${board.cards[cardId].title}” ${delta < 0 ? 'up' : 'down'}`);
    announce(`Moved ${delta < 0 ? 'up' : 'down'}. ${positionText(next, cardId)}.`);
  }

  function removeCard(cardId: string) {
    const card = board.cards[cardId];
    const loc = locate(board, cardId);
    if (!card || !loc) return;
    const neighbour = loc.column.cardIds[loc.index + 1] ?? loc.column.cardIds[loc.index - 1] ?? null;
    store.apply(deleteCard(board, cardId), `delete “${card.title}”`);
    announce(`Deleted “${card.title}”. Press Control Z or say “undo” to bring it back.`);
    setActionsFor(null);
    setEditor(null);
    focusCardLater(neighbour);
  }

  function readCard(cardId: string) {
    const card = board.cards[cardId];
    if (!card) return;
    const d = cardDetails(card, today, me).replace(', has notes', '');
    announce(`${card.title}${d ? `, ${d}` : ''}. In ${positionText(board, cardId)}.${card.notes.trim() ? ` Notes: ${card.notes.trim()}` : ' No notes.'}`);
  }

  function saveEditor(cardId: string | null, v: EditorValue) {
    if (cardId) {
      let next = updateCard(board, cardId, { title: v.title, notes: v.notes, due: v.due, assignee: v.assignee }, me);
      const loc = locate(next, cardId)!;
      if (loc.column.id !== v.columnId) {
        const target = next.columns.find((c) => c.id === v.columnId)!;
        next = moveCard(next, cardId, v.columnId, target.cardIds.length, me);
      }
      store.apply(next, `edit “${v.title}”`);
      announce(`Saved “${v.title}”. ${positionText(next, cardId)}.`);
      setEditor(null);
      focusCardLater(cardId);
    } else {
      const { board: next, cardId: id } = addCard(board, v.columnId, v, me);
      store.apply(next, `add “${v.title}”`);
      const d = cardDetails(next.cards[id], today, me);
      announce(`Added “${v.title}”${d ? `, ${d}` : ''}. ${positionText(next, id)}.`);
      setEditor(null);
      focusCardLater(id);
    }
  }

  function closeColumnDialog(focusId = 'board') {
    setColumnDlg(null);
    focusLater(focusId);
  }

  // ---- Demo helpers ------------------------------------------------------
  function simulateTeammates() {
    justOpened.current = demoBoard(today).title;
    store.simulateTeammates();
    setDialog(null);
  }

  // ---- Trello, read directly ------------------------------------------------------
  async function followTrello(id: string): Promise<string> {
    try {
      const raw = await fetchBoard(loadLink(), id);
      const b = importTrello(raw);
      if (!b) return 'Trello sent something Handrail couldn’t read.';
      importBoard(b, 'Trello', trelloAuthors(raw));
      return `Following “${b.title}”.`;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Reads every followed Trello board again and says what changed since you last looked. */
  async function syncTrello(manual: boolean): Promise<string> {
    const link = loadLink();
    if (!link.token || link.boards.length === 0) return 'No Trello boards to check.';
    const found: string[] = [];
    let total = 0;
    for (const id of link.boards) {
      try {
        const raw = await fetchBoard(link, id);
        const b = importTrello(raw);
        if (!b) continue;
        const r = store.importTrello(b, trelloAuthors(raw), TRELLO_SOMEONE, manual ? true : 'ifChanged');
        if (r.changes) {
          total += r.changes;
          found.push(`${r.changes} ${r.changes === 1 ? 'change' : 'changes'} on “${b.title}”`);
        }
      } catch (e) {
        if (manual) return (e as Error).message;
        announce(`Couldn’t check Trello: ${(e as Error).message}`);
        return '';
      }
    }
    if (!total) {
      if (manual) announce('Checked Trello. Nothing new since you last looked.');
      return 'Nothing new in Trello since you last looked.';
    }
    const msg = `Checked Trello: ${found.join(', ')} since you last looked. Say “what changed” to hear them.`;
    setDialog(null);
    announce(msg);
    if (wide) focusLater('changes-h');
    else { lastFocus.current = null; setActivityOpen(true); }
    return msg;
  }

  useEffect(() => {
    // Back from Trello's sign-in page with a token: keep it, and offer the board picker.
    const token = tokenFromHash(window.location.hash);
    if (token) {
      saveLink({ ...loadLink(), token });
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      openDialog('boards');
      announce('Connected to Trello, read-only. Choose a board to follow.');
      // Use the name Trello has for you, so cards assigned to you there count as yours here.
      whoAmI(loadLink())
        .then((m) => {
          const name = (m.fullName || m.username || '').trim().slice(0, 60);
          if (name && name !== store.settings.name) {
            store.updateSettings({ name });
            announce(`Connected to Trello as ${name}, read-only. Choose a board to follow.`);
          }
        })
        .catch(() => { /* the name can still be set in Settings */ });
      return;
    }
    // Followed boards are checked each time Handrail opens.
    const link = loadLink();
    if (link.token && link.boards.length && !window.location.hash.startsWith('#board=')) {
      const t = window.setTimeout(() => void syncTrello(false), 1200);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function importBoard(b: Board, source: string, authors?: Record<string, CardAuthors>) {
    setDialog(null);
    if (authors) {
      const r = store.importTrello(b, authors, TRELLO_SOMEONE);
      if (r.updated) {
        announce(r.changes
          ? `Updated “${b.title}” from Trello. ${r.changes} ${r.changes === 1 ? 'change' : 'changes'} since your last import. Say “what changed” to hear them.`
          : `Updated “${b.title}” from Trello. Nothing changed since your last import.`);
        if (!r.changes) focusLater('board');
        else if (wide) focusLater('changes-h');
        else { lastFocus.current = null; setActivityOpen(true); }
        return;
      }
    } else {
      store.createBoard(b);
    }
    const n = Object.keys(b.cards).length;
    announce(`Imported “${b.title}” from ${source}: ${b.columns.length} columns and ${n} ${n === 1 ? 'card' : 'cards'}.`);
    focusLater('board');
  }

  const cb = {
    apply: store.apply,
    replace: store.replace,
    commitFrom: store.commitFrom,
    openActions: (id: string) => { setActionsFor(id); },
    openEditor: (cardId: string | null, columnId: string) => setEditor({ cardId, columnId }),
    openColumn: (id: string) => setColumnDlg(id),
    addColumn: () => setColumnDlg('new'),
    deleteCard: removeCard,
    readCard,
  };

  const cardCount = Object.keys(board.cards).length;
  const visible = justMine && me ? (id: string) => sameName(board.cards[id]?.assignee ?? null, me) : undefined;
  const firstCard = board.columns.flatMap((c) => c.cardIds).find((id) => !visible || visible(id)) ?? null;
  const unread = store.changesAcknowledged ? 0 : store.changes.length;

  // Cards teammates changed since you last looked, labelled for the board ("Riya · moved").
  const changedCards: Record<string, string> = {};
  if (!store.changesAcknowledged) {
    const verbs: Record<ChangeKind, string> = { added: 'new', moved: 'moved', renamed: 'renamed', due: 'new date', assigned: 'reassigned', notes: 'notes', removed: 'removed', column: '', conflict: 'conflict' };
    const tags: Record<string, { by: string | null; verbs: string[] }> = {};
    for (const c of store.changes) {
      if (!c.cardId || !board.cards[c.cardId] || !verbs[c.kind]) continue;
      const tag = (tags[c.cardId] ??= { by: c.by ?? board.cards[c.cardId].lastEditedBy, verbs: [] });
      if (!tag.verbs.includes(verbs[c.kind])) tag.verbs.push(verbs[c.kind]);
    }
    for (const [id, tag] of Object.entries(tags)) {
      changedCards[id] = `${tag.by ?? 'Someone'} · ${tag.verbs.join(', ')}`;
    }
  }

  function openActivity() {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setActivityOpen(true);
  }
  function closeActivity() {
    setActivityOpen(false);
    const el = lastFocus.current;
    restoreFocus(el);
  }

  function toggleBefore(next: boolean) {
    if (next && !before) return;
    setShowBefore(next);
    announce(next
      ? `Showing the board as you last saw it, before ${store.changes.length} ${store.changes.length === 1 ? 'change' : 'changes'}. You can move around and read cards, but not change them.`
      : 'Showing the board as it is now.');
  }

  function toggleJustMine() {
    if (!me) {
      announce('Set your name in Settings first, so Handrail knows which cards are yours.');
      return;
    }
    const next = !justMine;
    setJustMine(next);
    const mine = Object.values(board.cards).filter((c) => sameName(c.assignee, me)).length;
    announce(next ? `Showing only your ${mine} ${mine === 1 ? 'card' : 'cards'} and the changes that involve you.` : 'Showing everyone\u2019s cards.');
  }

  const justMineButton = (
    <button type="button" className={`btn btn-secondary small toggle${justMine ? ' is-on' : ''}`} aria-pressed={justMine} onClick={toggleJustMine}>
      {justMine && <CheckIcon size={16} />} Just mine
    </button>
  );

  // Your own deadlines: overdue, today or tomorrow, not yet done.
  const doneCol = doneColumn(board);
  const upcomingItems = me
    ? board.columns
        .filter((c) => c.id !== doneCol?.id)
        .flatMap((c) => c.cardIds.map((id) => board.cards[id]))
        .filter((k) => k.due && sameName(k.assignee, me) && daysUntil(k.due, today) <= 1)
        .sort((a, b) => (a.due! < b.due! ? -1 : 1))
        .map((k) => {
          const d = describeDue(k.due!, today);
          return { id: k.id, title: k.title, when: d.status === 'overdue' ? d.spoken.split(',')[0] : d.status === 'today' ? 'due today' : 'due tomorrow', overdue: d.status === 'overdue' };
        })
    : [];
  const upcomingPanel = (
    <ComingUp
      items={upcomingItems}
      onGoTo={(id) => {
        setActivityOpen(false);
        if (visible && !visible(id)) setJustMine(false);
        focusCardLater(id);
        setHighlightId(id);
      }}
    />
  );

  const changesPanel = (
    <>
    {live && <LiveBar live={live} onInvite={() => openDialog('share')} onLeave={leaveLive} />}
    {!me && (
      <NamePrompt
        onSave={(name) => {
          store.updateSettings({ name });
          announce(`Thanks, ${name}. Your changes will show your name.`);
        }}
      />
    )}
    <ChangesPanel
      changes={store.changes}
      acknowledged={store.changesAcknowledged}
      justMine={justMine}
      board={board}
      onGoTo={(id) => {
        if (visible && !visible(id)) setJustMine(false);
        setActivityOpen(false);
        focusCardLater(id);
        setHighlightId(id);
      }}
      digest={summarize(justMine ? store.changes.filter((c) => c.forYou) : store.changes, me, today)}
      next={nextStep(board, me, today, store.changes)}
      onReadAll={() => announce(readChanges())}
      onReplay={() => replayChanges(justMine ? store.changes.filter((c) => c.forYou) : store.changes)}
      hasBefore={!!before}
      showingBefore={showBefore && !!before}
      onToggleBefore={() => toggleBefore(!(showBefore && before))}
      onDone={() => {
        store.markSeen();
        announce('Marked as seen. The changes stay collapsed in Activity until new ones arrive.');
        focusLater('changes-show');
      }}
    />
    </>
  );

  return (
    <>
      {store.changes.length > 0 && !store.changesAcknowledged && (
        <a className="skip-link" href="#changes" onClick={(e) => { e.preventDefault(); if (wide) focusLater('changes-h'); else openActivity(); }}>
          Skip to what changed ({store.changes.length} new)
        </a>
      )}
      <a className="skip-link" href="#board" onClick={(e) => { e.preventDefault(); focusCardLater(focusedCardId ?? firstCard); }}>
        Skip to the board
      </a>
      <a className="skip-link" href="#activity" onClick={(e) => { e.preventDefault(); if (wide) focusLater('activity-h'); else openActivity(); }}>
        Skip to activity
      </a>
      <a className="skip-link" href="#command-input" onClick={(e) => { e.preventDefault(); focusLater('command-input'); }}>
        Skip to the command box
      </a>
      <div className={`layout ${wide ? 'is-wide' : 'is-narrow'}`}>
      <div className="main-col">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28"><rect x="3" y="5" width="7" height="22" rx="2" /><rect x="12.5" y="5" width="7" height="14" rx="2" /><rect x="22" y="5" width="7" height="18" rx="2" /><path d="M2 28.5h28" strokeWidth="2.4" strokeLinecap="round" /></svg>
          </span>
          <span className="brand-name">Handrail</span>
          <span className={`status-pill${live ? ' is-live' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {live ? (live.peers.length ? `Live with ${live.peers.length} ${live.peers.length === 1 ? 'teammate' : 'teammates'}` : 'Live session open') : online ? 'Saved on this device' : 'Offline · everything still works'}
          </span>
        </div>
        <nav aria-label="Board tools" className="toolbar">
          <button type="button" className="btn btn-quiet" onClick={undo} disabled={!store.canUndo} title={store.undoLabel ? `Undo: ${store.undoLabel}` : 'Nothing to undo'}>
            <UndoIcon /> <span className="btn-label">Undo</span>
          </button>
          <button type="button" className="btn btn-quiet" onClick={redo} disabled={!store.canRedo} title={store.redoLabel ? `Redo: ${store.redoLabel}` : 'Nothing to redo'}>
            <RedoIcon /> <span className="btn-label">Redo</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('share')}>
            <ShareIcon /> <span className="btn-label">Share</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('settings')}>
            <GearIcon /> <span className="btn-label">Settings</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('help')}>
            <HelpIcon /> <span className="btn-label">Help</span>
          </button>
        </nav>
      </header>

      <main id="main">
        {welcome && (
          <aside className="welcome" aria-label="New here">
            <p>
              <strong>New here?</strong> This sample board belongs to Priya, who is blind. Riya and Arjun changed it overnight, and
              Handrail has already listed what changed, under <strong>Since you last looked</strong>. Try <strong>Show me on the board</strong> or <strong>Before / now</strong>.
            </p>
            <div className="action-list">
              <button type="button" className="btn btn-primary small" onClick={() => { dismissWelcome(); setBlindfold(true); }}>
                Try it with your eyes closed
              </button>
              {!arrived && (
                <button type="button" className="btn btn-quiet small" onClick={() => { dismissWelcome(); onStory(); }}>
                  1-minute story
                </button>
              )}
              <button type="button" className="btn btn-quiet small icon-only" aria-label="Dismiss" onClick={dismissWelcome}>
                <CloseIcon size={18} />
              </button>
            </div>
          </aside>
        )}
        <div className="board-head">
          <h1>
            <button type="button" id="board-switcher" className="board-name" onClick={() => openDialog('boards')} aria-haspopup="dialog" aria-describedby="board-switcher-hint">
              <span className="title-words">
                {board.title.split(/\s+/).map((w, i) => (
                  <Fragment key={i}>
                    {i > 0 && ' '}
                    <span className="title-word-wrap">
                      <span className="title-word">{w}</span>
                    </span>
                  </Fragment>
                ))}
              </span>
              <ChevronDownIcon size={20} />
            </button>
          </h1>
          <span id="board-switcher-hint" hidden>Switch, rename, import or export boards</span>
          <p className="board-counts">
            {board.columns.length} columns · {cardCount} {cardCount === 1 ? 'card' : 'cards'}
          </p>
          {justMineButton}
        </div>

          {showBefore && before && (
            <div className="before-banner">
              <p>
                <strong>Before.</strong> This is how the board looked when you last saw it, before {store.changes.length}{' '}
                {store.changes.length === 1 ? 'change' : 'changes'}. Nothing can be changed in this view.
              </p>
              <button type="button" className="btn btn-primary small" onClick={() => toggleBefore(false)}>Show now</button>
            </div>
          )}
          <BoardView
            tiltCards={settings.labsTilt}
            readOnly={showBefore && !!before}
            layout={settings.layout}
            board={viewing}
            today={today}
            me={me}
            focusedCardId={focusedCardId}
            setFocusedCardId={setFocusedCardId}
            highlightId={highlightId}
            cb={cb}
            visible={visible}
            changed={showBefore ? undefined : changedCards}
          />
      </main>
      <footer className="footer">
        <p>
          Handrail keeps your boards on this device. No account, no tracking. <a href="https://github.com/Dakshhhhh-ops/Handrail">Source code</a>
        </p>
      </footer>
      </div>
      {wide && (
        <aside className="activity" id="activity" aria-labelledby="activity-h">
          <ActivityContent upcoming={upcomingPanel} changes={changesPanel} history={history} commandBar={<CommandBar onRun={runCommand} preview={previewText} />} />
        </aside>
      )}
      </div>

      {!wide && (
        <div className="dock" id="activity" role="region" aria-label="Commands and activity" ref={dockRef}>
          <button type="button" id="dock-activity" className="btn btn-secondary dock-activity" onClick={openActivity} aria-haspopup="dialog">
            Activity{unread > 0 && <span className="pill">{unread}<span className="sr-only"> new</span></span>}
            {live && <span className="pill pill-live">live</span>}
          </button>
          {/* Only one command box exists at a time: the dialog has its own while it is open. */}
          {!activityOpen && <CommandBar onRun={runCommand} preview={previewText} lastReply={history.filter((h) => h.who === 'handrail').at(-1) ?? null} />}
        </div>
      )}
      {!wide && (
        <Modal open={activityOpen} onClose={closeActivity} title="Activity" full testId="activity-dialog">
          <ActivityContent headless upcoming={upcomingPanel} changes={changesPanel} history={history} commandBar={<CommandBar onRun={runCommand} preview={previewText} />} />
        </Modal>
      )}

      <CardActionsDialog
        board={board}
        cardId={actionsFor}
        today={today}
        me={me}
        onClose={() => closeActions()}
        onMove={moveFromMenu}
        onNudge={nudge}
        onEdit={(id) => { setActionsFor(null); setEditor({ cardId: id, columnId: locate(board, id)!.column.id }); }}
        onDelete={removeCard}
        onRead={readCard}
      />
      <CardEditorDialog
        board={board}
        state={editor}
        today={today}
        me={me}
        onClose={() => { const id = editor?.cardId; setEditor(null); if (id) focusCardLater(id); else focusLater('command-input'); }}
        onSave={saveEditor}
        onDelete={removeCard}
      />
      <ColumnDialog
        board={board}
        columnId={columnDlg}
        onClose={() => closeColumnDialog()}
        onAdd={(title) => {
          store.apply(addColumn(board, title).board, `add column “${title.trim()}”`);
          announce(`Added the column “${title.trim()}” at the end.`);
          closeColumnDialog();
        }}
        onRename={(id, title) => {
          const old = board.columns.find((c) => c.id === id)!.title;
          store.apply(renameColumn(board, id, title), `rename column “${old}”`);
          announce(`Renamed “${old}” to “${title.trim()}”.`);
          closeColumnDialog();
        }}
        onMove={(id, delta) => {
          const next = moveColumn(board, id, delta);
          const col = next.columns.findIndex((c) => c.id === id);
          store.apply(next, 'move a column');
          announce(`Moved the column to position ${col + 1} of ${next.columns.length}.`);
        }}
        onDelete={(id) => {
          const col = board.columns.find((c) => c.id === id)!;
          store.apply(deleteColumn(board, id), `delete column “${col.title}”`);
          announce(`Deleted the column “${col.title}”. Press Control Z to undo.`);
          closeColumnDialog();
        }}
      />
      <SettingsDialog open={dialog === 'settings'} onClose={closeDialog} settings={settings} onChange={store.updateSettings} />
      <HelpDialog open={dialog === 'help'} onClose={closeDialog} onChallenge={() => { setDialog(null); setBlindfold(true); }} onStory={() => { setDialog(null); onStory(); }} />
      <Blindfold
        open={blindfold}
        onClose={() => {
          setBlindfold(false);
          const u = new URL(window.location.href);
          if (u.searchParams.has('blindfold')) {
            u.searchParams.delete('blindfold');
            window.history.replaceState(null, '', u.pathname + u.search + u.hash);
          }
        }}
        store={store}
        onSimulate={simulateTeammates}
      />
      <ShareDialog open={dialog === 'share'} onClose={closeDialog} board={board} doc={store.doc} me={me} liveRoom={live?.room ?? null} labsLive={settings.labsLive}
        onStartLive={() => void startLive(newRoomCode())} onLeaveLive={leaveLive} onOpenSettings={() => setDialog('settings')} />
      <BoardsDialog
        labsCsv={settings.labsCsv}
        open={dialog === 'boards'}
        onClose={closeDialog}
        board={board}
        boards={store.boards}
        today={today}
        onSwitch={(id) => { store.switchBoard(id); setDialog(null); announce(`Opened “${store.boards.find((b) => b.id === id)?.title}”.`); focusLater('command-input'); }}
        onCreate={(b) => { store.createBoard(b); setDialog(null); announce(`Created “${b.title}” with To do, Doing and Done.`); focusLater('command-input'); }}
        onDelete={(id) => { store.deleteBoard(id); setDialog(null); announce('Board deleted.'); focusLater('command-input'); }}
        onImported={importBoard}
        onTrelloFollow={followTrello}
        onTrelloSync={() => syncTrello(true)}
        onTeammateDemo={simulateTeammates}
        onRename={(title) => {
          store.apply(renameBoard(board, title), 'rename the board');
          announce(`Board renamed to “${title}”.`);
        }}
        onResetDemo={() => { store.createBoard(demoBoard(today)); setDialog(null); announce('The sample board is back to its starting state.'); focusLater('command-input'); }}
      />
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addCard, addColumn, deleteCard, deleteColumn, locate, moveCard, moveColumn, peopleOn, renameBoard, renameColumn, updateCard,
} from './model/board';
import { parseCommand } from './model/commands';
import { cardDetails, positionText } from './model/describe';
import { executeCommand } from './model/execute';
import { findColumn, findPerson } from './model/match';
import { demoBoard, demoTeammateUpdate } from './model/seed';
import { boardFromHash } from './model/share';
import type { Board } from './model/types';
import { useHandrail, type Handrail } from './store/useHandrail';
import { AnnouncerProvider, useAnnounce } from './components/Announcer';
import { BoardView } from './components/BoardView';
import { CommandBar } from './components/CommandBar';
import { ChangesPanel } from './components/ChangesPanel';
import { CardActionsDialog, CardEditorDialog, ColumnDialog, type EditorValue } from './components/CardDialogs';
import { BoardsDialog, HelpDialog, SettingsDialog, ShareDialog } from './components/AppDialogs';

type DialogName = 'settings' | 'help' | 'share' | 'boards' | null;

export default function App() {
  const store = useHandrail();
  return (
    <AnnouncerProvider speakAloud={store.settings.speak} rate={store.settings.speechRate}>
      <Shell store={store} />
    </AnnouncerProvider>
  );
}

function useToday(): Date {
  const [day, setDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const t = window.setInterval(() => setDay(new Date().toDateString()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return useMemo(() => new Date(day), [day]);
}

function Shell({ store }: { store: Handrail }) {
  const { announce } = useAnnounce();
  const today = useToday();
  const { board, me, settings } = store;

  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ cardId: string | null; columnId: string } | null>(null);
  const [columnDlg, setColumnDlg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [renaming, setRenaming] = useState(false);
  const [boardTitle, setBoardTitle] = useState(board.title);
  const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const justOpened = useRef<string | null>(null);

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
    document.title = `${board.title} · Handrail`;
    setBoardTitle(board.title);
  }, [board.title]);

  // ---- Opening a shared link ------------------------------------------------
  useEffect(() => {
    const open = () => {
      const shared = boardFromHash(window.location.hash);
      if (!window.location.hash.startsWith('#board=')) return;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      if (!shared) {
        announce('That share link is broken or incomplete. Ask your teammate to copy it again.');
        return;
      }
      justOpened.current = shared.title;
      store.loadShared(shared);
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
      announce(`Opened the shared “${title}”. ${n} ${n === 1 ? 'change' : 'changes'} since you last looked${forYou ? `, ${forYou} for you` : ''}. The list is next.`);
      focusLater('changes');
    } else {
      announce(`Opened the shared “${title}”. Nothing new since you last looked.`);
    }
  }, [store.changes, focusLater, announce]);

  // ---- Undo / redo -----------------------------------------------------------
  const undo = useCallback(() => {
    if (!store.canUndo) return announce('Nothing to undo.');
    announce(`Undid: ${store.undoLabel}.`);
    store.undo();
  }, [store, announce]);
  const redo = useCallback(() => {
    if (!store.canRedo) return announce('Nothing to redo.');
    announce(`Redid: ${store.redoLabel}.`);
    store.redo();
  }, [store, announce]);

  // ---- Global shortcuts --------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, select, [contenteditable="true"]');
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
    window.requestAnimationFrame(() => (el && document.contains(el) ? el : document.getElementById('command-input'))?.focus());
  }

  // ---- Commands ----------------------------------------------------------
  function runCommand(text: string): boolean {
    const cmd = parseCommand(text, {
      today,
      isColumn: (t) => !!findColumn(board, t).match,
      isPerson: (t) => !!findPerson(peopleOn(board), t, me),
    });
    const r = executeCommand(cmd, board, { today, me });
    if (r.effect === 'undo') undo();
    else if (r.effect === 'redo') redo();
    else if (r.effect === 'help') { openDialog('help'); announce('Opened help.'); }
    else if (r.effect === 'changes') {
      if (store.changes.length === 0) announce('Nothing has changed since you last looked.');
      else { announce(readChanges()); }
    }
    if (r.board) store.apply(r.board, r.label ?? 'change');
    if (r.message) announce(r.message);
    if (r.focusCardId) {
      setFocusedCardId(r.focusCardId);
      setHighlightId(r.focusCardId);
    }
    return r.ok;
  }

  function readChanges() {
    const n = store.changes.length;
    return `${n} ${n === 1 ? 'change' : 'changes'} since you last looked. ${store.changes.map((c) => (c.forYou ? `For you: ${c.text}` : c.text)).join(' ')}`;
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
    const fresh = demoBoard(today);
    store.createBoard(fresh);
    justOpened.current = fresh.title;
    store.loadShared(demoTeammateUpdate(fresh, today));
    setDialog(null);
  }

  function importBoard(b: Board, source: string) {
    store.createBoard(b);
    setDialog(null);
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

  return (
    <>
      <a className="skip-link" href="#command-input">Skip to the command box</a>
      <a className="skip-link" href="#board" onClick={(e) => { e.preventDefault(); focusCardLater(focusedCardId ?? board.columns.flatMap((c) => c.cardIds)[0]); }}>
        Skip to the board
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28"><rect x="3" y="5" width="7" height="22" rx="2" /><rect x="12.5" y="5" width="7" height="14" rx="2" /><rect x="22" y="5" width="7" height="18" rx="2" /><path d="M2 28.5h28" strokeWidth="2.4" strokeLinecap="round" /></svg>
          </span>
          <span className="brand-name">Handrail</span>
        </div>
        <nav aria-label="Board tools" className="toolbar">
          <button type="button" className="btn btn-quiet" onClick={undo} disabled={!store.canUndo} title={store.undoLabel ? `Undo: ${store.undoLabel}` : 'Nothing to undo'}>
            <span aria-hidden="true">↶</span> Undo
          </button>
          <button type="button" className="btn btn-quiet" onClick={redo} disabled={!store.canRedo} title={store.redoLabel ? `Redo: ${store.redoLabel}` : 'Nothing to redo'}>
            <span aria-hidden="true">↷</span> Redo
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('share')}>Share</button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('boards')}>Boards &amp; files</button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('settings')}>Settings</button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('help')}>Help</button>
        </nav>
      </header>

      <main id="main">
        <div className="board-head">
          {renaming ? (
            <form className="rename-form" onSubmit={(e) => {
              e.preventDefault();
              store.apply(renameBoard(board, boardTitle), 'rename the board');
              setRenaming(false);
              announce(`Board renamed to “${boardTitle.trim()}”.`);
              focusLater('rename-board');
            }}>
              <label htmlFor="board-title-input" className="sr-only">Board name</label>
              <input id="board-title-input" value={boardTitle} onChange={(e) => setBoardTitle(e.target.value)} maxLength={200} autoFocus
                onKeyDown={(e) => { if (e.key === 'Escape') { setRenaming(false); setBoardTitle(board.title); focusLater('rename-board'); } }} />
              <button type="submit" className="btn btn-primary">Save</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setRenaming(false); setBoardTitle(board.title); focusLater('rename-board'); }}>Cancel</button>
            </form>
          ) : (
            <>
              <h1>{board.title}</h1>
              <button type="button" id="rename-board" className="btn btn-quiet small" onClick={() => setRenaming(true)}>
                Rename<span className="sr-only"> board</span>
              </button>
            </>
          )}
          <p className="viewer">
            {me ? <>Signed in on this device as <strong>{me}</strong>.</> : <>No name set.</>}{' '}
            <button type="button" className="btn btn-quiet small" onClick={() => openDialog('settings')}>{me ? 'Change' : 'Set your name'}</button>
            <span className="sep" aria-hidden="true">·</span>
            {board.columns.length} columns, {cardCount} {cardCount === 1 ? 'card' : 'cards'}
          </p>
        </div>

        <CommandBar onRun={runCommand} />

        <ChangesPanel
          changes={store.changes}
          board={board}
          onGoTo={(id) => { focusCardLater(id); setHighlightId(id); }}
          onReadAll={() => announce(readChanges())}
          onDone={() => {
            store.markSeen();
            announce('Marked as seen.');
            focusCardLater(focusedCardId ?? board.columns.flatMap((c) => c.cardIds)[0]);
          }}
        />

        <div className={`board-wrap layout-${settings.layout}`}>
          <BoardView
            board={board}
            today={today}
            me={me}
            focusedCardId={focusedCardId}
            setFocusedCardId={setFocusedCardId}
            highlightId={highlightId}
            cb={cb}
          />
        </div>
      </main>

      <footer className="footer">
        <p>
          Handrail keeps your boards on this device. No account, no tracking. <a href="https://github.com/Dakshhhhh-ops/Handrail">Source code</a>
        </p>
      </footer>

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
      <HelpDialog open={dialog === 'help'} onClose={closeDialog} />
      <ShareDialog open={dialog === 'share'} onClose={closeDialog} board={board} me={me} onOpenSettings={() => setDialog('settings')} />
      <BoardsDialog
        open={dialog === 'boards'}
        onClose={closeDialog}
        board={board}
        boards={store.boards}
        today={today}
        onSwitch={(id) => { store.switchBoard(id); setDialog(null); announce(`Opened “${store.boards.find((b) => b.id === id)?.title}”.`); focusLater('command-input'); }}
        onCreate={(b) => { store.createBoard(b); setDialog(null); announce(`Created “${b.title}” with To do, Doing and Done.`); focusLater('command-input'); }}
        onDelete={(id) => { store.deleteBoard(id); setDialog(null); announce('Board deleted.'); focusLater('command-input'); }}
        onImported={importBoard}
        onTeammateDemo={simulateTeammates}
        onResetDemo={() => { store.createBoard(demoBoard(today)); setDialog(null); announce('The sample board is back to its starting state.'); focusLater('command-input'); }}
      />
    </>
  );
}

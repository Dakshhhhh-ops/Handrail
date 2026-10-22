import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { locate, moveCard } from '../model/board';
import { describeDue } from '../model/dates';
import { cardLabel, positionText, sameName } from '../model/describe';
import type { Board, Card } from '../model/types';
import { useAnnounce } from './Announcer';

export interface BoardCallbacks {
  apply: (b: Board, label: string) => void;
  replace: (b: Board) => void;
  commitFrom: (origin: Board, label: string) => void;
  openActions: (cardId: string) => void;
  openEditor: (cardId: string | null, columnId: string) => void;
  openColumn: (columnId: string) => void;
  addColumn: () => void;
  deleteCard: (cardId: string) => void;
  readCard: (cardId: string) => void;
}

interface Grab {
  cardId: string;
  origin: Board;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

/**
 * The card's accessible name is built from its own content: the visible title,
 * then hidden text with the full spoken details. The short visual badges are
 * hidden from screen readers so nothing is read twice.
 */
function CardFace({ board, card, today, me, grabbed }: { board: Board; card: Card; today: Date; me: string | null; grabbed: boolean }) {
  const due = card.due ? describeDue(card.due, today) : null;
  const isMe = sameName(card.assignee, me);
  const spoken = cardLabel(board, card.id, today, me).slice(card.title.length);
  return (
    <>
      <span className="card-title">
        {grabbed && <span className="sr-only">Picked up: </span>}
        {card.title}
        <span className="sr-only">{spoken}</span>
      </span>
      {(due || card.assignee || card.notes.trim()) && (
        <span className="card-meta" aria-hidden="true">
          {due && (
            <span className={`badge due-${due.status}`}>
              {due.status === 'overdue' && <span aria-hidden="true">⚠ </span>}
              {due.short}
            </span>
          )}
          {card.assignee && (
            <span className={`who${isMe ? ' who-me' : ''}`}>
              <span className="avatar" aria-hidden="true">{initials(card.assignee)}</span>
              {isMe ? 'You' : card.assignee}
            </span>
          )}
          {card.notes.trim() && <span className="has-notes">Notes</span>}
        </span>
      )}
    </>
  );
}

export function BoardView({
  board,
  today,
  me,
  focusedCardId,
  setFocusedCardId,
  highlightId,
  cb,
  visible,
  layout = 'columns',
}: {
  layout?: 'columns' | 'stacked';
  /** When set, only cards that pass are shown (the "Just mine" filter). Hidden cards are never lost. */
  visible?: (cardId: string) => boolean;
  board: Board;
  today: Date;
  me: string | null;
  focusedCardId: string | null;
  setFocusedCardId: (id: string | null) => void;
  highlightId: string | null;
  cb: BoardCallbacks;
}) {
  const { announce } = useAnnounce();
  const [grab, setGrab] = useState<Grab | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [cardFocused, setCardFocused] = useState(false);

  const isShown = (id: string) => (visible ? visible(id) : true);
  const shownIn = (colIndex: number) => board.columns[colIndex].cardIds.filter(isShown);

  // Keep exactly one card in the tab order (roving tabindex).
  const allIds = board.columns.flatMap((c) => c.cardIds).filter(isShown);
  const tabStop = focusedCardId && allIds.includes(focusedCardId) ? focusedCardId : allIds[0] ?? null;

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = document.getElementById(`card-${pendingFocus.current}`);
    pendingFocus.current = null;
    el?.focus();
  });

  const focusCard = (id: string) => {
    setFocusedCardId(id);
    pendingFocus.current = id;
    document.getElementById(`card-${id}`)?.focus();
  };

  // Leaving the board while holding a card drops it where it is.
  useEffect(() => {
    if (!grab) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest('[data-card]')) drop();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  });

  function drop() {
    if (!grab) return;
    const card = board.cards[grab.cardId];
    const before = locate(grab.origin, grab.cardId);
    const after = locate(board, grab.cardId);
    setGrab(null);
    if (!before || !after || (before.column.id === after.column.id && before.index === after.index)) {
      announce(`Dropped ${card.title}. It didn’t move.`);
      return;
    }
    cb.commitFrom(grab.origin, `move “${card.title}”`);
    announce(`Dropped ${card.title} in ${positionText(board, grab.cardId)}.`);
  }

  function cancelGrab() {
    if (!grab) return;
    cb.replace(grab.origin);
    const loc = locate(grab.origin, grab.cardId);
    setGrab(null);
    pendingFocus.current = grab.cardId;
    announce(`Cancelled. ${grab.origin.cards[grab.cardId].title} is back in ${loc?.column.title}, position ${(loc?.index ?? 0) + 1}.`);
  }

  function moveBy(cardId: string, dCol: number, dRow: number, committing: boolean) {
    const loc = locate(board, cardId);
    if (!loc) return;
    const ci = loc.columnIndex + dCol;
    if (ci < 0 || ci >= board.columns.length) {
      announce(dCol < 0 ? 'Already in the first column.' : 'Already in the last column.');
      return;
    }
    const target = board.columns[ci];
    // Work in the cards the user can see, then translate to a position in the full column.
    const here = shownIn(loc.columnIndex);
    const vi = here.indexOf(cardId);
    const rest = target.cardIds.filter((id) => id !== cardId);
    let index: number;
    if (dCol === 0) {
      const neighbour = here[vi + dRow];
      if (!neighbour) {
        announce(dRow < 0 ? `Already at the top of ${target.title}.` : `Already at the bottom of ${target.title}.`);
        return;
      }
      index = rest.indexOf(neighbour) + (dRow > 0 ? 1 : 0);
    } else {
      const there = shownIn(ci);
      index = vi < there.length ? rest.indexOf(there[vi]) : rest.length;
    }
    const next = moveCard(board, cardId, target.id, index, me);
    pendingFocus.current = cardId;
    if (committing) cb.apply(next, `move “${board.cards[cardId].title}”`);
    else cb.replace(next);
    announce(`${dCol === 0 ? (dRow < 0 ? 'Up' : 'Down') : `Moved to ${target.title}`}. ${positionText(next, cardId)}.`);
  }

  function sendToColumn(cardId: string, colIndex: number) {
    const target = board.columns[colIndex];
    const loc = locate(board, cardId);
    if (!target || !loc) {
      announce(`There is no column ${colIndex + 1}. This board has ${board.columns.length}.`);
      return;
    }
    if (loc.column.id === target.id) {
      announce(`Already in ${target.title}.`);
      return;
    }
    const next = moveCard(board, cardId, target.id, target.cardIds.length, me);
    pendingFocus.current = cardId;
    cb.apply(next, `move “${board.cards[cardId].title}” to ${target.title}`);
    announce(`Moved to ${target.title}. ${positionText(next, cardId)}.`);
  }

  function focusNeighbour(cardId: string, dCol: number, dRow: number) {
    const loc = locate(board, cardId);
    if (!loc) return;
    if (dCol === 0) {
      const here = shownIn(loc.columnIndex);
      const id = here[here.indexOf(cardId) + dRow];
      if (id) focusCard(id);
      else announce(dRow < 0 ? `Top of ${loc.column.title}.` : `Bottom of ${loc.column.title}.`);
      return;
    }
    const skipped: string[] = [];
    const vi = shownIn(loc.columnIndex).indexOf(cardId);
    for (let ci = loc.columnIndex + dCol; ci >= 0 && ci < board.columns.length; ci += dCol) {
      const col = board.columns[ci];
      const ids = shownIn(ci);
      if (ids.length) {
        if (skipped.length) announce(`${skipped.join(' and ')} ${skipped.length > 1 ? 'are' : 'is'} empty.`);
        focusCard(ids[Math.min(vi, ids.length - 1)]);
        return;
      }
      skipped.push(col.title);
    }
    announce(`${skipped.length ? `${skipped.join(' and ')} ${skipped.length > 1 ? 'are' : 'is'} empty. ` : ''}No more cards to the ${dCol < 0 ? 'left' : 'right'}.`);
  }

  function onCardKey(e: KeyboardEvent<HTMLButtonElement>, cardId: string) {
    const card = board.cards[cardId];
    const loc = locate(board, cardId);
    if (!card || !loc) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (grab?.cardId === cardId) {
      const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (dirs[e.key]) {
        handled();
        moveBy(cardId, dirs[e.key][0], dirs[e.key][1], false);
      } else if (e.key === 'Enter' || e.key === ' ') {
        handled();
        drop();
      } else if (e.key === 'Escape') {
        handled();
        cancelGrab();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        handled();
        const dCol = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dRow = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (e.altKey || e.shiftKey) moveBy(cardId, dCol, dRow, true);
        else focusNeighbour(cardId, dCol, dRow);
        return;
      }
      case 'Home':
        handled();
        focusCard(shownIn(loc.columnIndex)[0]);
        return;
      case 'End': {
        handled();
        const ids = shownIn(loc.columnIndex);
        focusCard(ids[ids.length - 1]);
        return;
      }
      case ' ':
        handled();
        setGrab({ cardId, origin: board });
        announce(`Picked up ${card.title}. ${positionText(board, cardId)}. Arrow keys move it, Enter drops it, Escape puts it back.`);
        return;
      case 'Enter':
      case 'm':
      case 'M':
        handled();
        cb.openActions(cardId);
        return;
      case 'e':
      case 'E':
      case 'F2':
        handled();
        cb.openEditor(cardId, loc.column.id);
        return;
      case 'i':
      case 'I':
        handled();
        cb.readCard(cardId);
        return;
      case 'n':
      case 'N':
        handled();
        cb.openEditor(null, loc.column.id);
        return;
      case 'Delete':
      case 'Backspace':
        handled();
        cb.deleteCard(cardId);
        return;
      default:
        if (/^[1-9]$/.test(e.key) && !e.altKey) {
          handled();
          sendToColumn(cardId, Number(e.key) - 1);
        }
    }
  }

  // ---- Mouse drag and drop, for teammates who prefer it -------------------
  function onDragStart(e: DragEvent, cardId: string) {
    e.dataTransfer.setData('text/plain', cardId);
    e.dataTransfer.effectAllowed = 'move';
    setDragId(cardId);
  }
  function dropAt(columnId: string, index: number) {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id || !board.cards[id]) return;
    const from = locate(board, id)!;
    const target = board.columns.find((c) => c.id === columnId)!;
    let i = index;
    if (from.column.id === columnId && from.index < index) i -= 1;
    if (from.column.id === columnId && from.index === i) return;
    const next = moveCard(board, id, columnId, i, me);
    cb.apply(next, `move “${board.cards[id].title}”`);
    setFocusedCardId(id);
    announce(`Moved ${board.cards[id].title} to ${target.title}. ${positionText(next, id)}.`);
  }
  function overCard(e: DragEvent<HTMLLIElement>, columnId: string, index: number) {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropTarget(`${columnId}:${index + (after ? 1 : 0)}`);
  }

  return (
    <>
    <div className={`board-wrap layout-${layout}`}>
    <div
      id="board"
      className={`board${grab ? ' is-grabbing' : ''}`}
      aria-label={`${board.title} board`}
      role="region"
      tabIndex={-1}
    >
      <p id="card-hint" className="sr-only">
        Enter for actions. Space to pick up and move. Number keys send to a column. E to edit, I for details.
      </p>
      {board.columns.map((col, ci) => {
        const headingId = `col-${col.id}-h`;
        const ids = shownIn(ci);
        const filtered = ids.length !== col.cardIds.length;
        return (
          <section key={col.id} className="column" aria-labelledby={headingId} data-testid={`column-${col.title}`}>
            <div className="column-head">
              <h2 id={headingId}>
                <span className="col-num" aria-hidden="true">{ci + 1}</span>
                {col.title}
                <span className="count">
                  <span className="sr-only">, </span>
                  {filtered ? `${ids.length} of ${col.cardIds.length}` : col.cardIds.length}
                  <span className="sr-only"> {col.cardIds.length === 1 ? 'card' : 'cards'}{filtered ? ' shown' : ''}</span>
                </span>
              </h2>
              <button type="button" className="btn btn-quiet icon-only" onClick={() => cb.openColumn(col.id)} aria-label={`Options for column ${col.title}`}>
                <span aria-hidden="true">⋯</span>
              </button>
            </div>
            <ol
              className={`cards${dropTarget === `${col.id}:${col.cardIds.length}` ? ' drop-end' : ''}`}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropTarget(`${col.id}:${col.cardIds.length}`);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropAt(col.id, col.cardIds.length);
              }}
            >
              {ids.length === 0 && (
                <li className="empty" aria-hidden={dragId ? undefined : true}>
                  {dragId ? 'Drop here' : filtered ? 'None of yours here' : 'No cards yet'}
                </li>
              )}
              {ids.map((id) => {
                const i = col.cardIds.indexOf(id);
                const card = board.cards[id];
                const grabbed = grab?.cardId === id;
                const cls = [
                  'card',
                  grabbed && 'is-grabbed',
                  dragId === id && 'is-dragging',
                  highlightId === id && 'is-highlight',
                  dropTarget === `${col.id}:${i}` && 'drop-before',
                ].filter(Boolean).join(' ');
                return (
                  <li
                    key={id}
                    className="card-item"
                    onDragOver={(e) => overCard(e, col.id, i)}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const [, idx] = (dropTarget ?? `:${i}`).split(':');
                      dropAt(col.id, Number(idx));
                    }}
                  >
                    <button
                      type="button"
                      id={`card-${id}`}
                      data-card={id}
                      className={cls}
                      tabIndex={id === tabStop ? 0 : -1}
                      aria-describedby="card-hint"
                      onFocus={() => { setFocusedCardId(id); setCardFocused(true); }}
                      onBlur={() => setCardFocused(false)}
                      onClick={() => (grabbed ? drop() : cb.openActions(id))}
                      onKeyDown={(e) => onCardKey(e, id)}
                      draggable
                      onDragStart={(e) => onDragStart(e, id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
                      }}
                    >
                      <CardFace board={board} card={card} today={today} me={me} grabbed={grabbed} />
                    </button>
                  </li>
                );
              })}
            </ol>
            <button type="button" className="btn btn-ghost add-card" onClick={() => cb.openEditor(null, col.id)}>
              <span aria-hidden="true">+</span> Add card<span className="sr-only"> to {col.title}</span>
            </button>
          </section>
        );
      })}
      <div className="column column-add">
        <button type="button" className="btn btn-ghost" onClick={cb.addColumn}>
          <span aria-hidden="true">+</span> Add column
        </button>
      </div>
    </div>
    </div>
    {/* Shortcuts for sighted keyboard users. Screen readers get the same text from #card-hint. */}
    <div className={`shortcut-strip${grab ? ' is-grabbing' : ''}`} aria-hidden="true" hidden={!cardFocused && !grab} data-testid="shortcut-strip">
      {grab ? (
        <>
          <span><kbd>Arrows</kbd> move</span>
          <span><kbd>Enter</kbd> drop</span>
          <span><kbd>Esc</kbd> cancel</span>
        </>
      ) : (
        <>
          <span><kbd>Enter</kbd> actions</span>
          <span><kbd>Space</kbd> move</span>
          <span><kbd>1–9</kbd> send to column</span>
          <span><kbd>E</kbd> edit</span>
          <span><kbd>I</kbd> details</span>
          <span><kbd>?</kbd> help</span>
        </>
      )}
    </div>
    </>
  );
}

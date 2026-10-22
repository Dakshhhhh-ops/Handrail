import { useEffect, useState, type FormEvent } from 'react';
import { locate, peopleOn } from '../model/board';
import { parseDue } from '../model/dates';
import { cardDetails } from '../model/describe';
import type { Board } from '../model/types';
import { Modal } from './Modal';

export function CardActionsDialog({
  board, cardId, today, me, onClose, onMove, onNudge, onEdit, onDelete, onRead,
}: {
  board: Board;
  cardId: string | null;
  today: Date;
  me: string | null;
  onClose: () => void;
  onMove: (cardId: string, columnId: string, position: 'top' | 'bottom') => void;
  onNudge: (cardId: string, delta: number) => void;
  onEdit: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  onRead: (cardId: string) => void;
}) {
  const card = cardId ? board.cards[cardId] : null;
  const loc = cardId ? locate(board, cardId) : null;
  const open = !!card && !!loc;
  const details = card ? cardDetails(card, today, me) : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={card?.title ?? 'Card'}
      description={loc ? `In ${loc.column.title}, ${loc.index + 1} of ${loc.column.cardIds.length}.${details ? ` ${details[0].toUpperCase()}${details.slice(1)}.` : ''}` : undefined}
      testId="card-actions"
    >
      {card && loc && (
        <div className="action-groups">
          <div role="group" aria-labelledby="move-to-label" className="action-group">
            <h3 id="move-to-label">Move to</h3>
            <div className="action-list">
              {board.columns.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-secondary"
                  disabled={c.id === loc.column.id}
                  data-autofocus={i === (loc.columnIndex + 1) % board.columns.length ? true : undefined}
                  onClick={() => onMove(card.id, c.id, 'bottom')}
                >
                  <span className="key-hint" aria-hidden="true">{i + 1}</span> {c.title}
                  {c.id === loc.column.id && <span className="sr-only"> (current column)</span>}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-labelledby="order-label" className="action-group">
            <h3 id="order-label">Order in {loc.column.title}</h3>
            <div className="action-list">
              <button type="button" className="btn btn-secondary" disabled={loc.index === 0} onClick={() => onMove(card.id, loc.column.id, 'top')}>Move to top</button>
              <button type="button" className="btn btn-secondary" disabled={loc.index === 0} onClick={() => onNudge(card.id, -1)}>Move up one</button>
              <button type="button" className="btn btn-secondary" disabled={loc.index === loc.column.cardIds.length - 1} onClick={() => onNudge(card.id, 1)}>Move down one</button>
            </div>
          </div>
          <div role="group" aria-labelledby="card-label" className="action-group">
            <h3 id="card-label">Card</h3>
            <div className="action-list">
              <button type="button" className="btn btn-secondary" onClick={() => onEdit(card.id)}>Edit details</button>
              <button type="button" className="btn btn-secondary" onClick={() => onRead(card.id)}>Read aloud</button>
              <button type="button" className="btn btn-danger" onClick={() => onDelete(card.id)}>Delete</button>
            </div>
          </div>
          {card.notes.trim() && (
            <div className="notes-preview">
              <h3>Notes</h3>
              <p>{card.notes}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export interface EditorValue {
  title: string;
  notes: string;
  due: string | null;
  assignee: string | null;
  columnId: string;
}

export function CardEditorDialog({
  board, state, today, me, onClose, onSave, onDelete,
}: {
  board: Board;
  state: { cardId: string | null; columnId: string } | null;
  today: Date;
  me: string | null;
  onClose: () => void;
  onSave: (cardId: string | null, value: EditorValue) => void;
  onDelete: (cardId: string) => void;
}) {
  const card = state?.cardId ? board.cards[state.cardId] : null;
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [due, setDue] = useState('');
  const [dueWords, setDueWords] = useState('');
  const [assignee, setAssignee] = useState('');
  const [columnId, setColumnId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!state) return;
    setTitle(card?.title ?? '');
    setNotes(card?.notes ?? '');
    setDue(card?.due ?? '');
    setDueWords('');
    setAssignee(card?.assignee ?? '');
    setColumnId(state.cardId ? locate(board, state.cardId)?.column.id ?? state.columnId : state.columnId);
    setError('');
    // Only reset when the dialog opens for a different card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.cardId, state?.columnId, !!state]);

  const people = [...new Set([...(me ? [me] : []), ...peopleOn(board)])];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give the card a title.');
      document.getElementById('ed-title')?.focus();
      return;
    }
    let finalDue: string | null = due || null;
    if (dueWords.trim()) {
      const parsed = parseDue(dueWords, today);
      if (!parsed) {
        setError(`I couldn't understand the date “${dueWords}”. Try “friday”, “in 3 days” or “oct 30”.`);
        document.getElementById('ed-due-words')?.focus();
        return;
      }
      finalDue = parsed;
    }
    onSave(state!.cardId, { title: title.trim(), notes, due: finalDue, assignee: assignee.trim() || null, columnId });
  }

  return (
    <Modal open={!!state} onClose={onClose} title={card ? 'Edit card' : 'New card'} testId="card-editor">
      <form onSubmit={submit} className="form" noValidate>
        {error && (
          <p className="form-error" role="alert" id="ed-error">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="ed-title">Title</label>
          <input id="ed-title" value={title} onChange={(e) => setTitle(e.target.value)} required data-autofocus maxLength={200} aria-invalid={error && !title.trim() ? true : undefined} aria-describedby={error ? 'ed-error' : undefined} />
        </div>
        <div className="field">
          <label htmlFor="ed-col">Column</label>
          <select id="ed-col" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
        <fieldset className="field">
          <legend>Due date</legend>
          <div className="field-row">
            <div className="field">
              <label htmlFor="ed-due">Pick a date</label>
              <input id="ed-due" type="date" value={due} onChange={(e) => { setDue(e.target.value); setDueWords(''); }} />
            </div>
            <div className="field">
              <label htmlFor="ed-due-words">or type it</label>
              <input id="ed-due-words" value={dueWords} onChange={(e) => setDueWords(e.target.value)} placeholder="friday, in 3 days, oct 30" aria-describedby="ed-due-preview" />
            </div>
          </div>
          <p id="ed-due-preview" className="hint" aria-live="polite">
            {dueWords.trim() ? (parseDue(dueWords, today) ? `That’s ${parseDue(dueWords, today)}.` : 'Not a date I know yet.') : ''}
          </p>
          {(due || dueWords) && (
            <button type="button" className="btn btn-quiet" onClick={() => { setDue(''); setDueWords(''); }}>Clear due date</button>
          )}
        </fieldset>
        <div className="field">
          <label htmlFor="ed-who">Assigned to</label>
          <input id="ed-who" value={assignee} onChange={(e) => setAssignee(e.target.value)} list="people-list" maxLength={60} placeholder="Nobody yet" />
          <datalist id="people-list">
            {people.map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="ed-notes">Notes</label>
          <textarea id="ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={5000} />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">{card ? 'Save changes' : 'Add card'}</button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {card && (
            <button type="button" className="btn btn-danger push-right" onClick={() => onDelete(card.id)}>Delete card</button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function ColumnDialog({
  board, columnId, onClose, onRename, onMove, onDelete, onAdd,
}: {
  board: Board;
  /** A column id, "new" to add one, or null when closed. */
  columnId: string | null;
  onClose: () => void;
  onRename: (columnId: string, title: string) => void;
  onMove: (columnId: string, delta: number) => void;
  onDelete: (columnId: string) => void;
  onAdd: (title: string) => void;
}) {
  const isNew = columnId === 'new';
  const ci = board.columns.findIndex((c) => c.id === columnId);
  const col = ci >= 0 ? board.columns[ci] : null;
  const [title, setTitle] = useState('');
  useEffect(() => setTitle(col?.title ?? ''), [columnId]); // eslint-disable-line react-hooks/exhaustive-deps

  const neighbour = ci > 0 ? board.columns[ci - 1] : board.columns[1];

  return (
    <Modal open={isNew || !!col} onClose={onClose} title={isNew ? 'Add a column' : `Column: ${col?.title ?? ''}`} testId="column-dialog">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          if (isNew) onAdd(title);
          else if (col) onRename(col.id, title);
        }}
      >
        <div className="field">
          <label htmlFor="col-title">{isNew ? 'Column name' : 'Rename column'}</label>
          <input id="col-title" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus maxLength={200} required />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">{isNew ? 'Add column' : 'Save name'}</button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
      {col && (
        <div className="action-groups">
          <div role="group" aria-label="Column position" className="action-list">
            <button type="button" className="btn btn-secondary" disabled={ci === 0} onClick={() => onMove(col.id, -1)}>Move column left</button>
            <button type="button" className="btn btn-secondary" disabled={ci === board.columns.length - 1} onClick={() => onMove(col.id, 1)}>Move column right</button>
          </div>
          {board.columns.length > 1 && (
            <div className="danger-zone">
              <button type="button" className="btn btn-danger" onClick={() => onDelete(col.id)}>Delete column</button>
              <p className="hint">
                {col.cardIds.length
                  ? `Its ${col.cardIds.length} card${col.cardIds.length === 1 ? '' : 's'} will move to ${neighbour?.title}. You can undo this.`
                  : 'It has no cards. You can undo this.'}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

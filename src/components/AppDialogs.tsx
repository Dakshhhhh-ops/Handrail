import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createBoard } from '../model/board';
import { exportCsv, exportJson, exportMarkdown, importCsv, importHandrailJson, importTrello, trelloAuthors } from '../model/importers';
import { shareUrl } from '../model/share';
import type { Board } from '../model/types';
import type { Doc } from '../model/crdt';
import { speak } from '../lib/speech';
import type { Settings } from '../store/useHandrail';
import { Modal } from './Modal';

// ---- Settings ---------------------------------------------------------------

function Radios<T extends string>({ legend, name, value, options, onChange }: {
  legend: string; name: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <fieldset className="field radios">
      <legend>{legend}</legend>
      {options.map(([v, label]) => (
        <label key={v} className="radio">
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

export function SettingsDialog({ open, onClose, settings, onChange }: {
  open: boolean; onClose: () => void; settings: Settings; onChange: (p: Partial<Settings>) => void;
}) {
  const [name, setName] = useState(settings.name);
  useEffect(() => setName(settings.name), [open, settings.name]);
  return (
    <Modal open={open} onClose={onClose} title="Settings" description="Changes apply straight away and are saved on this device." wide testId="settings">
      <div className="settings-grid">
        <div className="field">
          <label htmlFor="set-name">Your name</label>
          <input
            id="set-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onChange({ name: name.trim() })}
            onKeyDown={(e) => { if (e.key === 'Enter') onChange({ name: name.trim() }); }}
            aria-describedby="set-name-hint"
            data-autofocus
          />
          <p id="set-name-hint" className="hint">Used to find “my tasks” and to tell teammates who changed what. Use the same name your group uses.</p>
        </div>
        <Radios legend="Colours" name="theme" value={settings.theme} onChange={(theme) => onChange({ theme })}
          options={[['dark', 'Studio (deep indigo)'], ['light', 'Paper (cream)'], ['system', 'Match my device'], ['contrast', 'High contrast']]} />
        <div className="field">
          <label htmlFor="set-size">Text size</label>
          <select id="set-size" value={settings.textSize} onChange={(e) => onChange({ textSize: Number(e.target.value) })}>
            {[100, 125, 150, 175, 200].map((s) => <option key={s} value={s}>{s}%</option>)}
          </select>
        </div>
        <Radios legend="Font" name="font" value={settings.font} onChange={(font) => onChange({ font })}
          options={[['atkinson', 'Atkinson Hyperlegible (easy to tell letters apart)'], ['opendyslexic', 'OpenDyslexic'], ['system', 'My device’s font']]} />
        <Radios legend="Spacing" name="spacing" value={settings.spacing} onChange={(spacing) => onChange({ spacing })}
          options={[['normal', 'Normal'], ['relaxed', 'Relaxed (more space between lines and letters)']]} />
        <Radios legend="Layout" name="layout" value={settings.layout} onChange={(layout) => onChange({ layout })}
          options={[['columns', 'Columns side by side'], ['stacked', 'Columns stacked (best with screen magnifiers)']]} />
        <fieldset className="field">
          <legend>Speech</legend>
          <label className="check">
            <input type="checkbox" checked={settings.speak} onChange={(e) => onChange({ speak: e.target.checked })} />
            Read Handrail’s replies aloud (for people not using a screen reader)
          </label>
          <div className="field">
            <label htmlFor="set-rate">Speaking speed</label>
            <select id="set-rate" value={settings.speechRate} onChange={(e) => onChange({ speechRate: Number(e.target.value) })}>
              {[0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => speak('This is how Handrail sounds.', settings.speechRate)}>Test the voice</button>
        </fieldset>
        <fieldset className="field">
          <legend>Notifications</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.notify}
              onChange={async (e) => {
                const on = e.target.checked;
                if (on && 'Notification' in window && Notification.permission === 'default') {
                  const p = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
                  onChange({ notify: p === 'granted' });
                } else onChange({ notify: on && 'Notification' in window && Notification.permission === 'granted' });
              }}
            />
            Notify me about teammates’ live changes when Handrail is in the background
          </label>
        </fieldset>
        <fieldset className="field">
          <legend>Motion</legend>
          <label className="check">
            <input type="checkbox" checked={settings.reduceMotion} onChange={(e) => onChange({ reduceMotion: e.target.checked })} />
            Turn off animations
          </label>
        </fieldset>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => { onChange({ name: name.trim() }); onClose(); }}>Done</button>
      </div>
    </Modal>
  );
}

// ---- Help -------------------------------------------------------------------

const KEYS: [string, string][] = [
  ['Tab', 'Move between the command box, the board and the buttons'],
  ['Arrow keys', 'Move between cards (up and down in a column, left and right across columns)'],
  ['Enter', 'Open the card’s action menu'],
  ['Space', 'Pick up a card. Then arrows move it, Enter drops it, Escape puts it back'],
  ['1 to 9', 'Send the card to that column'],
  ['Alt + arrows', 'Move the card one step without picking it up'],
  ['E', 'Edit the card'],
  ['I', 'Read the card’s details and notes'],
  ['N', 'New card in this column'],
  ['Delete', 'Delete the card (you can undo)'],
  ['/', 'Jump to the command box'],
  ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
  ['?', 'Open this help'],
];

const SAYINGS: [string, string][] = [
  ['add book a study room due friday for Riya', 'New card with a date and an owner'],
  ['move lab report to doing', 'Move a card (part of the name is enough)'],
  ['outline is done · start the script', 'Move to Done or Doing'],
  ['move slides to the top · move slides up', 'Change the order'],
  ['slides due next monday', 'Set or change a due date'],
  ['assign email to me · unassign email', 'Change who owns a card'],
  ['note on slides: use the uni template', 'Add a note'],
  ['what changed · catch me up', 'Hear what teammates changed'],
  ['what’s due this week · anything overdue · my tasks', 'Ask questions'],
  ['what is Riya doing · who has the slides', 'Ask about people and cards'],
  ['read doing · summary', 'Hear a column or the whole board'],
  ['undo · redo', 'Take back the last change'],
];

export function HelpDialog({ open, onClose, onChallenge, onStory }: { open: boolean; onClose: () => void; onChallenge: () => void; onStory: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How to use Handrail" wide testId="help">
      <div className="help">
        <p className="help-intro">
          Handrail tells you what your teammates changed, so you never have to hunt for it. Everything else works by keyboard, by menu, or by typing or saying a sentence.
        </p>
        <div className="action-list">
          <button type="button" className="btn btn-primary" onClick={onChallenge}>Try it with your eyes closed</button>
          <button type="button" className="btn btn-secondary" onClick={onStory}>Watch the story</button>
        </div>
        <section aria-labelledby="h-say">
          <h3 id="h-say">Things you can type or say</h3>
          <table className="table">
            <thead><tr><th scope="col">Say</th><th scope="col">What happens</th></tr></thead>
            <tbody>{SAYINGS.map(([s, d]) => <tr key={s}><td><q>{s}</q></td><td>{d}</td></tr>)}</tbody>
          </table>
        </section>
        <section aria-labelledby="h-keys">
          <h3 id="h-keys">Keyboard, when a card has focus</h3>
          <table className="table">
            <thead><tr><th scope="col">Key</th><th scope="col">What it does</th></tr></thead>
            <tbody>{KEYS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody>
          </table>
          <p className="hint">
            Screen reader users: if single-letter keys are read out instead of working, your screen reader is in browse mode.
            Press Enter on a card for its menu, or use the command box, which always works.
          </p>
        </section>
        <section aria-labelledby="h-share">
          <h3 id="h-share">Working with your group</h3>
          <p>
            Handrail has no accounts and keeps your boards on this device. To work with others, press <strong>Share</strong> and send the link.
            When a teammate sends you their link back, open it: Handrail lists every change they made since you last looked, starting with the ones that involve you.
            In Activity, <strong>Show me on the board</strong> points at each changed card, and <strong>Before / now</strong> flips the board to how it looked before, so you can compare.
          </p>
          <p>
            Your group already uses Trello? Nobody has to switch. Export the board from Trello as JSON and import it under <strong>Boards &amp; files</strong>.
            Next time, import the newer export: Handrail lists what changed in Trello since your last import, and who did it.
          </p>
        </section>
      </div>
    </Modal>
  );
}

// ---- Share ------------------------------------------------------------------

export function ShareDialog({ open, onClose, board, doc, me, onOpenSettings, liveRoom, onStartLive, onLeaveLive }: {
  open: boolean; onClose: () => void; board: Board; doc: Doc; me: string | null; onOpenSettings: () => void;
  liveRoom: string | null; onStartLive: () => void; onLeaveLive: () => void;
}) {
  const [status, setStatus] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const liveField = useRef<HTMLTextAreaElement>(null);
  const url = open ? shareUrl(doc, window.location.href) : '';
  const liveUrl = open && liveRoom ? shareUrl(doc, window.location.href, liveRoom) : '';
  useEffect(() => setStatus(''), [open]);

  async function copy(text: string, el: HTMLTextAreaElement | null, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${what} copied. Paste it into your group chat.`);
    } catch {
      el?.select();
      setStatus('Couldn’t copy automatically. The link is selected: press Control C to copy it.');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this board" testId="share">
      <div className="form">
        <p>
          This link holds the whole board, so there is no account or server. Send it to your group. When a teammate sends their link back, Handrail
          merges it with your copy, so nobody's work is lost even if you both edited at once, and tells you exactly what changed.
        </p>
        {!me && (
          <p className="notice">
            Set your name first, so teammates see who made each change.{' '}
            <button type="button" className="btn btn-quiet" onClick={onOpenSettings}>Set my name</button>
          </p>
        )}
        <div className="field">
          <label htmlFor="share-url">Link to “{board.title}”</label>
          <textarea id="share-url" ref={field} readOnly value={url} rows={3} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={() => copy(url, field.current, 'Link')} data-autofocus>Copy link</button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
        <p role="status" className="hint">{status}</p>

        <section className="live-share" aria-labelledby="live-share-h">
          <h3 id="live-share-h">Work on it live</h3>
          {liveRoom ? (
            <>
              <p>
                Your live session is open. Teammates who open this invite link join it, and everyone sees each other’s changes as they happen.
                Handrail reads them out as they arrive.
              </p>
              <div className="field">
                <label htmlFor="live-url">Invite link</label>
                <textarea id="live-url" ref={liveField} readOnly value={liveUrl} rows={3} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-primary" onClick={() => copy(liveUrl, liveField.current, 'Invite link')}>Copy invite link</button>
                <button type="button" className="btn btn-secondary" onClick={onLeaveLive}>Leave live session</button>
              </div>
            </>
          ) : (
            <>
              <p>
                Prefer to see changes the moment they happen? Start a live session and send the invite link. Browsers connect to each other directly;
                Handrail has no server and keeps nothing.
              </p>
              <button type="button" className="btn btn-secondary" onClick={onStartLive}>Start a live session</button>
            </>
          )}
        </section>
        <p className="hint">Anyone with the link can read the board. Don’t put passwords or private information on a shared board.</p>
      </div>
    </Modal>
  );
}

// ---- Boards & files ---------------------------------------------------------

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';

export function BoardsDialog({
  open, onClose, board, boards, today, onSwitch, onCreate, onDelete, onImported, onTeammateDemo, onResetDemo, onRename,
}: {
  open: boolean;
  onClose: () => void;
  board: Board;
  boards: Board[];
  today: Date;
  onSwitch: (id: string) => void;
  onCreate: (b: Board) => void;
  onDelete: (id: string) => void;
  onImported: (b: Board, source: string, authors?: Record<string, string>) => void;
  onTeammateDemo: () => void;
  onResetDemo: () => void;
  onRename: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [rename, setRename] = useState(board.title);
  useEffect(() => setRename(board.title), [open, board.title]);
  const [status, setStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setStatus(''); setConfirmDelete(false); }, [open]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5_000_000) {
      setStatus('That file is too big (over 5 MB).');
      return;
    }
    const text = await file.text();
    let b: Board | null = null;
    let source = '';
    let authors: ReturnType<typeof trelloAuthors> | undefined;
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
      b = importCsv(text, file.name.replace(/\.csv$/i, ''));
      source = 'CSV file';
    } else {
      try {
        const json = JSON.parse(text);
        b = importTrello(json);
        source = 'Trello';
        if (b) authors = trelloAuthors(json);
        if (!b) {
          b = importHandrailJson(json);
          source = 'Handrail backup';
        }
      } catch {
        b = null;
      }
    }
    if (!b) {
      setStatus('I couldn’t read that file. Use a Trello JSON export, a Handrail backup, or a CSV with a Title column.');
      return;
    }
    onImported(b, source, authors);
  }

  return (
    <Modal open={open} onClose={onClose} title="Boards & files" wide testId="boards">
      <div className="boards-grid">
        <section aria-labelledby="b-yours">
          <form className="form inline-form" onSubmit={(e) => {
            e.preventDefault();
            if (rename.trim() && rename.trim() !== board.title) onRename(rename.trim());
          }}>
            <div className="field">
              <label htmlFor="rename-board">Name of this board</label>
              <input id="rename-board" value={rename} onChange={(e) => setRename(e.target.value)} maxLength={200} required data-autofocus />
            </div>
            <button type="submit" className="btn btn-secondary">Rename</button>
          </form>
          <h3 id="b-yours">Your boards</h3>
          <ul className="board-list">
            {boards.map((b) => (
              <li key={b.id}>
                <span>{b.title}{b.id === board.id && <span className="pill">open</span>}</span>
                {b.id !== board.id && (
                  <button type="button" className="btn btn-secondary small" onClick={() => onSwitch(b.id)}>
                    Open<span className="sr-only"> {b.title}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form className="form inline-form" onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            onCreate(createBoard(title.trim()));
            setTitle('');
          }}>
            <div className="field">
              <label htmlFor="new-board">New board name</label>
              <input id="new-board" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Chemistry lab report" />
            </div>
            <button type="submit" className="btn btn-primary">Create board</button>
          </form>
          <p className="hint">New boards start with To do, Doing and Done.</p>
        </section>

        <section aria-labelledby="b-import">
          <h3 id="b-import">Import</h3>
          <div className="field">
            <label htmlFor="import-file">Choose a Trello JSON export, a Handrail backup, or a CSV file</label>
            <input id="import-file" type="file" accept=".json,.csv,application/json,text/csv" onChange={onFile} />
          </div>
          <p className="hint">In Trello: open the board, then Menu → Print, export and share → Export as JSON. Import a newer export of the same board to hear what changed since last time.</p>
          <p role="status" className="hint">{status}</p>

          <h3>Export “{board.title}”</h3>
          <div className="action-list">
            <button type="button" className="btn btn-secondary" onClick={() => download(`${slug(board.title)}.handrail.json`, exportJson(board), 'application/json')}>Download backup</button>
            <button type="button" className="btn btn-secondary" onClick={() => download(`${slug(board.title)}.csv`, exportCsv(board), 'text/csv')}>Download CSV</button>
            <button type="button" className="btn btn-secondary" onClick={() => download(`${slug(board.title)}.md`, exportMarkdown(board, today), 'text/markdown')}>Download as text</button>
          </div>
        </section>

        <section aria-labelledby="b-demo">
          <h3 id="b-demo">Try the demo</h3>
          <p>See what happens when teammates change the sample board overnight and send you their link.</p>
          <div className="action-list">
            <button type="button" className="btn btn-primary" onClick={onTeammateDemo}>Simulate teammates’ changes</button>
            <button type="button" className="btn btn-secondary" onClick={onResetDemo}>Reset the sample board</button>
          </div>
        </section>

        <section aria-labelledby="b-danger" className="danger-zone">
          <h3 id="b-danger">Delete “{board.title}”</h3>
          {!confirmDelete ? (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete this board…</button>
          ) : (
            <div role="group" aria-label="Confirm delete">
              <p>This removes the board from this device. Download a backup first if you might need it.</p>
              <div className="action-list">
                <button type="button" className="btn btn-danger" autoFocus onClick={() => onDelete(board.id)}>Yes, delete it</button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Keep it</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

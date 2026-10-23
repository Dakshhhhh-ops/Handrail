import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, WarningIcon } from './Icons';
import { revealFocus } from './BoardView';

/** ✓ or ⚠ before a reply, with words for screen readers, so success and failure never rely on colour alone. */
export function ReplyStatus({ ok }: { ok?: boolean }) {
  if (ok === undefined) return null;
  return ok ? (
    <span className="status-icon is-ok"><CheckIcon size={16} /></span>
  ) : (
    <span className="status-icon is-fail"><WarningIcon size={16} /><span className="sr-only">Didn’t work: </span></span>
  );
}

/** Shown when this device has no name yet, e.g. a teammate who just opened a share link. */
export function NamePrompt({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form
      className="name-prompt"
      aria-labelledby="name-prompt-h"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
    >
      <h3 id="name-prompt-h">What’s your name?</h3>
      <p className="empty-note" id="name-prompt-hint">Teammates see it next to the changes you make. Use the name your group knows you by.</p>
      <div className="command-row">
        <label htmlFor="name-prompt-input" className="sr-only">Your name</label>
        <input id="name-prompt-input" className="command-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-describedby="name-prompt-hint" autoComplete="given-name" />
        <button type="submit" className="btn btn-primary">Save</button>
      </div>
    </form>
  );
}

export interface LiveStatus {
  room: string;
  peers: { id: string; name: string | null }[];
  error?: string;
}

/** "Live with Riya and Arjun", with a way to invite more people or leave. Not a live region: arrivals are announced separately. */
export function LiveBar({ live, onInvite, onLeave }: { live: LiveStatus; onInvite: () => void; onLeave: () => void }) {
  const names = live.peers.map((p) => p.name ?? 'someone without a name');
  const text = live.error
    ? live.error
    : names.length
      ? `Live with ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`
      : 'Live session open. Waiting for teammates to join…';
  return (
    <section className={`live-bar${names.length ? ' is-connected' : ''}`} aria-labelledby="live-bar-text" data-testid="live-bar">
      <p id="live-bar-text">
        <span className="live-dot" aria-hidden="true" />
        <strong>{text}</strong>
      </p>
      <div className="live-actions">
        <button type="button" className="btn btn-secondary small" onClick={onInvite}>Invite</button>
        <button type="button" className="btn btn-secondary small" onClick={onLeave}>Leave<span className="sr-only"> live session</span></button>
      </div>
    </section>
  );
}

export interface HistoryEntry {
  id: number;
  who: 'you' | 'handrail';
  text: string;
  ok?: boolean;
}

function History({ entries }: { entries: HistoryEntry[] }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [entries.length]);

  return (
    <section className="history" aria-labelledby="history-h">
      <h3 id="history-h">Commands</h3>
      {entries.length === 0 ? (
        <p className="empty-note">
          Type or say what you want below, like “what changed” or “move slides to done”. Handrail shows what it will do before you press Enter, and your commands and its replies stay here.
        </p>
      ) : (
        <ol className="chat" data-testid="history">
          {entries.map((e, i) => (
            <li
              key={e.id}
              ref={i === entries.length - 1 ? end : undefined}
              className={`msg msg-${e.who}${e.ok === false ? ' msg-fail' : e.who === 'handrail' && e.ok ? ' msg-ok' : ''}`}
              data-testid={e.who === 'handrail' ? 'reply' : undefined}
            >
              <span className="sr-only">{e.who === 'you' ? 'You said: ' : 'Handrail: '}</span>
              {e.who === 'handrail' && <ReplyStatus ok={e.ok} />}
              <span className="msg-text">{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The right-hand panel on wide screens (and a full-screen dialog on phones):
 * what changed, the command history, and the command box pinned at the bottom.
 */
export function ActivityContent({
  changes, history, commandBar, headless = false,
}: {
  changes: ReactNode;
  history: HistoryEntry[];
  commandBar: ReactNode;
  headless?: boolean;
}) {
  return (
    <div className="activity-inner">
      {!headless && (
        <h2 id="activity-h" className="activity-title" tabIndex={-1}>
          Activity
        </h2>
      )}
      <div className="activity-scroll" tabIndex={0} role="region" aria-label="Changes and command history" onFocus={revealFocus}>
        {changes}
        <History entries={history} />
      </div>
      <div className="activity-input">{commandBar}</div>
    </div>
  );
}

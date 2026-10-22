import { useEffect, useRef, type ReactNode } from 'react';
import { CheckIcon, WarningIcon } from './Icons';

/** ✓ or ⚠ before a reply, with words for screen readers, so success and failure never rely on colour alone. */
export function ReplyStatus({ ok }: { ok?: boolean }) {
  if (ok === undefined) return null;
  return ok ? (
    <span className="status-icon is-ok"><CheckIcon size={16} /></span>
  ) : (
    <span className="status-icon is-fail"><WarningIcon size={16} /><span className="sr-only">Didn’t work: </span></span>
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
      <div className="activity-scroll" tabIndex={0} role="region" aria-label="Changes and command history">
        {changes}
        <History entries={history} />
      </div>
      <div className="activity-input">{commandBar}</div>
    </div>
  );
}

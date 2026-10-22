import { useEffect, useRef, type ReactNode } from 'react';

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
          Type or say what you want below, like “what changed” or “move slides to done”. Your commands and Handrail’s replies show up here.
        </p>
      ) : (
        <ol className="chat" data-testid="history">
          {entries.map((e, i) => (
            <li
              key={e.id}
              ref={i === entries.length - 1 ? end : undefined}
              className={`msg msg-${e.who}${e.ok === false ? ' msg-fail' : ''}`}
              data-testid={e.who === 'handrail' ? 'reply' : undefined}
            >
              <span className="sr-only">{e.who === 'you' ? 'You said: ' : 'Handrail: '}</span>
              {e.text}
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

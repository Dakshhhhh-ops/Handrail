import { useEffect, useState } from 'react';
import type { Change } from '../model/diff';
import type { Board } from '../model/types';

function summary(changes: Change[]) {
  const forYou = changes.filter((c) => c.forYou).length;
  return `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}${forYou ? `, ${forYou} for you` : ''}`;
}

/**
 * "Since you last looked": every change teammates made, written as sentences,
 * so nobody has to scan the board to spot what moved. "Got it" collapses the
 * list to one row, which stays until new changes arrive.
 */
export function ChangesPanel({
  changes, acknowledged, justMine, board, onGoTo, onReadAll, onDone,
}: {
  changes: Change[];
  acknowledged: boolean;
  justMine: boolean;
  board: Board;
  onGoTo: (cardId: string) => void;
  onReadAll: () => void;
  onDone: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [acknowledged, changes]);

  const shown = justMine ? changes.filter((c) => c.forYou) : changes;
  const open = changes.length > 0 && (!acknowledged || expanded);

  return (
    <section className={`changes${!acknowledged && changes.length ? ' has-news' : ''}`} aria-labelledby="changes-h" tabIndex={-1} id="changes" data-testid="changes" data-autofocus={!acknowledged && changes.length ? true : undefined}>
      <h3 id="changes-h">Since you last looked</h3>

      {changes.length === 0 && (
        <p className="empty-note">
          Nothing new. When a teammate sends you their board link, every change they made appears here, so you never have to hunt for it.
        </p>
      )}

      {changes.length > 0 && !open && (
        <div className="changes-collapsed" data-testid="changes-collapsed">
          <span>{summary(changes)}</span>
          <button type="button" id="changes-show" className="btn btn-quiet small" aria-expanded="false" onClick={() => setExpanded(true)}>
            Show<span className="sr-only"> changes</span>
          </button>
        </div>
      )}

      {open && (
        <>
          <p className="news-count">
            <span className="news-num">{changes.length}</span>{' '}
            <span>
              {changes.length === 1 ? 'change' : 'changes'}
              {changes.some((c) => c.forYou) && <> · <strong>{changes.filter((c) => c.forYou).length} for you</strong></>}
              {justMine && shown.length < changes.length && <> · showing yours</>}
            </span>
          </p>
          {shown.length > 0 ? (
            <ul className="change-list" data-testid="change-list">
              {shown.map((c, i) => (
                <li key={i} className={c.forYou ? 'for-you' : undefined}>
                  <span>
                    {c.forYou && <span className="flag">For you<span className="sr-only">:</span></span>} {c.text}
                  </span>
                  {c.cardId && board.cards[c.cardId] && (
                    <button type="button" className="btn btn-quiet small" onClick={() => onGoTo(c.cardId!)}>
                      Go to card<span className="sr-only">: {board.cards[c.cardId].title}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">None of these involve you. Turn off “Just mine” to see them all.</p>
          )}
          <div className="changes-actions">
            <button type="button" className="btn btn-secondary small" onClick={onReadAll}>Read all aloud</button>
            {acknowledged ? (
              <button type="button" className="btn btn-secondary small" aria-expanded="true" onClick={() => { setExpanded(false); requestAnimationFrame(() => document.getElementById('changes-show')?.focus()); }}>
                Hide<span className="sr-only"> changes</span>
              </button>
            ) : (
              <button type="button" className="btn btn-primary small" onClick={onDone}>Got it</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

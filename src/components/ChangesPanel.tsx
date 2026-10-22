import { forwardRef } from 'react';
import type { Change } from '../model/diff';
import type { Board } from '../model/types';

/**
 * "Since you last looked": every change teammates made, written as sentences,
 * so nobody has to scan the board visually to spot what moved.
 */
export const ChangesPanel = forwardRef<HTMLElement, {
  changes: Change[];
  board: Board;
  onGoTo: (cardId: string) => void;
  onReadAll: () => void;
  onDone: () => void;
}>(function ChangesPanel({ changes, board, onGoTo, onReadAll, onDone }, ref) {
  if (changes.length === 0) return null;
  const forYou = changes.filter((c) => c.forYou).length;
  return (
    <section ref={ref} className="changes" aria-labelledby="changes-h" tabIndex={-1} id="changes" data-testid="changes">
      <div className="changes-head">
        <h2 id="changes-h">
          Since you last looked: {changes.length} {changes.length === 1 ? 'change' : 'changes'}
          {forYou > 0 && <span className="pill">{forYou} for you</span>}
        </h2>
        <div className="changes-actions">
          <button type="button" className="btn btn-secondary" onClick={onReadAll}>Read all aloud</button>
          <button type="button" className="btn btn-primary" onClick={onDone}>Got it</button>
        </div>
      </div>
      <ul className="change-list">
        {changes.map((c, i) => (
          <li key={i} className={c.forYou ? 'for-you' : undefined}>
            {c.forYou && <span className="sr-only">For you: </span>}
            <span>{c.text}</span>
            {c.cardId && board.cards[c.cardId] && (
              <button type="button" className="btn btn-quiet small" onClick={() => onGoTo(c.cardId!)}>
                Go to card<span className="sr-only">: {board.cards[c.cardId].title}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
});

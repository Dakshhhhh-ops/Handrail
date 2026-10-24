import { useEffect, useState } from 'react';
import { authorizeUrl, listBoards, loadLink, saveLink, type TrelloLink } from '../lib/trello';

/**
 * "Connect Trello" in Boards & files: read a group's Trello boards directly instead of
 * exporting a file each time. Linked boards are fetched whenever Handrail opens.
 */
export function TrelloConnect({ open, onFollow, onSyncNow }: {
  open: boolean;
  /** Fetch and import a board the user just chose to follow. */
  onFollow: (trelloBoardId: string) => Promise<string>;
  /** Fetch every followed board again. */
  onSyncNow: () => Promise<string>;
}) {
  const [link, setLink] = useState<TrelloLink>(loadLink);
  const [boards, setBoards] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    const l = loadLink();
    setLink(l);
    setStatus('');
    if (!l.token) return;
    listBoards(l)
      .then((b) => { setBoards(b); setPick((p) => p || b.find((x) => !l.boards.includes(x.id))?.id || ''); })
      .catch((e: Error) => setStatus(e.message));
  }, [open]);

  const update = (next: TrelloLink) => { saveLink(next); setLink(next); };
  const name = (id: string) => boards?.find((b) => b.id === id)?.name ?? 'A Trello board';

  if (!link.token) {
    return (
      <section aria-labelledby="b-trello" className="trello-connect">
        <h3 id="b-trello">Connect Trello</h3>
        <p className="hint">
          Read your group’s Trello boards directly, with no exporting. Each time Handrail opens, it checks them and tells you what changed and who did
          it. It can only read: nothing is changed in Trello, and nothing goes anywhere except between this browser and Trello.
        </p>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          const k = (link.key || key).trim();
          if (!/^[A-Za-z0-9]{8,128}$/.test(k)) { setStatus('That doesn’t look like a Trello API key.'); return; }
          update({ ...link, key: k });
          const back = `${window.location.origin}${window.location.pathname}?board`;
          window.location.assign(authorizeUrl(k, back));
        }}>
          {!link.key && (
            <div className="field">
              <label htmlFor="trello-key">Trello API key</label>
              <input id="trello-key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
              <p className="hint">Free from trello.com/power-ups/admin: New, then API key. Add this site’s address as an allowed origin.</p>
            </div>
          )}
          <button type="submit" className="btn btn-secondary">Connect Trello</button>
        </form>
        <p role="status" className="hint">{status}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="b-trello" className="trello-connect">
      <h3 id="b-trello">Trello</h3>
      <p className="hint">Connected, read-only. Boards you follow are checked each time Handrail opens.</p>
      {link.boards.length > 0 && (
        <ul className="plain-list" aria-label="Trello boards you follow">
          {link.boards.map((id) => (
            <li key={id}>
              {name(id)}{' '}
              <button type="button" className="btn btn-quiet small" onClick={() => update({ ...link, boards: link.boards.filter((b) => b !== id) })}>
                Stop following<span className="sr-only"> {name(id)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {boards && boards.some((b) => !link.boards.includes(b.id)) && (
        <form className="form inline-form" onSubmit={async (e) => {
          e.preventDefault();
          if (!pick) return;
          update({ ...link, boards: [...new Set([...link.boards, pick])] });
          setStatus('Reading the board from Trello…');
          setStatus(await onFollow(pick));
        }}>
          <div className="field">
            <label htmlFor="trello-pick">Follow a board</label>
            <select id="trello-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
              {boards.filter((b) => !link.boards.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-secondary">Follow</button>
        </form>
      )}
      <div className="action-list">
        {link.boards.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={async () => { setStatus('Checking Trello…'); setStatus(await onSyncNow()); }}>
            Check Trello now
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => { update({ ...link, token: null }); setBoards(null); setStatus('Disconnected from Trello.'); }}>
          Disconnect
        </button>
      </div>
      <p role="status" className="hint">{status}</p>
    </section>
  );
}

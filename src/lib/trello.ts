/**
 * A read-only connection to Trello, straight from the browser (no Handrail server).
 *
 * Trello's sign-in page hands back a token in the address (#token=…). Handrail keeps it on
 * this device and uses it to fetch linked boards each time the app opens. The board comes
 * back in the same shape as Trello's JSON export, so the existing import and re-import
 * merge handle it, and the changes are listed under "Since you last looked".
 */

/** The app's Trello API key, if one is built in (VITE_TRELLO_KEY). Otherwise people paste their own. */
export const BUILT_IN_KEY: string = (import.meta.env.VITE_TRELLO_KEY as string | undefined) ?? '';

const STORE = 'handrail:trello';

export interface TrelloLink {
  key: string;
  token: string | null;
  /** Trello board ids to fetch whenever Handrail opens. */
  boards: string[];
}

export function loadLink(): TrelloLink {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<TrelloLink> | null;
    const ok = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9]{8,128}$/.test(s);
    return {
      key: ok(raw?.key) ? raw!.key! : BUILT_IN_KEY,
      token: ok(raw?.token) ? raw!.token! : null,
      boards: Array.isArray(raw?.boards) ? raw!.boards!.filter(ok).slice(0, 20) : [],
    };
  } catch {
    return { key: BUILT_IN_KEY, token: null, boards: [] };
  }
}

export function saveLink(link: TrelloLink) {
  try {
    localStorage.setItem(STORE, JSON.stringify(link));
  } catch {
    /* storage blocked: the connection lasts for this visit only */
  }
}

/** Trello's sign-in page. Read-only, and the token expires after 30 days. */
export function authorizeUrl(key: string, returnUrl: string): string {
  const q = new URLSearchParams({
    expiration: '30days', name: 'Handrail', scope: 'read', response_type: 'token',
    key, return_url: returnUrl, callback_method: 'fragment',
  });
  return `https://trello.com/1/authorize?${q}`;
}

/** The token Trello puts in the address after sign-in, if this page load is that return. */
export function tokenFromHash(hash: string): string | null {
  const m = hash.match(/^#token=([A-Za-z0-9]{16,128})$/);
  return m ? m[1] : null;
}

async function get<T>(path: string, link: TrelloLink, params: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ ...params, key: link.key, token: link.token ?? '' });
  const r = await fetch(`https://api.trello.com/1/${path}?${q}`);
  if (r.status === 401) throw new Error('Trello says the connection has expired. Connect again.');
  if (!r.ok) throw new Error(`Trello didn’t answer (${r.status}).`);
  return (await r.json()) as T;
}

/** Your own Trello name, so cards assigned to you there count as yours here. */
export function whoAmI(link: TrelloLink): Promise<{ fullName?: string; username?: string }> {
  return get('members/me', link, { fields: 'fullName,username' });
}

export function listBoards(link: TrelloLink): Promise<{ id: string; name: string }[]> {
  return get('members/me/boards', link, { filter: 'open', fields: 'name' });
}

/** One board, with its lists, cards, members and recent activity: the same shape as an export. */
export function fetchBoard(link: TrelloLink, id: string): Promise<unknown> {
  if (!/^[A-Za-z0-9]{8,64}$/.test(id)) return Promise.reject(new Error('Not a Trello board id.'));
  return get(`boards/${id}`, link, {
    fields: 'name',
    lists: 'open', list_fields: 'name,pos,closed',
    cards: 'open', card_fields: 'name,desc,due,idList,pos,closed,idMembers,dateLastActivity',
    members: 'all', member_fields: 'fullName,username',
    actions: 'createCard,updateCard,addMemberToCard,removeMemberFromCard,commentCard,copyCard,moveCardToBoard',
    actions_limit: '1000', action_fields: 'date,data,type', action_memberCreator_fields: 'fullName,username',
  });
}

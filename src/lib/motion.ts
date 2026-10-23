/**
 * Motion for the board. Every effect here is decoration on top of information
 * the app already gives in words, and all of it turns off when the system asks
 * for reduced motion or the reader picks "Turn off animations".
 */

import type { PointerEvent as RPointerEvent } from 'react';

export function motionOK(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'reduce') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const EASE = 'cubic-bezier(.2,.85,.25,1)';

// ---- FLIP: cards glide from where they were to where they are ------------------

export type Rects = Map<string, DOMRect>;

/** Card positions relative to the board, so page scrolling never looks like movement. */
export function measureCards(board: HTMLElement | null): Rects {
  const out: Rects = new Map();
  if (!board) return out;
  const origin = board.getBoundingClientRect();
  board.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
    const r = el.getBoundingClientRect();
    out.set(el.dataset.card!, new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height));
  });
  return out;
}

export function playMoves(board: HTMLElement | null, before: Rects, after: Rects): void {
  if (!board || !motionOK() || before.size === 0) return;
  for (const [id, now] of after) {
    const el = board.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`);
    if (!el) continue;
    const was = before.get(id);
    if (!was) {
      // A new card: drop in.
      el.animate(
        [{ transform: 'translateY(-18px) scale(.92) rotate(-2deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 420, easing: EASE },
      );
      continue;
    }
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    const far = Math.hypot(dx, dy) > 60;
    el.animate(
      far
        ? [
            { transform: `translate(${dx}px, ${dy}px)`, zIndex: 5 },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 26}px) rotate(${dx > 0 ? -4 : 4}deg) scale(1.05)`, zIndex: 5, offset: 0.45 },
            { transform: 'none', zIndex: 5 },
          ]
        : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: far ? 560 : 260, easing: EASE },
    );
  }
}

// ---- Tilt: cards lean towards the pointer ---------------------------------------

export function tilt(e: RPointerEvent<HTMLElement>): void {
  const el = e.currentTarget as HTMLElement;
  if (e.pointerType !== 'mouse' || !motionOK()) return;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
  el.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
  el.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
  el.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
}

export function untilt(e: RPointerEvent<HTMLElement>): void {
  const el = e.currentTarget as HTMLElement;
  el.style.removeProperty('--rx');
  el.style.removeProperty('--ry');
}

// ---- Entrance ------------------------------------------------------------------------

export function entrance(root: HTMLElement | null): void {
  if (!root || !motionOK()) return;
  const cols = root.querySelectorAll<HTMLElement>('.column');
  cols.forEach((col, i) => {
    col.animate([{ transform: 'translateY(40px) rotateX(18deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: 700, delay: 120 + i * 90, easing: EASE, fill: 'backwards',
    });
    col.querySelectorAll<HTMLElement>('.card').forEach((card, j) => {
      card.animate([{ transform: 'translateY(24px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 560, delay: 260 + i * 90 + j * 60, easing: EASE, fill: 'backwards',
      });
    });
  });
  root.querySelectorAll<HTMLElement>('.title-word').forEach((w, i) => {
    w.animate([{ transform: 'translateY(105%)' }, { transform: 'none' }], { duration: 800, delay: i * 70, easing: EASE, fill: 'backwards' });
  });
}

// ---- Replay: multiplayer cursors fly to each changed card ----------------------------

export interface ReplayStep {
  cardId: string;
  who: string;
  colour: string;
}

let replaying = false;

/** Animates one name-tagged cursor per change, in turn, from the Activity panel to the card. */
export async function replay(steps: ReplayStep[]): Promise<void> {
  if (replaying || !steps.length) return;
  replaying = true;
  const layer = document.createElement('div');
  layer.className = 'cursor-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  const moving = motionOK();
  try {
    for (const step of steps) {
      const card = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(step.cardId)}"]`);
      if (!card) continue;
      card.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: moving ? 'smooth' : 'auto' });
      const target = card.getBoundingClientRect();
      if (moving) {
        const start = document.querySelector('.changes')?.getBoundingClientRect() ?? new DOMRect(window.innerWidth, 0, 0, 0);
        const cursor = document.createElement('div');
        cursor.className = `fly-cursor ${step.colour}`;
        cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5 20 11l-7 1.9-3.8 7.6z" fill="currentColor" stroke="#0c0c16" stroke-width="1.6" stroke-linejoin="round"/></svg><span></span>';
        cursor.querySelector('span')!.textContent = step.who;
        layer.appendChild(cursor);
        const from = { x: start.left + 20, y: start.top + 40 };
        const to = { x: target.left + target.width * 0.7, y: target.top + target.height * 0.55 };
        const bend = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 120 };
        await cursor.animate(
          [
            { transform: `translate(${from.x}px, ${from.y}px) scale(.6)`, opacity: 0 },
            { transform: `translate(${bend.x}px, ${bend.y}px) scale(1.1)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1 },
          ],
          { duration: 900, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' },
        ).finished;
        cursor.animate([{ transform: `translate(${to.x}px, ${to.y}px) scale(1)` }, { transform: `translate(${to.x}px, ${to.y}px) scale(.82)` }, { transform: `translate(${to.x}px, ${to.y}px) scale(1)` }], { duration: 260 });
        card.animate(
          [{ transform: 'none' }, { transform: 'translateY(-6px) rotate(-1.5deg) scale(1.04)', boxShadow: '8px 10px 0 #0c0c16' }, { transform: 'none' }],
          { duration: 520, easing: EASE },
        );
        await new Promise((r) => setTimeout(r, 650));
        cursor.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
      } else {
        card.classList.add('is-highlight');
        await new Promise((r) => setTimeout(r, 900));
        card.classList.remove('is-highlight');
      }
    }
    await new Promise((r) => setTimeout(r, 450));
  } finally {
    layer.remove();
    replaying = false;
  }
}

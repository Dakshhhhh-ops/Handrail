import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

/** One step of "How to use": what to look at, and which part of the screen it is. */
interface Step {
  title: string;
  body: string[];
  /** CSS selector of the part of the page this step is about (highlighted while it's shown). */
  target?: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Handrail',
    body: [
      'A project board that tells you what changed, so you never have to hunt for it.',
      'This is Priya’s group project. Her teammates Riya and Arjun changed it overnight. Here’s how to catch up in under a minute.',
    ],
  },
  {
    title: 'See what changed',
    target: '#changes',
    body: [
      '“Since you last looked” lists every change in plain sentences, with what involves you first, and ends with your next step.',
      'Show me on the board points at each changed card. Before / now flips the board back to how you last saw it.',
    ],
  },
  {
    title: 'Move cards without dragging',
    target: '#board',
    body: [
      'Tab to a card. Arrow keys move between cards. Space picks a card up, arrows move it, Enter drops it.',
      'Or press Enter on a card for a menu. Dragging with a mouse works too.',
    ],
  },
  {
    title: 'Or just say it',
    target: '.command-form',
    body: [
      'Press / and type, or press Speak: “what changed”, “what next”, “my tasks”, “move find sources to done”.',
      'Handrail shows what it will do before you press Enter, and Ctrl+Z undoes anything.',
    ],
  },
  {
    title: 'You’re ready',
    body: [
      'Press ? any time for every key and command.',
      'Want to feel why this matters? Try the one-minute challenge with your eyes closed.',
    ],
  },
];

export const TOUR_SEEN = 'handrail:tour-seen';

export function Tour({ open, onClose, onChallenge }: { open: boolean; onClose: () => void; onChallenge: () => void }) {
  const [i, setI] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => { if (open) setI(0); }, [open]);

  // Highlight the part of the page this step is about.
  useEffect(() => {
    if (!open || !step.target) return;
    const el = document.querySelector<HTMLElement>(step.target);
    if (!el) return;
    el.classList.add('tour-target');
    el.scrollIntoView?.({ block: 'nearest' });
    return () => el.classList.remove('tour-target');
  }, [open, step.target]);

  const finish = () => {
    try { localStorage.setItem(TOUR_SEEN, '1'); } catch { /* storage blocked */ }
    onClose();
  };
  const go = (n: number) => {
    setI(n);
    // Move focus to the new step so a screen reader reads it.
    requestAnimationFrame(() => heading.current?.focus());
  };

  return (
    <Modal open={open} onClose={finish} title="Quick tour" className="tour" testId="tour">
      <div className="tour-step">
        <p className="tour-count">Step {i + 1} of {STEPS.length}</p>
        <h3 ref={heading} tabIndex={-1}>{step.title}</h3>
        {step.body.map((t) => <p key={t}>{t}</p>)}
      </div>
      <div className="form-actions">
        {last ? (
          <>
            <button type="button" className="btn btn-primary" onClick={finish} data-autofocus>Start using Handrail</button>
            <button type="button" className="btn btn-secondary" onClick={() => { finish(); onChallenge(); }}>Try it with your eyes closed</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => go(i + 1)} data-autofocus>Next</button>
            {i > 0 && <button type="button" className="btn btn-secondary" onClick={() => go(i - 1)}>Back</button>}
            <button type="button" className="btn btn-quiet" onClick={finish}>Skip</button>
          </>
        )}
      </div>
    </Modal>
  );
}

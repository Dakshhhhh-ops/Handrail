import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { locate } from '../model/board';
import { stopSpeaking } from '../lib/speech';
import type { Handrail } from '../store/useHandrail';
import { useAnnounce } from './Announcer';
import { Modal } from './Modal';
import '../blindfold.css';

/**
 * "Try it with your eyes closed": a one-minute challenge for anyone who has
 * never used a board without seeing it. The screen goes dark (visually only:
 * the app underneath keeps working with the keyboard and screen readers),
 * Handrail talks, and big captions show what it says.
 */

type Phase = 'intro' | 'running' | 'done' | 'closed';

interface Step {
  id: 'heard' | 'found' | 'moved';
  label: string;
  hint: string;
}

const STEPS: Step[] = [
  { id: 'heard', label: 'Hear what your teammates changed', hint: 'Handrail is reading the changes. Press slash, type “what changed”, then Enter to hear them again.' },
  { id: 'found', label: 'Go to the card that is now yours', hint: 'Press Tab until you hear “Go to card: Email Doctor Mehta”, then press Enter.' },
  { id: 'moved', label: 'Move “Find five sources” to Doing', hint: 'Press slash, type “move find sources to doing”, then press Enter.' },
];

/** Speaks text. `interrupt` cuts off whatever is being said (used for focus, like a screen reader). */
function utter(text: string, rate: number, interrupt: boolean) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth || !text) return;
  if (interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  synth.speak(u);
}

/** What a screen reader would say for the focused element, in short. */
function spokenName(el: HTMLElement): string {
  const byIds = el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  const label = el.getAttribute('aria-label') || byIds || (el as HTMLInputElement).labels?.[0]?.textContent || el.getAttribute('placeholder') || el.textContent || '';
  const name = label.replace(/\s+/g, ' ').trim();
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') || (tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'input' || tag === 'textarea' ? 'edit text' : '');
  if (el.hasAttribute('data-card')) return name; // cards already say where they are
  return role && !name.toLowerCase().endsWith(role) ? `${name}, ${role}` : name;
}

const SOURCES = 'k-sources';
const MINE = 'k-email';
const BEST = 'handrail:blindfold-best';
const HINT_AFTER_MS = 25_000;

export function Blindfold({
  open,
  onClose,
  store,
  onSimulate,
}: {
  open: boolean;
  onClose: () => void;
  store: Handrail;
  /** Starts the sample board fresh with the teammates' overnight changes. */
  onSimulate: () => void;
}) {
  const { message } = useAnnounce();
  const [phase, setPhase] = useState<Phase>('closed');
  const [done, setDone] = useState<Record<Step['id'], boolean>>({ heard: false, found: false, moved: false });
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [result, setResult] = useState<{ ms: number; best: number | null; isBest: boolean } | null>(null);
  const lastEsc = useRef(0);
  const lastProgress = useRef(0);
  const hinted = useRef<Set<string>>(new Set());
  const [focusText, setFocusText] = useState('');
  /** People with their own screen reader don't want Handrail reading focus as well. */
  const [ownReader, setOwnReader] = useState(false);
  const appSpeaks = store.settings.speak;
  const rate = store.settings.speechRate;

  useEffect(() => {
    if (open && phase === 'closed') {
      setDone({ heard: false, found: false, moved: false });
      setResult(null);
      setPhase('intro');
    }
  }, [open, phase]);

  // Announcements queue after whatever is being said; focus interrupts, like a screen reader.
  const say = useCallback((text: string) => { if (!appSpeaks && !ownReader) utter(text, rate, false); }, [appSpeaks, ownReader, rate]);

  const end = useCallback((reason: 'finished' | 'stopped') => {
    document.documentElement.classList.remove('bf-on');
    stopSpeaking();
    if (reason === 'stopped') {
      setPhase('closed');
      onClose();
      return;
    }
    const ms = Date.now() - started;
    let best: number | null = null;
    try { best = Number(localStorage.getItem(BEST)) || null; } catch { /* storage blocked */ }
    const isBest = best === null || ms < best;
    if (isBest) { try { localStorage.setItem(BEST, String(ms)); } catch { /* storage blocked */ } }
    setResult({ ms, best: isBest ? ms : best, isBest });
    setPhase('done');
    if (!ownReader) utter(`Done in ${Math.round(ms / 1000)} seconds, without seeing the screen. Priya does this every day.`, rate, true);
  }, [onClose, ownReader, rate, started]);

  function start() {
    setPhase('running');
    document.documentElement.classList.add('bf-on');
    const t = Date.now();
    setStarted(t);
    setNow(t);
    setFocusText('');
    lastProgress.current = t;
    hinted.current = new Set();
    onSimulate();
    // Let the app's own announcement ("4 changes since you last looked…") come first.
    window.setTimeout(() => say('The screen is dark. Your teammates changed the board overnight. First, listen to what changed.'), 50);
  }

  // Speak and caption everything the app announces while the challenge runs.
  useEffect(() => {
    if (phase !== 'running' || !message) return;
    say(message);
    // The first thing announced after the teammates' changes arrive is the summary of them.
    if (store.changes.length > 0 || /since you last looked/i.test(message)) setDone((d) => (d.heard ? d : { ...d, heard: true }));
  }, [message, phase, say, store.changes.length]);

  // A tiny built-in screen reader: say and caption whatever gets focus.
  // Step 2: focus reaches the card that was assigned to you.
  useEffect(() => {
    if (phase !== 'running') return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el === document.body) return;
      const text = spokenName(el);
      if (text) {
        setFocusText(text);
        if (!appSpeaks && !ownReader) utter(text, rate, true);
      }
      if (el.id === `card-${MINE}`) setDone((d) => (d.found ? d : { ...d, heard: true, found: true }));
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [phase, appSpeaks, ownReader, rate]);

  // Step 3: the board itself says whether the card is in Doing.
  useEffect(() => {
    if (phase !== 'running') return;
    const loc = locate(store.board, SOURCES);
    if (loc && /doing|in progress/i.test(loc.column.title)) setDone((d) => (d.moved ? d : { ...d, moved: true }));
  }, [store.board, phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    lastProgress.current = Date.now();
    if (done.heard && done.found && done.moved) window.setTimeout(() => end('finished'), 400);
  }, [done, phase, end]);

  // Clock, and a spoken hint when someone is stuck.
  useEffect(() => {
    if (phase !== 'running') return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      const step = STEPS.find((s) => !done[s.id]);
      if (step && n - lastProgress.current > HINT_AFTER_MS && !hinted.current.has(step.id)) {
        hinted.current.add(step.id);
        say(`Hint: ${step.hint}`);
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [phase, done, say]);

  // Escape twice, quickly, stops the challenge. (One Escape still cancels a picked-up card.)
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const n = Date.now();
      if (n - lastEsc.current < 800) end('stopped');
      lastEsc.current = n;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, end]);

  useEffect(() => () => document.documentElement.classList.remove('bf-on'), []);

  const close = () => {
    setPhase('closed');
    onClose();
  };
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const current = STEPS.find((s) => !done[s.id]);

  return (
    <>
      <Modal
        open={phase === 'intro'}
        onClose={close}
        title="Try it with your eyes closed"
        description="One minute, no mouse, no screen. This is how Priya, who is blind, uses the board every day."
        testId="blindfold-intro"
      >
        <div className="bf-intro">
          <p>When you start, the screen goes dark and Handrail talks. Big captions show what it says, for anyone who can’t hear it.</p>
          <ol className="bf-steps">
            {STEPS.map((s) => <li key={s.id}>{s.label}</li>)}
          </ol>
          <p className="hint">
            Keys: <kbd>Tab</kbd> moves between things, <kbd>Enter</kbd> opens or presses, arrow keys move between cards, and <kbd>/</kbd> lets you type a sentence such as “move find sources to doing”.
            Press <kbd>Esc</kbd> twice to stop. This starts the sample board fresh.
          </p>
          <label className="check">
            <input type="checkbox" checked={ownReader} onChange={(e) => setOwnReader(e.target.checked)} />
            I use my own screen reader (Handrail won’t speak as well)
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={start} data-autofocus>Start, and turn the screen off</button>
            <button type="button" className="btn btn-secondary" onClick={close}>Not now</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={phase === 'done'}
        onClose={close}
        title={result ? `Done in ${Math.round(result.ms / 1000)} seconds` : 'Done'}
        description="You found what changed and moved a card without seeing the screen or touching the mouse."
        testId="blindfold-result"
      >
        {result && (
          <div className="bf-intro">
            <p className="bf-big">Priya does this every day.</p>
            <p>{result.isBest ? 'That’s your best time.' : `Your best is ${Math.round((result.best ?? result.ms) / 1000)} seconds.`}</p>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => { setPhase('intro'); setDone({ heard: false, found: false, moved: false }); }} data-autofocus>Try again</button>
              <button type="button" className="btn btn-secondary" onClick={close}>Back to the board</button>
            </div>
          </div>
        )}
      </Modal>

      {phase === 'running' && createPortal(
        <>
          {/* Visual only: screen-reader users already hear the same words from the live region. */}
          <div className="bf-layer" aria-hidden="true" data-testid="blindfold-layer">
            <div className="bf-top">
              <span className="bf-rec">● Screen off</span>
              <span className="bf-clock">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
            </div>
            <p className="bf-caption" key={message}>{message || 'Listening…'}</p>
            {focusText && <p className="bf-focus"><span className="bf-focus-label">Focus</span> {focusText}</p>}
            <ol className="bf-progress">
              {STEPS.map((s) => (
                <li key={s.id} className={done[s.id] ? 'is-done' : s === current ? 'is-now' : ''}>
                  <span className="bf-tick">{done[s.id] ? '✓' : s === current ? '→' : '·'}</span> {s.label}
                </li>
              ))}
            </ol>
            <p className="bf-foot">No mouse. Keyboard only. Press Esc twice to stop.</p>
          </div>
          <div className="bf-stop">
            <button type="button" className="btn btn-secondary small" onClick={() => end('stopped')}>Stop the challenge</button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

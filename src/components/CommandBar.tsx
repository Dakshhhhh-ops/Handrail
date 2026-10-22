import { useEffect, useRef, useState, type FormEvent } from 'react';
import { canListen, listenOnce, type Listener } from '../lib/speech';
import { useAnnounce } from './Announcer';
import type { HistoryEntry } from './ActivityPanel';

const EXAMPLES = [
  'what changed',
  'move find sources to doing',
  'add book a study room due friday',
  "what's due this week",
  'my tasks',
];

export function CommandBar({ onRun, lastReply }: { onRun: (text: string) => boolean; lastReply?: HistoryEntry | null }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const showExamples = examplesOpen || (focusWithin && !text);
  const listener = useRef<Listener | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { announce } = useAnnounce();

  useEffect(() => setVoiceOk(canListen()), []);
  useEffect(() => () => listener.current?.stop(), []);

  function run(value: string) {
    const v = value.trim();
    if (!v) {
      announce('Type or say a command first. Say “help” for ideas.');
      return;
    }
    if (onRun(v)) setText('');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run(text);
  }

  function toggleVoice() {
    if (listening) {
      listener.current?.stop();
      return;
    }
    setText('');
    setListening(true);
    announce('Listening.');
    listener.current = listenOnce({
      onText: setText,
      onDone: (finalText) => {
        setListening(false);
        listener.current = null;
        if (finalText) {
          setText(finalText);
          run(finalText);
        } else announce('I didn’t catch that. Try again, or type the command.');
        input.current?.focus();
      },
      onError: (msg) => {
        setListening(false);
        listener.current = null;
        announce(msg);
      },
    });
    if (!listener.current) setListening(false);
  }

  return (
    <section
      className="command"
      aria-labelledby="command-label"
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <form onSubmit={submit} className="command-form" role="search" aria-label="Command">
        <label id="command-label" htmlFor="command-input" className="command-label">
          Tell Handrail what to do
        </label>
        <div className="command-row">
          <input
            ref={input}
            id="command-input"
            className="command-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. move lab report to done"
            aria-describedby="command-hint"
          />
          {voiceOk && (
            <button
              type="button"
              className={`btn btn-secondary mic${listening ? ' is-listening' : ''}`}
              onClick={toggleVoice}
              aria-pressed={listening}
            >
              {listening ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
              )}
              {listening ? 'Stop' : 'Speak'}
            </button>
          )}
          <button type="submit" className="btn btn-primary">
            Do it
          </button>
        </div>
        <div className="command-meta">
          <p id="command-hint" className="hint">
            Press <kbd>/</kbd> to come back here, <kbd>?</kbd> for help.
          </p>
          <button
            type="button"
            className="btn btn-quiet examples-toggle"
            aria-expanded={showExamples}
            aria-controls="command-examples"
            onClick={() => setExamplesOpen((v) => !(v || (focusWithin && !text)))}
          >
            {showExamples ? 'Hide examples' : 'Show examples'}
          </button>
        </div>
      </form>
      <div className="examples" id="command-examples" aria-label="Example commands" role="group" hidden={!showExamples}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setText(ex); setExamplesOpen(false); input.current?.focus(); }}
          >
            {ex}
          </button>
        ))}
      </div>
      {lastReply && (
        <p className={`last-reply${lastReply.ok === false ? ' is-fail' : ''}`} data-testid="last-reply">
          {lastReply.text}
        </p>
      )}
    </section>
  );
}

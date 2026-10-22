import { useEffect, useRef, useState, type FormEvent } from 'react';
import { canListen, listenOnce, type Listener } from '../lib/speech';
import { useAnnounce } from './Announcer';

const EXAMPLES = [
  'what changed',
  'move find sources to doing',
  'add book a study room due friday',
  "what's due this week",
  'my tasks',
];

export function CommandBar({ onRun }: { onRun: (text: string) => boolean }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const listener = useRef<Listener | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { announce, message } = useAnnounce();

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
    <section className="command" aria-labelledby="command-label">
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
        <p id="command-hint" className="hint">
          Type or speak a sentence. Press <kbd>/</kbd> to come back here, <kbd>?</kbd> for help.
        </p>
      </form>
      <div className="examples" aria-label="Example commands" role="group">
        <span className="examples-label" aria-hidden="true">Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => { setText(ex); input.current?.focus(); }}>
            {ex}
          </button>
        ))}
      </div>
      <p className="reply" data-testid="reply">
        {message || 'Ready. Your board is below.'}
      </p>
    </section>
  );
}

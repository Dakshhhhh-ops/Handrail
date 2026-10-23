import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { speak } from '../lib/speech';

interface AnnounceApi {
  announce: (message: string) => void;
  message: string;
  /** Speak every announcement aloud for a while (e.g. during the eyes-closed challenge), whatever the setting. */
  setForceSpeech: (on: boolean) => void;
}

const Ctx = createContext<AnnounceApi>({ announce: () => {}, message: '', setForceSpeech: () => {} });

/**
 * One polite live region for the whole app. Screen readers read each new
 * message; with "Read aloud" on, the browser speaks it too.
 */
export function AnnouncerProvider({ children, speakAloud, rate }: { children: ReactNode; speakAloud: boolean; rate: number }) {
  const [message, setMessage] = useState('');
  const [live, setLive] = useState('');
  const [forced, setForceSpeech] = useState(false);
  const timer = useRef<number>();

  const announce = useCallback(
    (msg: string) => {
      if (!msg) return;
      setMessage(msg);
      // Clear first so a repeated message is read again.
      setLive('');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLive(msg), 60);
      if (speakAloud || forced) speak(msg, rate);
    },
    [speakAloud, forced, rate],
  );

  return (
    <Ctx.Provider value={{ announce, message, setForceSpeech }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {live}
      </div>
    </Ctx.Provider>
  );
}

export const useAnnounce = () => useContext(Ctx);

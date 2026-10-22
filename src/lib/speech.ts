/** Reads text aloud for people who don't use a screen reader (low vision, dyslexia, tired eyes). */
export function speak(text: string, rate = 1): void {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, ''));
    u.rate = rate;
    window.speechSynthesis.speak(u);
  } catch {
    /* Speech is optional. */
  }
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return typeof window !== 'undefined' && ctor() !== null;
}

export interface Listener {
  stop(): void;
}

/** Listens for one spoken command. Calls onText with partial text while listening, then onDone once. */
export function listenOnce(handlers: {
  onText: (text: string) => void;
  onDone: (finalText: string) => void;
  onError: (message: string) => void;
}): Listener | null {
  const C = ctor();
  if (!C) return null;
  const rec = new C();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = '';
  let finished = false;
  rec.onresult = (e) => {
    text = '';
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    handlers.onText(text);
  };
  rec.onerror = (e) => {
    finished = true;
    const msg =
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Microphone permission was blocked. You can type the command instead.'
        : e.error === 'no-speech'
          ? 'I didn’t hear anything. Try again, or type the command.'
          : 'Voice input stopped. You can type the command instead.';
    handlers.onError(msg);
  };
  rec.onend = () => {
    if (!finished) handlers.onDone(text.trim());
    finished = true;
  };
  try {
    rec.start();
  } catch {
    handlers.onError('Voice input could not start. You can type the command instead.');
    return null;
  }
  return { stop: () => rec.stop() };
}

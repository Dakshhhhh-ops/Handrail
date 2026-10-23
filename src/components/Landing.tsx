import { Fragment, useEffect, useRef, useState } from 'react';
import { motionOK } from '../lib/motion';
import { CursorIcon } from './Icons';
import '../landing.css';

/**
 * The story: a scroll-driven introduction shown to first-time visitors.
 * Text is real headings and paragraphs in reading order; the 3D stage beside it
 * is decoration (aria-hidden) driven by one GSAP timeline scrubbed by scroll.
 * "Open the board" is always the first thing you can reach with Tab.
 */

type Slot = { col: number; row: number };
interface MiniCard {
  id: string;
  title: string;
  who: string;
  pc: string;
  badge?: string;
}

const CARDS: MiniCard[] = [
  { id: 'sources', title: 'Find five sources', who: 'P', pc: 'me', badge: 'Tomorrow' },
  { id: 'slides', title: 'Design slides 4–8', who: 'R', pc: 'p2', badge: 'Mon' },
  { id: 'email', title: 'Email Dr. Mehta', who: '', pc: '', badge: 'Today' },
  { id: 'script', title: 'Write the script', who: 'A', pc: 'p4', badge: 'Tue' },
  { id: 'outline', title: 'Draft the outline', who: 'P', pc: 'me', badge: 'Overdue' },
  { id: 'topic', title: 'Pick the topic', who: 'A', pc: 'p4' },
  { id: 'chat', title: 'Set up group chat', who: 'R', pc: 'p2' },
  { id: 'rehearse', title: 'Rehearse on call', who: '', pc: '', badge: 'Wed' },
];

const BEFORE: Record<string, Slot> = {
  sources: { col: 0, row: 0 }, slides: { col: 0, row: 1 }, email: { col: 0, row: 2 }, script: { col: 0, row: 3 },
  outline: { col: 1, row: 0 }, topic: { col: 2, row: 0 }, chat: { col: 2, row: 1 }, rehearse: { col: 0, row: 3 },
};
const AFTER: Record<string, Slot> = {
  sources: { col: 0, row: 0 }, email: { col: 0, row: 1 }, rehearse: { col: 0, row: 2 },
  outline: { col: 1, row: 0 }, script: { col: 1, row: 1 },
  slides: { col: 2, row: 0 }, topic: { col: 2, row: 1 }, chat: { col: 2, row: 2 },
};
const COLS = ['To do', 'Doing', 'Done'];
const xy = (s: Slot) => ({ x: 14 + s.col * 212, y: 58 + s.row * 82 });
const place = (s: Slot) => ({ transform: `translate(${xy(s).x}px, ${xy(s).y}px)` });

const SCENES = [
  { id: 'hello', label: 'Hello' },
  { id: 'problem', label: 'Problem' },
  { id: 'digest', label: 'Digest' },
  { id: 'keys', label: 'No dragging' },
  { id: 'merge', label: 'Merge' },
  { id: 'live', label: 'Live' },
  { id: 'built', label: 'Built' },
  { id: 'start', label: 'Start' },
];

export function Landing({ onEnter, onChallenge }: { onEnter: () => void; onChallenge: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(0);
  const moving = useRef(motionOK());
  const api = useRef<{ pause: (p: boolean) => void; goTo: (i: number) => void } | null>(null);

  useEffect(() => {
    document.title = 'Handrail: never hunt for what changed';
    const el = root.current;
    if (!el) return;

    // Fit the 3D stage to whatever room it has.
    const stage = el.querySelector<HTMLElement>('.stage-sticky');
    const fit = new ResizeObserver(() => {
      if (!stage) return;
      const s = Math.min(1.15, (stage.clientWidth - 48) / 680, (stage.clientHeight - 60) / 480);
      el.style.setProperty('--s', String(Math.max(0.4, s)));
    });
    if (stage) fit.observe(stage);

    // Track the section in view for the ruler (works with or without motion).
    const sections = [...el.querySelectorAll<HTMLElement>('.scene')];
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(sections.indexOf(e.target as HTMLElement))),
      { rootMargin: '-45% 0px -45% 0px' },
    );
    sections.forEach((s) => io.observe(s));

    if (!moving.current) {
      api.current = { pause: () => {}, goTo: (i) => sections[i]?.scrollIntoView() };
      return () => {
        io.disconnect();
        fit.disconnect();
      };
    }

    let cleanup = () => {};
    let cancelled = false;
    void (async () => {
      const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
        import('lenis'),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);

      // Smooth wheel scrolling on this page only; keyboard, find-in-page and focus keep native scrolling.
      const lenis = new Lenis({ smoothWheel: true, syncTouch: false });
      lenis.on('scroll', ScrollTrigger.update);
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      const onFocus = (e: FocusEvent) => {
        lenis.stop();
        (e.target as HTMLElement).scrollIntoView?.({ block: 'nearest' });
        lenis.start();
      };
      el.addEventListener('focusin', onFocus);

      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(el);
        const card = (id: string) => q(`[data-mini="${id}"]`);

        // Starting arrangement.
        for (const c of CARDS) gsap.set(card(c.id), { ...xy(BEFORE[c.id]) });
        gsap.set(card('rehearse'), { scale: 0, autoAlpha: 0 });
        gsap.set(q('.m-tag, .m-cursor, .m-digest, .m-keys, .m-cmd, .m-copy, .m-conflict, .m-caption, .m-q, .m-select'), { autoAlpha: 0 });

        // Idle life: the board floats and the cards breathe (paused by the Pause button).
        gsap.to(q('.iso-float'), { y: -14, duration: 3.2, ease: 'sine.inOut', repeat: -1, yoyo: true });
        gsap.to(q('.mini'), { z: 18, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true, stagger: { each: 0.25, from: 'random' } });

        // Pointer parallax on the whole stage.
        const rx = gsap.quickTo(q('.iso-tilt'), 'rotationX', { duration: 0.8, ease: 'power3.out' });
        const ry = gsap.quickTo(q('.iso-tilt'), 'rotationY', { duration: 0.8, ease: 'power3.out' });
        const onMove = (e: PointerEvent) => {
          rx(((e.clientY / innerHeight) - 0.5) * -10);
          ry(((e.clientX / innerWidth) - 0.5) * 14);
        };
        window.addEventListener('pointermove', onMove);

        // Hero title: words rise in once.
        gsap.from(q('.h-word'), { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.08, delay: 0.15 });
        gsap.from(q('.iso-plane'), { rotationX: 90, z: -400, autoAlpha: 0, duration: 1.6, ease: 'expo.out', delay: 0.2 });

        // The journey, scrubbed by scroll: one unit of time per section.
        const tl = gsap.timeline({
          defaults: { ease: 'power2.inOut' },
          scrollTrigger: { trigger: q('.story-text')[0], start: 'top top', end: 'bottom bottom', scrub: 0.8 },
        });
        tl.addLabel('hello', 0);

        // 0 → 1 Problem: the board settles a little and the cards shuffle overnight.
        tl.to(q('.iso-plane'), { rotationX: 38, rotationZ: -16, scale: 1, duration: 1 }, 0);
        tl.to(card('slides'), { ...xy(AFTER.slides), duration: 0.45 }, 0.25);
        tl.to(card('topic'), { ...xy(AFTER.topic), duration: 0.35 }, 0.3);
        tl.to(card('chat'), { ...xy(AFTER.chat), duration: 0.35 }, 0.33);
        tl.to(card('script'), { ...xy(AFTER.script), duration: 0.45 }, 0.45);
        tl.to(card('email'), { ...xy(AFTER.email), duration: 0.3 }, 0.55);
        tl.to(card('rehearse'), { ...xy(AFTER.rehearse), scale: 1, autoAlpha: 1, duration: 0.3 }, 0.62);
        tl.to(q('.m-q'), { autoAlpha: 1, scale: 1.1, stagger: 0.06, duration: 0.25 }, 0.7);
        tl.addLabel('problem', 1);

        // 1 → 2 Digest: the board faces you, cursors fly to each changed card, the digest writes itself.
        tl.to(q('.m-q'), { autoAlpha: 0, duration: 0.2 }, 1);
        tl.to(q('.iso-plane'), { rotationX: 0, rotationZ: 0, scale: 0.92, y: -30, duration: 0.6 }, 1);
        tl.fromTo(q('.m-cursor-r'), { x: 700, y: -60, autoAlpha: 0 }, { x: 560, y: 80, autoAlpha: 1, duration: 0.3 }, 1.25);
        tl.to(q('.m-cursor-r'), { x: 130, y: 162, duration: 0.25 }, 1.55);
        tl.fromTo(q('.m-cursor-a'), { x: -80, y: 420, autoAlpha: 0 }, { x: 330, y: 160, autoAlpha: 1, duration: 0.35 }, 1.4);
        tl.to(q('.m-tag'), { autoAlpha: 1, y: -4, stagger: 0.08, duration: 0.15 }, 1.45);
        tl.fromTo(q('.m-digest'), { autoAlpha: 0, y: 80, rotation: 4 }, { autoAlpha: 1, y: 0, rotation: -2, duration: 0.3 }, 1.6);
        tl.fromTo(q('.m-digest .line'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', stagger: 0.07, duration: 0.12, ease: 'none' }, 1.7);
        tl.addLabel('digest', 2);

        // 2 → 3 No dragging: keycaps press and the card walks across without a mouse.
        tl.to(q('.m-digest, .m-cursor'), { autoAlpha: 0, y: 30, duration: 0.2 }, 2);
        tl.to(q('.iso-plane'), { rotationX: 24, rotationZ: -8, scale: 0.86, y: -60, duration: 0.4 }, 2);
        tl.fromTo(q('.m-keys'), { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 0.25 }, 2.15);
        tl.to(q('.m-select'), { autoAlpha: 1, duration: 0.1 }, 2.3);
        const press = (k: string, at: number) =>
          tl.to(q(`.key-${k}`), { y: 8, boxShadow: '0 0 0 #0c0c16', duration: 0.05, yoyo: true, repeat: 1 }, at);
        press('space', 2.35);
        press('right', 2.5);
        tl.to(card('sources'), { ...xy({ col: 1, row: 2 }), duration: 0.12 }, 2.55);
        tl.to(q('.m-select'), { ...xy({ col: 1, row: 2 }), duration: 0.12 }, 2.55);
        press('right', 2.65);
        tl.to(card('sources'), { ...xy({ col: 2, row: 3 }), duration: 0.12 }, 2.7);
        tl.to(q('.m-select'), { ...xy({ col: 2, row: 3 }), duration: 0.12 }, 2.7);
        press('enter', 2.8);
        tl.fromTo(q('.m-cmd'), { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, duration: 0.15 }, 2.82);
        tl.fromTo(q('.m-cmd .typed'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.15, ease: 'none' }, 2.85);
        tl.addLabel('keys', 3);

        // 3 → 4 Merge: two copies swing in from either side and become one board.
        tl.to(q('.m-keys, .m-cmd, .m-select'), { autoAlpha: 0, y: 40, duration: 0.2 }, 3);
        tl.to(q('.iso-plane'), { scale: 0.62, rotationX: 20, rotationZ: 0, y: -10, duration: 0.3 }, 3);
        tl.fromTo(q('.m-copy-a'), { autoAlpha: 0, x: -360, rotationY: 50 }, { autoAlpha: 1, x: -170, rotationY: 18, duration: 0.3 }, 3.1);
        tl.fromTo(q('.m-copy-b'), { autoAlpha: 0, x: 360, rotationY: -50 }, { autoAlpha: 1, x: 170, rotationY: -18, duration: 0.3 }, 3.1);
        tl.to(q('.m-copy-a, .m-copy-b'), { x: 0, rotationY: 0, scale: 0.6, autoAlpha: 0, duration: 0.3, ease: 'power3.in' }, 3.5);
        tl.to(q('.iso-plane'), { scale: 0.95, duration: 0.25, ease: 'back.out(2)' }, 3.75);
        tl.fromTo(q('.m-conflict'), { autoAlpha: 0, scale: 0.4, rotation: -12 }, { autoAlpha: 1, scale: 1, rotation: 3, duration: 0.2, ease: 'back.out(2)' }, 3.8);
        tl.addLabel('merge', 4);

        // 4 → 5 Live: two people at once, read out as it happens.
        tl.to(q('.m-conflict'), { autoAlpha: 0, duration: 0.15 }, 4);
        tl.to(q('.iso-plane'), { rotationX: 30, rotationZ: -12, scale: 0.95, y: -20, duration: 0.3 }, 4);
        tl.fromTo(q('.m-cursor-r'), { x: 600, y: 360, autoAlpha: 0 }, { x: 140, y: 100, autoAlpha: 1, duration: 0.4 }, 4.15);
        tl.fromTo(q('.m-cursor-a'), { x: 40, y: -40, autoAlpha: 0 }, { x: 470, y: 250, autoAlpha: 1, duration: 0.45 }, 4.2);
        tl.to(card('email'), { ...xy({ col: 1, row: 2 }), duration: 0.25 }, 4.5);
        tl.fromTo(q('.m-caption'), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.2 }, 4.6);
        tl.addLabel('live', 5);

        // 5 → 7 Built, Start: the board rises back into its 3D pose.
        tl.to(q('.m-caption, .m-cursor'), { autoAlpha: 0, duration: 0.2 }, 5);
        tl.to(q('.iso-plane'), { rotationX: 55, rotationZ: -35, scale: 0.9, y: 0, duration: 1 }, 5.1);
        tl.to(q('.iso-plane'), { rotationZ: -15, duration: 1 }, 6.1);
        tl.addLabel('end', 7);

        api.current = {
          pause: (p) => {
            if (p) gsap.globalTimeline.pause();
            else gsap.globalTimeline.resume();
          },
          goTo: (i) => {
            const target = sections[i];
            if (target) lenis.scrollTo(target, { duration: 1.4 });
          },
        };

        cleanup = () => {
          window.removeEventListener('pointermove', onMove);
        };
      }, el);

      const prevCleanup = cleanup;
      cleanup = () => {
        prevCleanup();
        ctx.revert();
        el.removeEventListener('focusin', onFocus);
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    })();

    return () => {
      cancelled = true;
      io.disconnect();
      fit.disconnect();
      cleanup();
    };
  }, []);

  useEffect(() => api.current?.pause(paused), [paused]);

  return (
    <div className={`landing${paused ? ' is-paused' : ''}${moving.current ? '' : ' is-still'}`} ref={root}>
      <header className="l-top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28"><rect x="3" y="5" width="7" height="22" rx="2" /><rect x="12.5" y="5" width="7" height="14" rx="2" /><rect x="22" y="5" width="7" height="18" rx="2" /><path d="M2 28.5h28" strokeWidth="2.4" strokeLinecap="round" /></svg>
          </span>
          <span className="brand-name">Handrail</span>
        </div>
        <div className="l-actions">
          <button type="button" className="btn btn-primary" onClick={onEnter} id="enter-board">
            Open the board
          </button>
          {moving.current && (
            <button type="button" className="btn btn-secondary" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
              Pause animation
            </button>
          )}
        </div>
      </header>

      <div className="story">
        <main className="story-text" id="story">
          <section className="scene s-hello" aria-labelledby="sc-hello">
            <p className="kicker">A project board for every way of working</p>
            <h1 id="sc-hello" className="hero-title">
              {['Never', 'hunt', 'for', 'what', 'changed.'].map((w, i) => (
                <Fragment key={w}>
                  {i > 0 && ' '}
                  <span className="h-line">
                    <span className="h-word">{w}</span>
                  </span>
                </Fragment>
              ))}
            </h1>
            <p className="lede">
              Handrail tells you in plain words what your teammates changed since you last looked, with what involves you first. It works without dragging,
              without a mouse and without seeing the screen.
            </p>
            <div className="hero-actions">
              <button type="button" className="btn btn-secondary big" onClick={onChallenge}>
                Try it with your eyes closed
              </button>
            </div>
            <p className="scroll-hint" aria-hidden="true">Scroll to see how ↓</p>
          </section>

          <section className="scene" aria-labelledby="sc-problem">
            <p className="kicker">01 · The problem</p>
            <h2 id="sc-problem">Your group moved four cards overnight. Which ones?</h2>
            <p>
              On most boards you find out by scanning every column. That is slow for everyone, and with a screen reader it means stepping through every
              card to notice one difference.
            </p>
          </section>

          <section className="scene" aria-labelledby="sc-digest">
            <p className="kicker">02 · Since you last looked</p>
            <h2 id="sc-digest">Handrail does the scanning for you.</h2>
            <p>
              Open a teammate’s link and get one short paragraph: “Riya gave you Email Dr. Mehta, moved Design slides to Done and added Rehearse on call.
              Arjun moved Write the script to Doing.” Changed cards carry a name tag, so sighted teammates see the same story.
            </p>
          </section>

          <section className="scene" aria-labelledby="sc-keys">
            <p className="kicker">03 · No dragging</p>
            <h2 id="sc-keys">Move cards with keys, a menu or a sentence.</h2>
            <p>
              Space picks a card up, arrows move it, Enter drops it. Number keys send it straight to a column. Or type or say “move find sources to done”:
              Handrail shows what it will do before it does it, and every move is read out.
            </p>
          </section>

          <section className="scene" aria-labelledby="sc-merge">
            <p className="kicker">04 · Merge, don’t overwrite</p>
            <h2 id="sc-merge">Two copies. One board. Nobody’s work lost.</h2>
            <p>
              Every board is a conflict-free replicated document. Edit separately, swap links in any order, and the copies merge the same way on every
              device. If two people changed the same thing, Handrail says so in a sentence.
            </p>
          </section>

          <section className="scene" aria-labelledby="sc-live">
            <p className="kicker">05 · Live</p>
            <h2 id="sc-live">Or work at the same time.</h2>
            <p>
              Start a live session and browsers connect to each other directly. Each teammate’s edit lands on your board and is read out as it happens: “Riya
              moved Design slides to Done.” There is no account and no Handrail server.
            </p>
          </section>

          <section className="scene" aria-labelledby="sc-built">
            <p className="kicker">06 · Built to be trusted</p>
            <h2 id="sc-built">Tested like it matters.</h2>
            <ul className="stats">
              <li><strong>150+</strong> automated tests, including random multi-person edit histories</li>
              <li><strong>0</strong> automated WCAG 2.2 AA violations, in three themes and at 200% text</li>
              <li><strong>100%</strong> usable by keyboard, menu, typed or spoken commands</li>
              <li><strong>0</strong> accounts, trackers or servers holding your boards</li>
            </ul>
          </section>

          <section className="scene s-start" aria-labelledby="sc-start">
            <h2 id="sc-start" className="end-title">Open your board.</h2>
            <p>It opens with a sample group project. Click the board name and choose “Simulate teammates’ changes” to see the story for real.</p>
            <button type="button" className="btn btn-primary big" onClick={onEnter}>
              Open the board
            </button>
          </section>
        </main>

        <div className="story-stage" aria-hidden="true">
          <div className="stage-sticky">
            <div className="iso">
              <div className="iso-tilt">
                <div className="iso-float">
                  <div className="iso-plane">
                    {COLS.map((c, i) => (
                      <div key={c} className="m-col" style={{ left: i * 212 }}>
                        <span>{String(i + 1).padStart(2, '0')}</span> {c}
                      </div>
                    ))}
                    {CARDS.map((c) => (
                      <div key={c.id} className="mini" data-mini={c.id} style={place(AFTER[c.id])}>
                        <b>{c.title}</b>
                        <i>
                          {c.badge && <em className={c.badge === 'Overdue' ? 'od' : ''}>{c.badge}</em>}
                          {c.who && <u className={c.pc}>{c.who}</u>}
                        </i>
                        {['slides', 'script', 'email', 'rehearse'].includes(c.id) && (
                          <span className={`m-tag ${c.id === 'script' ? 'p4' : 'p2'}`}>
                            <CursorIcon size={11} /> {c.id === 'script' ? 'Arjun' : 'Riya'}
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="m-select" style={place(BEFORE.sources)} />
                    <span className="m-q" style={{ left: 150, top: 120 }}>?</span>
                    <span className="m-q" style={{ left: 380, top: 200 }}>?</span>
                    <span className="m-q" style={{ left: 560, top: 90 }}>?</span>
                    <div className="m-cursor m-cursor-r p2"><CursorIcon size={26} /><span>Riya</span></div>
                    <div className="m-cursor m-cursor-a p4"><CursorIcon size={26} /><span>Arjun</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="m-digest">
              <b className="line">Since you last looked · <em>4</em></b>
              <span className="line">Riya gave you “Email Dr. Mehta”,</span>
              <span className="line">moved “Design slides” to Done</span>
              <span className="line">and added “Rehearse on call”.</span>
              <span className="line">Arjun moved “Write the script” to Doing.</span>
            </div>

            <div className="m-keys">
              <span className="key key-space">Space</span>
              <span className="key key-right">→</span>
              <span className="key key-enter">Enter</span>
            </div>
            <div className="m-cmd">
              <span className="prompt">›</span> <span className="typed">move find sources to done</span>
            </div>

            <div className="m-copy m-copy-a"><b>Priya’s copy</b><span /><span /><span /></div>
            <div className="m-copy m-copy-b"><b>Riya’s copy</b><span /><span /><span /></div>
            <div className="m-conflict">Both changed the due date · kept the later edit</div>

            <div className="m-caption">🔊 Riya moved “Design slides” to Done.</div>
          </div>
        </div>
      </div>

      <nav className="ruler" aria-label="Story sections">
        <ol>
          {SCENES.map((s, i) => (
            <li key={s.id}>
              <button type="button" aria-current={active === i ? 'step' : undefined} onClick={() => api.current?.goTo(i)}>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <div className="ticks" aria-hidden="true" />
      </nav>
    </div>
  );
}

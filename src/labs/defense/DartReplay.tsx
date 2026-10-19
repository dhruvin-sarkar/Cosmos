import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '../../ui/components/Button';
import { CHAPTER_START, DartScene, REPLAY_DURATION_S, chapterAt, timeAt, type DartFrameInfo, type DartOrbitParams } from './dartScene';
import { clock, dist, fixed, minutes } from './format';

const CHAPTERS = ['Approach', 'Impact and ejecta', 'Orbit change'] as const;

export interface DartReplayProps {
  params: DartOrbitParams;
  deltaPeriodS: number;
  reduced: boolean;
}

/** The DART replay viewport: own three.js canvas, HTML labels, a timeline and chapter buttons. */
export function DartReplay({ params, deltaPeriodS, reduced }: DartReplayProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<DartScene | null>(null);
  const clockRef = useRef<HTMLParagraphElement | null>(null);
  const lineRef = useRef<HTMLParagraphElement | null>(null);
  const scrubRef = useRef<HTMLInputElement | null>(null);
  const labelRefs = {
    didymos: useRef<HTMLSpanElement | null>(null),
    dimorphos: useRef<HTMLSpanElement | null>(null),
    dart: useRef<HTMLSpanElement | null>(null),
    ghost: useRef<HTMLSpanElement | null>(null),
  };
  const uRef = useRef(reduced ? 0.5 : 0);
  const playingRef = useRef(!reduced);
  const dirtyRef = useRef(true);
  const [playing, setPlaying] = useState(!reduced);
  const [chapter, setChapter] = useState<0 | 1 | 2>(chapterAt(uRef.current));
  const [shapes, setShapes] = useState<'loading' | 'real' | 'fallback'>('loading');
  const [failed, setFailed] = useState(false);
  const paramsRef = useRef(params);
  const dpRef = useRef(deltaPeriodS);
  dpRef.current = deltaPeriodS;

  useEffect(() => {
    paramsRef.current = params;
    sceneRef.current?.setParams(params);
    dirtyRef.current = true;
  }, [params]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // A fresh canvas per mount: a canvas whose context was lost (StrictMode remount) cannot host a new renderer.
    const canvas = document.createElement('canvas');
    canvas.className = 'cx-dfn-replay__canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Replay of the DART spacecraft hitting Dimorphos, the moon of asteroid Didymos, and the change in its orbit');
    box.prepend(canvas);
    let scene: DartScene;
    try {
      scene = new DartScene(canvas, paramsRef.current, real => setShapes(real ? 'real' : 'fallback'));
    } catch {
      canvas.remove();
      setFailed(true);
      return;
    }
    sceneRef.current = scene;
    scene.setLabels({
      didymos: labelRefs.didymos.current, dimorphos: labelRefs.dimorphos.current, dart: labelRefs.dart.current, ghost: labelRefs.ghost.current,
    });
    const ro = new ResizeObserver(() => {
      const r = box.getBoundingClientRect();
      scene.resize(Math.round(r.width), Math.round(r.height));
      dirtyRef.current = true;
    });
    ro.observe(box);
    const info: DartFrameInfo = { ts: 0, dartDistanceM: NaN, leadDeg: 0, chapter: 0 };
    let raf = 0, last = performance.now(), lastClock = '', lastLine = '', lastCh = -1;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      if (playingRef.current) {
        uRef.current = Math.min(1, uRef.current + dt / REPLAY_DURATION_S);
        dirtyRef.current = true;
        if (uRef.current >= 1) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      scene.render(uRef.current, info);
      const c = clock(info.ts);
      if (c !== lastClock && clockRef.current) clockRef.current.textContent = lastClock = c;
      let line: string;
      if (info.chapter === 0) line = `DART is ${dist(info.dartDistanceM)} from Dimorphos, closing at ${fixed(paramsRef.current.impactSpeedMS / 1000, 2)} km/s`;
      else if (info.chapter === 1) line = 'Ejecta thrown off the surface carry away momentum and push Dimorphos further';
      else line = `Dimorphos runs ${fixed(info.leadDeg, 0)}° ahead of where it would be without DART: each orbit is ${minutes(Math.abs(dpRef.current))} shorter`;
      if (line !== lastLine && lineRef.current) lineRef.current.textContent = lastLine = line;
      const s = scrubRef.current;
      if (s) {
        const v = String(Math.round(uRef.current * 1000));
        if (s.value !== v) s.value = v;
        s.setAttribute('aria-valuetext', `${CHAPTERS[info.chapter]}, ${c}`);
      }
      if (info.chapter !== lastCh) {
        lastCh = info.chapter;
        setChapter(info.chapter);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPlay = (p: boolean): void => {
    if (p && uRef.current >= 1) uRef.current = 0;
    playingRef.current = p;
    setPlaying(p);
    dirtyRef.current = true;
  };
  const seek = (u: number): void => {
    uRef.current = Math.min(1, Math.max(0, u));
    dirtyRef.current = true;
  };
  const jump = (i: 0 | 1 | 2): void => {
    // Land a little into the chapter so each one opens on something to see.
    const offs = [0.0, 0.03, 0.08][i];
    seek(CHAPTER_START[i] + offs);
    if (reduced) setPlay(false);
  };

  return (
    <div className="cx-dfn-replay">
      <div className="cx-dfn-replay__stage" ref={boxRef}>
        <span ref={labelRefs.didymos} className="cx-dfn-tag">Didymos</span>
        <span ref={labelRefs.dimorphos} className="cx-dfn-tag">Dimorphos</span>
        <span ref={labelRefs.dart} className="cx-dfn-tag">DART</span>
        <span ref={labelRefs.ghost} className="cx-dfn-tag cx-dfn-tag--ghost">Without DART</span>
        <div className="cx-dfn-hud" aria-live="off">
          <p className="cx-dfn-hud__chapter">{CHAPTERS[chapter]}</p>
          <p className="cx-dfn-hud__clock cx-num" ref={clockRef}>{clock(timeAt(uRef.current))}</p>
          <p className="cx-dfn-hud__line" ref={lineRef} />
        </div>
        {failed && <p className="cx-dfn-replay__error">The 3D replay needs WebGL, which isn't available here. The numbers on the left still apply.</p>}
      </div>
      <div className="cx-dfn-controls">
        <Button size="md" variant="secondary" icon={playing ? Pause : Play} onClick={() => setPlay(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="md" variant="quiet" icon={RotateCcw} onClick={() => { seek(0); setPlay(!reduced); }}>Restart</Button>
        <div className="cx-dfn-chapters" role="group" aria-label="Replay chapters">
          {CHAPTERS.map((c, i) => (
            <Button key={c} size="md" variant="quiet" pressed={chapter === i} onClick={() => jump(i as 0 | 1 | 2)}>{c}</Button>
          ))}
        </div>
        <input ref={scrubRef} className="cx-dfn-scrub" type="range" min={0} max={1000} step={1} defaultValue={Math.round(uRef.current * 1000)}
          aria-label="Replay position" onInput={e => seek(Number((e.target as HTMLInputElement).value) / 1000)}
          onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); setPlay(!playingRef.current); } }} />
      </div>
      <p className="cx-dfn-credit">
        Shapes: {shapes === 'fallback' ? 'illustrative stand-ins (the DART shape models did not load)' : 'DART global shape models of Didymos and Dimorphos (Daly et al. 2023, 2024; NASA PDS)'}.
        Approach direction, lighting and plume shape are reconstructed for illustration; sizes, distances, speed and the orbit change are to scale.
      </p>
    </div>
  );
}

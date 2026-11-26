'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { formatMs, formatMediaTime } from '@/lib/review-anchor';

/** Shared transport for Review Room and recorded demonstrations. The children are
 * the picture/annotation surface; every transport control is its following sibling.
 * Neither preview contract supplies FPS: the small steps are labelled as time, not
 * presented as exact source frames. This never owns an artifact or preview token. */
export default function ReviewPlaybackControls({ mediaRef, mediaKey, onSeek, children, timeline, trailingAction, variant }: {
  mediaRef: RefObject<HTMLMediaElement>;
  mediaKey: string;
  variant?: 'teaching'|'finished';
  timeline?: ReactNode|((clock:{durationMs:number;playheadMs:number})=>ReactNode);
  trailingAction?: ReactNode;
  onSeek: (ms: number) => void;
  children: ReactNode | ((revealOutside: (action: () => void) => void) => ReactNode);
}) {
  const playerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ paused: true, time: 0, duration: 0, volume: 1, muted: false, seeking: false, rate:1 });
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const pendingOutsideAction = useRef<(() => void) | null>(null);

  function finishOutsideAction() {
    const action = pendingOutsideAction.current;
    pendingOutsideAction.current = null;
    action?.();
  }

  async function exitForOutsideAction() {
    const expectedAction = pendingOutsideAction.current;
    // Never exit another component's fullscreen. The frozen gesture waits here
    // until OUR fullscreen has actually ended, including a later user Escape.
    if (document.fullscreenElement !== playerRef.current) { finishOutsideAction(); return; }
    try {
      await document.exitFullscreen();
      if (pendingOutsideAction.current !== expectedAction) return;
      if (document.fullscreenElement !== playerRef.current) finishOutsideAction();
      else setError('Your feedback is preserved. Exit fullscreen to write it.');
    } catch { setError('Your feedback is preserved. Exit fullscreen to write it.'); }
  }

  function revealOutside(action: () => void) {
    if (pendingOutsideAction.current) return; // Keep the first frozen gesture.
    if (document.fullscreenElement !== playerRef.current) { action(); return; }
    pendingOutsideAction.current = action;
    setError(null);
    void exitForOutsideAction();
  }

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const sync = () => setState({
      paused: media.paused || media.ended,
      time: Number.isFinite(media.currentTime) ? media.currentTime : 0,
      duration: Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0,
      volume: media.volume, muted: media.muted, seeking: media.seeking, rate:media.playbackRate||1,
    });
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'seeking', 'seeked', 'emptied', 'ratechange'];
    for (const event of events) media.addEventListener(event, sync);
    const onFullscreen = () => {
      const ours = document.fullscreenElement === playerRef.current;
      setFullscreen(ours);
      if (!ours && pendingOutsideAction.current) { setError(null); finishOutsideAction(); }
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    setCanFullscreen(typeof playerRef.current?.requestFullscreen === 'function' && document.fullscreenEnabled !== false);
    sync();
    return () => {
      for (const event of events) media.removeEventListener(event, sync);
      document.removeEventListener('fullscreenchange', onFullscreen);
      pendingOutsideAction.current = null;
    };
  }, [mediaRef, mediaKey]);

  // Teaching pages: Space plays and pauses from anywhere on the page, except while
  // typing or when a button, link, slider or dialog owns the key. The focused-player
  // handler below runs first and marks the event handled, so it never toggles twice.
  useEffect(() => {
    if (variant !== 'teaching') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest('input,textarea,select,button,a,summary,[role="button"],[role="slider"],[role="dialog"]'))) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const media = mediaRef.current;
      if (!media) return;
      event.preventDefault();
      if (!media.paused && !media.ended) { media.pause(); return; }
      setError(null);
      void media.play().catch(() => setError('Playback could not start. Try Play again.'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mediaRef, mediaKey, variant]);

  async function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;
    setError(null);
    if (!media.paused && !media.ended) { media.pause(); return; }
    try { await media.play(); }
    catch { setError('Playback could not start. Try Play again.'); }
  }

  function seek(seconds: number) {
    const media = mediaRef.current;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0 || !Number.isFinite(seconds)) return;
    const time = Math.max(0, Math.min(media.duration, seconds));
    onSeek(time * 1000);
    setState((current) => ({ ...current, time, seeking: true }));
  }

  function step(direction: -1 | 1) {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    seek(media.currentTime + direction / 30);
  }

  async function toggleFullscreen() {
    setError(null);
    if (pendingOutsideAction.current) { await exitForOutsideAction(); return; }
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen();
      else await playerRef.current?.requestFullscreen();
    } catch { setError('Fullscreen could not open. You can keep reviewing here.'); }
  }

  const buttonClass = 'rounded border border-ink-700 px-2 py-1.5 text-secondary text-ink-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40';
  const secondaryButtonClass = buttonClass + ' hover:bg-ink-800';
  return (
    <div
      ref={playerRef}
      data-testid="review-playback"
      data-variant={variant}
      role="group"
      aria-label="Video player"
      tabIndex={0}
      className="review-playback rounded bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
      onKeyDown={(event) => {
        // A focused picture container gets Space. Buttons, annotation keys, sliders
        // and editable descendants keep their own keyboard behaviour. No window hook.
        if (event.target !== event.currentTarget || event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === ' ') { event.preventDefault(); void togglePlayback(); }
      }}
    >
      {typeof children === 'function' ? children(revealOutside) : children}
      <div data-testid="playback-controls" role="group" aria-label="Playback controls" className="playback-deck space-y-3 rounded-b border border-ink-700 bg-ink-900 p-4">
        {typeof timeline==='function'?timeline({durationMs:Math.round(state.duration*1000),playheadMs:Math.round(state.time*1000)}):timeline}
        <input
          type="range" aria-label="Seek video" min={0} max={state.duration || 0} step="any"
          value={Math.min(state.time, state.duration)} disabled={!state.duration}
          aria-valuetext={`${formatMs(Math.round(state.time * 1000))} of ${formatMs(Math.round(state.duration * 1000))}`}
          className={timeline ? 'sr-only focus:not-sr-only' : 'w-full accent-[var(--action-strong)]'}
          onChange={(event) => seek(Number(event.currentTarget.value))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass + ' playback-toggle'} aria-label={state.paused ? 'Play' : 'Pause'} onClick={() => void togglePlayback()}>{state.paused ? 'Play' : 'Pause'}</button>
          <button type="button" className={secondaryButtonClass} aria-label="Step back 1/30 second" title="Time step; exact source frame rate is unavailable" disabled={!state.duration} onClick={() => step(-1)}>{variant?'‹':'−1/30 s'}</button>
          <button type="button" className={secondaryButtonClass} aria-label="Step forward 1/30 second" title="Time step; exact source frame rate is unavailable" disabled={!state.duration} onClick={() => step(1)}>{variant?'›':'+1/30 s'}</button>
          <span className="font-mono text-micro text-ink-400" title={`${formatMs(Math.round(state.time*1000))} / ${formatMs(Math.round(state.duration*1000))}`}>{(variant?formatMediaTime:formatMs)(Math.round(state.time * 1000))} / {(variant?formatMediaTime:formatMs)(Math.round(state.duration * 1000))}</span>
          <div className="playback-speeds" role="group" aria-label="Playback speed">{[.5,1,2].map(rate=><button key={rate} type="button" aria-pressed={state.rate===rate} onClick={()=>{const media=mediaRef.current;if(media){media.playbackRate=rate;setState(current=>({...current,rate}));}}}>{rate}×</button>)}</div>
          <button type="button" className={secondaryButtonClass} aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={() => { const media = mediaRef.current; if (media) media.muted = !media.muted; }}>{variant?(state.muted?'Sound off':'Sound on'):(state.muted ? 'Unmute' : 'Mute')}</button>
          <label className="playback-volume">{variant&&<span>Volume</span>}<input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={state.muted ? 0 : state.volume}
            className="w-20 accent-[var(--action-strong)]" onChange={(event) => { const media = mediaRef.current; if (media) { media.volume = Number(event.currentTarget.value); media.muted = false; } }} /></label>
          <button type="button" className={secondaryButtonClass} disabled={!canFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
          {trailingAction}
          {state.seeking && <span role="status" className="text-secondary text-ink-400">Seeking…</span>}
        </div>
        {error && <p role="alert" className="text-secondary text-state-fail">{error}</p>}
      </div>
    </div>
  );
}

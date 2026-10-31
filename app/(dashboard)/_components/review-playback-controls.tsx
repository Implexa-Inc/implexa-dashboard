'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { formatMs } from '@/lib/review-anchor';

/** Shared transport for Review Room and recorded demonstrations. The children are
 * the picture/annotation surface; every transport control is its following sibling.
 * Neither preview contract supplies FPS: the small steps are labelled as time, not
 * presented as exact source frames. This never owns an artifact or preview token. */
export default function ReviewPlaybackControls({ mediaRef, mediaKey, onSeek, children }: {
  mediaRef: RefObject<HTMLMediaElement>;
  mediaKey: string;
  onSeek: (ms: number) => void;
  children: ReactNode;
}) {
  const playerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ paused: true, time: 0, duration: 0, volume: 1, muted: false, seeking: false });
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const sync = () => setState({
      paused: media.paused || media.ended,
      time: Number.isFinite(media.currentTime) ? media.currentTime : 0,
      duration: Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0,
      volume: media.volume, muted: media.muted, seeking: media.seeking,
    });
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'seeking', 'seeked', 'emptied'];
    for (const event of events) media.addEventListener(event, sync);
    const onFullscreen = () => setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    setCanFullscreen(typeof playerRef.current?.requestFullscreen === 'function' && document.fullscreenEnabled !== false);
    sync();
    return () => {
      for (const event of events) media.removeEventListener(event, sync);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [mediaRef, mediaKey]);

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
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen();
      else await playerRef.current?.requestFullscreen();
    } catch { setError('Fullscreen could not open. You can keep reviewing here.'); }
  }

  const buttonClass = 'rounded border border-ink-700 px-2 py-1.5 text-xs text-ink-200 hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40';
  return (
    <div
      ref={playerRef}
      data-testid="review-playback"
      role="group"
      aria-label="Video player"
      tabIndex={0}
      className="rounded bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
      onKeyDown={(event) => {
        // A focused picture container gets Space. Buttons, annotation keys, sliders
        // and editable descendants keep their own keyboard behaviour. No window hook.
        if (event.target !== event.currentTarget || event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === ' ') { event.preventDefault(); void togglePlayback(); }
      }}
    >
      {children}
      <div data-testid="playback-controls" role="group" aria-label="Playback controls" className="space-y-2 rounded-b border border-ink-800 bg-ink-950 p-3">
        <input
          type="range" aria-label="Seek video" min={0} max={state.duration || 0} step="any"
          value={Math.min(state.time, state.duration)} disabled={!state.duration}
          aria-valuetext={`${formatMs(Math.round(state.time * 1000))} of ${formatMs(Math.round(state.duration * 1000))}`}
          className="w-full accent-sky-400"
          onChange={(event) => seek(Number(event.currentTarget.value))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass} aria-label={state.paused ? 'Play' : 'Pause'} onClick={() => void togglePlayback()}>{state.paused ? 'Play' : 'Pause'}</button>
          <button type="button" className={buttonClass} aria-label="Step back 1/30 second" title="Time step; exact source frame rate is unavailable" disabled={!state.duration} onClick={() => step(-1)}>−1/30 s</button>
          <button type="button" className={buttonClass} aria-label="Step forward 1/30 second" title="Time step; exact source frame rate is unavailable" disabled={!state.duration} onClick={() => step(1)}>+1/30 s</button>
          <span className="font-mono text-xs text-ink-400">{formatMs(Math.round(state.time * 1000))} / {formatMs(Math.round(state.duration * 1000))}</span>
          <button type="button" className={buttonClass} aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={() => { const media = mediaRef.current; if (media) media.muted = !media.muted; }}>{state.muted ? 'Unmute' : 'Mute'}</button>
          <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={state.muted ? 0 : state.volume}
            className="w-20 accent-sky-400" onChange={(event) => { const media = mediaRef.current; if (media) { media.volume = Number(event.currentTarget.value); media.muted = false; } }} />
          <button type="button" className={buttonClass} disabled={!canFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
          {state.seeking && <span role="status" className="text-xs text-ink-400">Seeking…</span>}
        </div>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      </div>
    </div>
  );
}

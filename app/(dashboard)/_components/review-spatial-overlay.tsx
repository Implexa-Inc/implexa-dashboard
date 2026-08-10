'use client';

/**
 * <ReviewSpatialOverlay /> — click/drag annotation over the image and video players.
 *
 * RULES THIS COMPONENT ENFORCES:
 *
 *  * The overlay sits over the ELEMENT, but every position is normalized against the
 *    VISUAL CONTENT rect (object-fit: contain letterbox math in
 *    lib/review-spatial-geometry). A press on a letterbox bar marks nothing.
 *  * FREEZE AT POINTER-DOWN. For video the parent pauses the player and reads the
 *    exact timestamp synchronously in the pointer-down handler — before any await,
 *    before React commits anything — so what is frozen is the frame the reviewer saw
 *    when their finger went down, not wherever playback drifted by pointer-up.
 *  * A press-and-release under the drag threshold is a POINT; travel beyond it is a
 *    RECT. The threshold is documented in lib/review-spatial-geometry
 *    (DRAG_THRESHOLD_PX) and tested there, not re-derived here.
 *  * NATIVE CONTROLS STAY NATIVE. For video the overlay leaves a bottom band
 *    (CONTROLS_EXCLUSION_PX) uncovered, so the transport, the timeline and the
 *    fullscreen button receive their clicks untouched — and the hover cue can never
 *    appear over them.
 *  * KEYBOARD ACCESS IS A REAL PATH, not a fallback: the overlay is focusable; Enter
 *    places a point at the center of the content; arrow keys nudge an unsaved point
 *    by 1% (10% with Shift); Escape cancels the unsaved annotation.
 *  * The overlay renders pins and rectangles from NORMALIZED geometry each frame, so
 *    responsive resizes and fullscreen changes move the drawing with the picture —
 *    the saved coordinates never change, only their projection does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DRAG_THRESHOLD_PX, isDragGesture, normalizedPointFromClient, normalizedRectFromDrag,
  nudgeNormalizedPoint, overlayStyleForGeometry, visualContentRect,
} from '@/lib/review-spatial-geometry';
import type { DraftSpatial } from '@/lib/review-timestamp-feedback';

/** The strip the native video controls live in. The overlay never covers it. */
export const CONTROLS_EXCLUSION_PX = 48;

export const OVERLAY_ARIA_LABEL =
  'Add visual feedback. Press Enter to place a point at the center, then use the arrow keys to move it.';

export const SPATIAL_HINT_COPY =
  'Click anywhere on the image or video to leave visual feedback. Drag to mark an area.';

export const ADD_FEEDBACK_CUE = 'Add feedback here';

export type OverlayPin = {
  issueId: string;
  /** 1-based number shown in the pin, stable within this artifact's rail order. */
  ordinal: number;
  geometry: { kind: 'point' | 'rect'; x: number; y: number; width: number | null; height: number | null };
  /** The currently opened issue renders emphasized. */
  highlighted: boolean;
  title: string;
};

type MediaState = { elementRect: DOMRect; naturalWidth: number; naturalHeight: number };

export default function ReviewSpatialOverlay(props: {
  mediaKind: 'video' | 'image';
  /** The live media element — measured at event time, never cached across renders. */
  mediaEl: () => HTMLVideoElement | HTMLImageElement | null;
  enabled: boolean;
  pins: OverlayPin[];
  /** The unsaved annotation being composed, drawn live. */
  draftSpatial: DraftSpatial | null;
  /**
   * FREEZE. Called synchronously at pointer-down (or Enter). For video it must pause
   * the player and return the exact current timestamp in ms; for an image it returns
   * null. This is the one moment the timestamp is read.
   */
  freezeMedia: () => number | null;
  /** A completed gesture: geometry + the dimensions it was normalized against. */
  onAnnotate: (args: { spatial: DraftSpatial; frozenTimestampMs: number | null }) => void;
  /** Arrow-key nudge of the unsaved point. */
  onNudgeDraft: (next: { x: number; y: number }) => void;
  onCancelDraft: () => void;
  onOpenIssue: (issueId: string) => void;
}) {
  const {
    mediaKind, mediaEl, enabled, pins, draftSpatial,
    freezeMedia, onAnnotate, onNudgeDraft, onCancelDraft, onOpenIssue,
  } = props;

  // The element's box + intrinsic size, refreshed by resize/metadata — pins project
  // through this. Gesture math NEVER reads it: each gesture re-measures at its own
  // pointer-down so a scroll or resize mid-hover cannot skew a fresh press.
  const [media, setMedia] = useState<{ width: number; height: number; naturalWidth: number; naturalHeight: number } | null>(null);

  const measure = useCallback(() => {
    const el = mediaEl();
    if (!el) { setMedia(null); return; }
    const rect = el.getBoundingClientRect();
    const naturalWidth = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const naturalHeight = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!rect.width || !rect.height || !naturalWidth || !naturalHeight) { setMedia(null); return; }
    setMedia({ width: rect.width, height: rect.height, naturalWidth, naturalHeight });
  }, [mediaEl]);

  useEffect(() => {
    measure();
    const el = mediaEl();
    if (!el) return;
    const events = el instanceof HTMLVideoElement ? ['loadedmetadata', 'resize'] : ['load'];
    for (const ev of events) el.addEventListener(ev, measure);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
    }
    return () => {
      for (const ev of events) el.removeEventListener(ev, measure);
      if (ro) ro.disconnect();
      else if (typeof window !== 'undefined') window.removeEventListener('resize', measure);
    };
  }, [mediaEl, measure]);

  /** One synchronous read of everything a gesture needs. Null = no annotatable media. */
  const mediaStateNow = useCallback((): MediaState | null => {
    const el = mediaEl();
    if (!el) return null;
    const elementRect = el.getBoundingClientRect();
    const naturalWidth = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const naturalHeight = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!elementRect.width || !elementRect.height || !naturalWidth || !naturalHeight) return null;
    return { elementRect, naturalWidth, naturalHeight };
  }, [mediaEl]);

  // The in-flight gesture. A ref, not state: pointermove must read the values the
  // pointer-down wrote in the same event turn, and the frozen timestamp must survive
  // exactly as captured.
  const gestureRef = useRef<{
    startClientX: number; startClientY: number;
    state: MediaState;
    frozenTimestampMs: number | null;
  } | null>(null);
  // Live drag marquee, in overlay-local CSS px — presentation only.
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // The hover cue: shown only while the pointer is over actual visual content.
  const [cue, setCue] = useState<{ x: number; y: number } | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    // Only the primary button places annotations; right-click keeps its native menu.
    if (e.button !== 0) return;
    const state = mediaStateNow();
    if (!state) return;
    // Reject a press that starts outside the visible content BEFORE freezing anything
    // — pausing the video for a click on the letterbox would be an annotation-shaped
    // side effect for a gesture that marks nothing.
    const point = normalizedPointFromClient({
      clientX: e.clientX, clientY: e.clientY,
      elementRect: state.elementRect,
      naturalWidth: state.naturalWidth, naturalHeight: state.naturalHeight,
    });
    if (!point) return;
    // THE FREEZE. Synchronous, before anything else: pause + exact timestamp.
    const frozenTimestampMs = freezeMedia();
    gestureRef.current = {
      startClientX: e.clientX, startClientY: e.clientY,
      state, frozenTimestampMs,
    };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* jsdom */ }
  }, [enabled, mediaStateNow, freezeMedia]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g) {
      // Not mid-gesture: this is hover. The cue appears over visual content only.
      if (!enabled) return;
      const state = mediaStateNow();
      const over = state && normalizedPointFromClient({
        clientX: e.clientX, clientY: e.clientY,
        elementRect: state.elementRect,
        naturalWidth: state.naturalWidth, naturalHeight: state.naturalHeight,
      });
      if (!over || !overlayRef.current) { setCue(null); return; }
      const box = overlayRef.current.getBoundingClientRect();
      setCue({ x: e.clientX - box.left, y: e.clientY - box.top });
      return;
    }
    if (!isDragGesture({
      startClientX: g.startClientX, startClientY: g.startClientY,
      endClientX: e.clientX, endClientY: e.clientY,
    })) { setMarquee(null); return; }
    const box = overlayRef.current?.getBoundingClientRect();
    if (!box) return;
    setMarquee({
      left: Math.min(g.startClientX, e.clientX) - box.left,
      top: Math.min(g.startClientY, e.clientY) - box.top,
      width: Math.abs(e.clientX - g.startClientX),
      height: Math.abs(e.clientY - g.startClientY),
    });
  }, [enabled, mediaStateNow]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setMarquee(null);
    if (!g) return;
    const { state, frozenTimestampMs } = g;
    const sourceFrame = { visualWidth: state.naturalWidth, visualHeight: state.naturalHeight };
    if (isDragGesture({
      startClientX: g.startClientX, startClientY: g.startClientY,
      endClientX: e.clientX, endClientY: e.clientY,
    })) {
      const rect = normalizedRectFromDrag({
        startClientX: g.startClientX, startClientY: g.startClientY,
        endClientX: e.clientX, endClientY: e.clientY,
        elementRect: state.elementRect,
        naturalWidth: state.naturalWidth, naturalHeight: state.naturalHeight,
      });
      if (!rect) return;
      onAnnotate({
        spatial: {
          geometry: { kind: 'rect', x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          sourceFrame,
        },
        frozenTimestampMs,
      });
      return;
    }
    // A point uses the DOWN position: the aim is where the finger landed, and the
    // sub-threshold wobble before release is noise, not intent.
    const point = normalizedPointFromClient({
      clientX: g.startClientX, clientY: g.startClientY,
      elementRect: state.elementRect,
      naturalWidth: state.naturalWidth, naturalHeight: state.naturalHeight,
    });
    if (!point) return;
    onAnnotate({
      spatial: {
        geometry: { kind: 'point', x: point.x, y: point.y, width: null, height: null },
        sourceFrame,
      },
      frozenTimestampMs,
    });
  }, [onAnnotate]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      gestureRef.current = null;
      setMarquee(null);
      onCancelDraft();
      return;
    }
    if (!enabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const state = mediaStateNow();
      if (!state) return;
      const frozenTimestampMs = freezeMedia();
      onAnnotate({
        spatial: {
          geometry: { kind: 'point', x: 0.5, y: 0.5, width: null, height: null },
          sourceFrame: { visualWidth: state.naturalWidth, visualHeight: state.naturalHeight },
        },
        frozenTimestampMs,
      });
      return;
    }
    if (draftSpatial && draftSpatial.geometry.kind === 'point') {
      const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down'
        : e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : null;
      if (dir) {
        e.preventDefault();
        onNudgeDraft(nudgeNormalizedPoint(
          { x: draftSpatial.geometry.x, y: draftSpatial.geometry.y },
          dir,
          e.shiftKey ? 10 : 1,
        ));
      }
    }
  }, [enabled, mediaStateNow, freezeMedia, onAnnotate, draftSpatial, onNudgeDraft, onCancelDraft]);

  // Projection of normalized geometry into percent CSS — pins ride the picture
  // through resizes because the normalized values are re-projected, never edited.
  const project = useCallback((geometry: OverlayPin['geometry']) => {
    if (!media) return null;
    return overlayStyleForGeometry(geometry, {
      elementWidth: media.width, elementHeight: media.height,
      naturalWidth: media.naturalWidth, naturalHeight: media.naturalHeight,
    });
  }, [media]);

  const content = media ? visualContentRect({
    elementWidth: media.width, elementHeight: media.height,
    naturalWidth: media.naturalWidth, naturalHeight: media.naturalHeight,
  }) : null;

  return (
    <div
      ref={overlayRef}
      data-testid="spatial-overlay"
      role="button"
      tabIndex={enabled ? 0 : -1}
      aria-label={OVERLAY_ARIA_LABEL}
      className="absolute left-0 right-0 top-0 cursor-crosshair select-none focus:outline focus:outline-2 focus:outline-sky-400"
      // The video transport keeps its strip; an image is coverable edge to edge.
      style={{ bottom: mediaKind === 'video' ? CONTROLS_EXCLUSION_PX : 0, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCue(null)}
      onKeyDown={onKeyDown}
    >
      {/* Saved pins — numbered, clickable, drawn from normalized geometry. */}
      {pins.map((pin) => {
        const at = project(pin.geometry);
        if (!at) return null;
        if (pin.geometry.kind === 'rect') {
          return (
            <button
              key={pin.issueId}
              type="button"
              data-testid={`spatial-pin-${pin.ordinal}`}
              title={pin.title}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenIssue(pin.issueId); }}
              className={`absolute border-2 ${pin.highlighted ? 'border-sky-300 bg-sky-400/20' : 'border-sky-400/80 bg-sky-400/10'} rounded-sm`}
              style={{
                left: `${at.leftPct}%`, top: `${at.topPct}%`,
                width: `${at.widthPct}%`, height: `${at.heightPct}%`,
              }}
            >
              <span className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-sky-400 text-[11px] font-semibold text-ink-950">
                {pin.ordinal}
              </span>
            </button>
          );
        }
        return (
          <button
            key={pin.issueId}
            type="button"
            data-testid={`spatial-pin-${pin.ordinal}`}
            title={pin.title}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenIssue(pin.issueId); }}
            className={`absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-semibold text-ink-950 ${pin.highlighted ? 'bg-sky-300 ring-2 ring-sky-200' : 'bg-sky-400'}`}
            style={{ left: `${at.leftPct}%`, top: `${at.topPct}%` }}
          >
            {pin.ordinal}
          </button>
        );
      })}

      {/* The unsaved annotation, drawn live. Non-destructive: outline + light fill. */}
      {draftSpatial && (() => {
        const at = project(draftSpatial.geometry);
        if (!at) return null;
        return draftSpatial.geometry.kind === 'rect' ? (
          <div
            data-testid="spatial-draft-mark"
            className="pointer-events-none absolute rounded-sm border-2 border-amber-300 bg-amber-300/15"
            style={{ left: `${at.leftPct}%`, top: `${at.topPct}%`, width: `${at.widthPct}%`, height: `${at.heightPct}%` }}
          />
        ) : (
          <div
            data-testid="spatial-draft-mark"
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300 bg-amber-300/40"
            style={{ left: `${at.leftPct}%`, top: `${at.topPct}%` }}
          />
        );
      })()}

      {/* The live drag marquee — presentation only; the saved rect is normalized at
          pointer-up against the content box, not this box. */}
      {marquee && (
        <div
          className="pointer-events-none absolute rounded-sm border border-amber-300/80 bg-amber-300/10"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}

      {/* The restrained hover cue. Never over the excluded controls strip (this
          surface ends above it), never while a gesture is in flight, and gone the
          moment the pointer leaves visual content. */}
      {cue && enabled && !marquee && content && (
        <span
          className="pointer-events-none absolute z-10 -translate-y-6 translate-x-2 whitespace-nowrap rounded bg-ink-950/90 px-1.5 py-0.5 text-[11px] text-ink-200"
          style={{ left: cue.x, top: cue.y }}
        >
          {ADD_FEEDBACK_CUE}
        </span>
      )}
    </div>
  );
}

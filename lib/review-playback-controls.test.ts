import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { render } from './test/render.ts';

// Real component/events, inert media element. No preview, credentials or network.
async function mount() {
  const source = new JSDOM('<!doctype html>');
  const media = source.window.document.createElement('video');
  const state = { paused: true, ended: false, time: 4.125, duration: 10, volume: 0.8, muted: false, seeking: false, plays: 0, pauses: 0 };
  const event = (type: string) => media.dispatchEvent(new source.window.Event(type));
  for (const [name, key] of [['paused', 'paused'], ['ended', 'ended'], ['currentTime', 'time'], ['duration', 'duration'], ['seeking', 'seeking']] as const) {
    Object.defineProperty(media, name, { configurable: true, get: () => state[key] });
  }
  for (const name of ['volume', 'muted'] as const) {
    Object.defineProperty(media, name, { configurable: true, get: () => state[name], set: (value: never) => { state[name] = value; event('volumechange'); } });
  }
  media.play = async () => { state.plays++; state.paused = false; state.ended = false; event('play'); };
  media.pause = () => { state.pauses++; state.paused = true; event('pause'); };
  const seeks: number[] = [];
  const mediaRef = { current: media };
  const props = { mediaRef, mediaKey: 'artifact-a', children: null, onSeek: (ms: number) => { seeks.push(ms); state.time = ms / 1000; state.seeking = true; event('seeking'); } };
  const page = await render('review-playback-controls.tsx', props);
  const button = (label: string) => {
    const element = page.document.querySelector(`button[aria-label="${label}"]`);
    assert.ok(element, `missing ${label}`); return element;
  };
  const range = (label: string) => page.document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  const change = async (input: HTMLInputElement, value: string) => page.act(() => {
    Object.getOwnPropertyDescriptor(page.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  });
  return { page, media, state, event, seeks, props, button, range, change, cleanup: () => { page.cleanup(); source.window.close(); } };
}

test('legacy overlay callers keep native exclusion; external mode opts into the whole image', async () => {
  const props = { mediaKind: 'video', mediaEl: () => null, enabled: true, pins: [], draftSpatial: null,
    freezeMedia: () => 0, onAnnotate: () => {}, onNudgeDraft: () => {}, onCancelDraft: () => {}, onOpenIssue: () => {} };
  const page = await render('review-spatial-overlay.tsx', props);
  try {
    const overlay = () => page.document.querySelector('[data-testid="spatial-overlay"]') as HTMLElement;
    assert.equal(overlay().style.bottom, '48px');
    await page.rerender({ ...props, controlsMode: 'external' });
    assert.equal(overlay().style.bottom, '0px');
    await page.rerender({ ...props, mediaKind: 'image' });
    assert.equal(overlay().style.bottom, '0px');
  } finally { page.cleanup(); }
});

test('Play/Pause and end-of-media labels follow the actual element, not click guesses', async () => {
  const h = await mount();
  try {
    await h.page.click(h.button('Play')); assert.equal(h.state.plays, 1);
    await h.page.click(h.button('Pause')); assert.equal(h.state.pauses, 1);
    await h.page.act(() => { h.state.ended = true; h.event('ended'); });
    assert.ok(h.button('Play'));
    h.media.play = async () => { throw new Error('inert fixture refusal'); };
    await h.page.click(h.button('Play'));
    assert.match(h.page.document.querySelector('[role="alert"]')!.textContent!, /Playback could not start/);
  } finally { h.cleanup(); }
});

test('seeking uses the existing parent callback and is tracked until the real seeked event', async () => {
  const h = await mount();
  try {
    await h.change(h.range('Seek video'), '7.25');
    assert.deepEqual(h.seeks, [7250]);
    assert.match(h.page.text(), /Seeking…/);
    await h.page.act(() => { h.state.seeking = false; h.event('seeked'); });
    assert.doesNotMatch(h.page.text(), /Seeking…/);
    assert.match(h.range('Seek video').getAttribute('aria-valuetext')!, /00:07\.250/);
  } finally { h.cleanup(); }
});

test('small steps pause first, seek from the live time, clamp to the file, and do not claim source FPS', async () => {
  const h = await mount();
  try {
    h.state.time = 9.99;
    await h.page.click(h.button('Step forward 1/30 second'));
    assert.equal(h.state.pauses, 1); assert.equal(h.seeks.at(-1), 10000);
    h.state.time = 0.001;
    await h.page.click(h.button('Step back 1/30 second'));
    assert.equal(h.seeks.at(-1), 0);
    assert.match(h.button('Step back 1/30 second').getAttribute('title')!, /exact source frame rate is unavailable/);
  } finally { h.cleanup(); }
});

test('unknown duration disables seeking and stepping; loaded metadata enables them', async () => {
  const h = await mount();
  try {
    await h.page.act(() => { h.state.duration = Infinity; h.event('durationchange'); });
    assert.equal(h.range('Seek video').disabled, true);
    assert.equal(h.button('Step forward 1/30 second').hasAttribute('disabled'), true);
    await h.page.act(() => { h.state.duration = 12; h.event('loadedmetadata'); });
    assert.equal(h.range('Seek video').disabled, false);
    assert.equal(h.range('Seek video').max, '12');
  } finally { h.cleanup(); }
});

test('volume/mute sync with the element; changing volume unmutes', async () => {
  const h = await mount();
  try {
    await h.page.click(h.button('Mute')); assert.equal(h.state.muted, true);
    assert.equal(h.range('Volume').value, '0');
    await h.change(h.range('Volume'), '0.35');
    assert.equal(h.state.volume, 0.35); assert.equal(h.state.muted, false);
    assert.ok(h.button('Mute'));
  } finally { h.cleanup(); }
});

test('Space is local to the focused player; typing, buttons, modifiers and picture pointer-down never toggle', async () => {
  const h = await mount();
  const key = async (target: Element, extra = {}) => h.page.act(() => target.dispatchEvent(new h.page.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, ...extra })));
  try {
    const player = h.page.document.querySelector('[data-testid="review-playback"]')!;
    const input = h.page.document.createElement('textarea'); player.appendChild(input);
    await key(input); await key(h.range('Seek video')); await key(h.button('Play'));
    await key(player, { ctrlKey: true }); await key(player, { repeat: true });
    await h.page.act(() => player.dispatchEvent(new h.page.window.MouseEvent('pointerdown', { bubbles: true })));
    assert.equal(h.state.plays, 0);
    await key(player); assert.equal(h.state.plays, 1);
    const outside = h.page.document.createElement('textarea'); h.page.document.body.appendChild(outside);
    await key(outside); assert.equal(h.state.plays, 1);
  } finally { h.cleanup(); }
});

test('fullscreen contains both picture and external controls; refusal is visible without losing the player', async () => {
  const h = await mount();
  try {
    let target: Element | null = null;
    h.page.window.HTMLElement.prototype.requestFullscreen = async function () {
      target = this;
      Object.defineProperty(h.page.document, 'fullscreenElement', { configurable: true, value: this });
      h.page.document.dispatchEvent(new h.page.window.Event('fullscreenchange'));
    };
    h.page.document.exitFullscreen = async () => {
      Object.defineProperty(h.page.document, 'fullscreenElement', { configurable: true, value: null });
      h.page.document.dispatchEvent(new h.page.window.Event('fullscreenchange'));
    };
    await h.page.rerender({ ...h.props, mediaKey: 'artifact-b' });
    await h.page.click(h.button('Enter fullscreen'));
    assert.equal(target, h.page.document.querySelector('[data-testid="review-playback"]'));
    assert.ok(target!.contains(h.page.document.querySelector('[data-testid="playback-controls"]')));
    await h.page.click(h.button('Exit fullscreen'));
    assert.equal(h.page.document.fullscreenElement, null);
    h.page.window.HTMLElement.prototype.requestFullscreen = async () => { throw new Error('inert denial'); };
    await h.page.click(h.button('Enter fullscreen'));
    assert.match(h.page.document.querySelector('[role="alert"]')!.textContent!, /Fullscreen could not open/);
  } finally { h.cleanup(); }
});

test('changing artifact detaches old media listeners; stale events cannot update the transport', async () => {
  const h = await mount();
  try {
    const next = h.media.cloneNode() as HTMLVideoElement;
    Object.defineProperties(next, { currentTime: { value: 1 }, duration: { value: 3 } });
    await h.page.rerender({ ...h.props, mediaKey: 'artifact-b', mediaRef: { current: next } });
    await h.page.act(() => { h.state.duration = 999; h.state.time = 500; h.event('timeupdate'); });
    assert.equal(h.range('Seek video').max, '3');
    assert.equal(h.range('Seek video').value, '1');
  } finally { h.cleanup(); }
});

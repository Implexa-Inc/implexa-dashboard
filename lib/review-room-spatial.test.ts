// node --test lib/review-room-spatial.test.ts
//
// THE REAL SURFACE, RENDERED AND CLICKED.
//
// Mounts the actual <ReviewRoom /> in jsdom with a desktop preview bridge faked at the
// window boundary, drives the actual annotation overlay with pointer and keyboard
// events, and intercepts the actual `fetch`. What these tests settle beyond argument:
// the click pauses and freezes the EXACT frame; the anchor that leaves the browser is
// byte-for-byte the backend's v2 shape; the letterbox is dead space; native controls
// stay native; a saved issue immediately requests its evidence; and the send action
// stays locked until every capture is validated.

import { test, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

register(new URL('../scripts/dom-test-loader.mjs', import.meta.url));

// Loaded dynamically in before() — a static .tsx import would resolve before the
// loader registration above takes effect.
let SPATIAL_HINT_COPY: string;

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const VID = 'bbbbbbbb-1111-4111-8111-111111111111';
const IMG = 'bbbbbbbb-2222-4222-8222-222222222222';
const SHA_V = 'd'.repeat(64);
const SHA_I = 'e'.repeat(64);
const ISSUE_ID = 'dddddddd-1111-4111-8111-111111111111';
const TOKEN_URL = `implexa-artifact://preview/${'a'.repeat(32)}`;

const artifacts = [
  {
    id: VID, runId: RUN_ID, relativePath: 'out/final.mp4', role: 'final_output',
    status: 'validated', sha256: SHA_V, sizeBytes: 100, mtime: '2026-08-08T09:00:00Z', validatedAt: '2026-08-08T09:00:00Z',
  },
  {
    id: IMG, runId: RUN_ID, relativePath: 'refs/board.png', role: 'source',
    status: 'validated', sha256: SHA_I, sizeBytes: 50, mtime: '2026-08-08T09:00:00Z', validatedAt: '2026-08-08T09:00:00Z',
  },
];

const storedSpatialAnchor = {
  version: 2, type: 'visual_spatial',
  observedArtifactId: VID, observedArtifactSha256: SHA_V,
  intent: { mode: 'change_observed_artifact' },
  temporal: { startMs: 3000, endMs: null },
  geometry: { kind: 'point', coordinateSpace: 'normalized_visual_content_v1', x: 0.25, y: 0.75, width: null, height: null },
  sourceFrame: { visualWidth: 1600, visualHeight: 900 },
};
const storedSpatialIssue = {
  id: ISSUE_ID, sessionId: SESSION_ID, runId: RUN_ID, artifactId: VID,
  kind: 'visual', anchor: storedSpatialAnchor, anchorDigest: 'f'.repeat(64),
  body: 'tighten this card', status: 'draft', submittedRequestId: null,
  createdAt: '2026-08-08T10:00:00Z', updatedAt: null,
};

type Call = { url: string; body: Record<string, unknown> };

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let act: (cb: () => void | Promise<void>) => Promise<void>;
let ReviewRoom: unknown;
let dom: JSDOM;
let container: HTMLElement;
let root: { render: (n: unknown) => void; unmount: () => void };
let calls: Call[];
let issueCounter: number;
/** What evidence_status answers — the test's dial for the gate. */
let evidenceReply: Record<string, unknown>;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://dashboard.test/review/x' });
  const put = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement',
    'HTMLVideoElement', 'HTMLImageElement', 'HTMLSelectElement', 'HTMLInputElement',
    'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event', 'getComputedStyle']) {
    put(name, (dom.window as unknown as Record<string, unknown>)[name]);
  }
  put('IS_REACT_ACT_ENVIRONMENT', true);
  // The desktop preview bridge, faked at the SAME boundary the app reads it from — so
  // the real decidePreview/requestPreview/parsePreviewUrl path runs, token and all.
  (dom.window as unknown as Record<string, unknown>).implexaDesktop = {
    createArtifactPreview: async () => ({ ok: true, url: TOKEN_URL }),
    revokeArtifactPreview: async () => {},
  };

  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  const testUtils = await import('react-dom/test-utils');
  act = (testUtils as unknown as { act: typeof act }).act;
  ReviewRoom = (await import('../app/(dashboard)/_components/review-room.tsx') as { default: unknown }).default;
  ({ SPATIAL_HINT_COPY } = await import('../app/(dashboard)/_components/review-spatial-overlay.tsx') as { SPATIAL_HINT_COPY: string });
});

after(() => { dom?.window?.close(); });

// A failed assertion mid-test must not leak the mounted room: its evidence-status
// poll interval would keep the event loop alive and turn one red test into a hang
// that swallows the assertion message.
afterEach(async () => {
  try { await act(async () => { root?.unmount(); }); } catch { /* already unmounted */ }
});

beforeEach(() => {
  calls = [];
  issueCounter = 0;
  evidenceReply = { ok: true, state: 'ready', issues: [] };
  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    const reply = (() => {
      switch (body.action) {
        case 'create_issue': {
          issueCounter += 1;
          return {
            ok: true,
            issue: {
              id: `eeeeeeee-000${issueCounter}-4111-8111-111111111111`,
              sessionId: body.sessionId, runId: RUN_ID, artifactId: body.artifactId,
              kind: body.kind, anchor: body.anchor, anchorDigest: '9'.repeat(64),
              body: body.body, status: 'draft', submittedRequestId: null,
              createdAt: '2026-08-08T11:00:00Z', updatedAt: null,
            },
          };
        }
        case 'request_evidence':
          return { ok: true, created: true, evidence: { id: 'ev-1', status: 'pending', ready: false } };
        case 'evidence_status':
          return evidenceReply;
        case 'ensure_session':
          return { ok: true, session: { id: SESSION_ID, runId: RUN_ID, state: 'draft', selectedArtifactId: null, submittedRequestId: null, submittedIssueIds: null, compiledBrief: null, acceptedAt: null } };
        default:
          return { ok: true };
      }
    })();
    return { status: 200, json: async () => reply } as unknown as Response;
  };
});

async function mount(over: Record<string, unknown> = {}) {
  // A remount inside one test (the gate tests re-mount to change the poll's answer)
  // must not abandon the previous root: an orphaned room keeps its evidence poll
  // interval alive forever, and the file never exits.
  if (root) { try { await act(async () => { root.unmount(); }); } catch { /* fresh */ } }
  root = createRoot(container) as unknown as typeof root;
  await act(async () => {
    root.render(React.createElement(ReviewRoom as never, {
      runId: RUN_ID,
      agentName: 'Chapter cutter',
      artifacts,
      production: null,
      issues: [],
      session: {
        id: SESSION_ID, runId: RUN_ID, selectedArtifactId: null,
        state: 'draft', submittedRequestId: null, submittedIssueIds: null,
        compiledBrief: null, acceptedAt: null,
      },
      sources: { issues: 'ready', artifacts: 'ready', session: 'ready', evidence: 'ready', reviewer_resolutions: 'ready', review_artifacts: 'ready' },
      isApprovalHold: false,
      initialArtifactId: VID,
      ...over,
    }));
  });
  // The preview effect awaits the bridge; flush it so the player exists.
  await act(async () => { await Promise.resolve(); });
}

/**
 * Make the jsdom video element measurable and controllable: 1600×900 source in an
 * 800×600 element at viewport (10, 20) — the letterboxed geometry the pure tests use,
 * so both layers agree about what (50%, 50%) means.
 */
function rigVideo(el: HTMLVideoElement, { currentTime = 1.656 } = {}) {
  const state = { currentTime, pauses: 0, seeks: [] as number[] };
  Object.defineProperty(el, 'videoWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(el, 'videoHeight', { configurable: true, get: () => 900 });
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => state.currentTime,
    set: (v: number) => { state.currentTime = v; state.seeks.push(v); },
  });
  el.getBoundingClientRect = () => ({
    left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620, x: 10, y: 20, toJSON: () => ({}),
  } as DOMRect);
  el.pause = () => { state.pauses += 1; };
  return state;
}

function rigImage(el: HTMLImageElement) {
  Object.defineProperty(el, 'naturalWidth', { configurable: true, get: () => 1080 });
  Object.defineProperty(el, 'naturalHeight', { configurable: true, get: () => 1920 });
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 270, height: 480, right: 270, bottom: 480, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

const overlay = () => container.querySelector('[data-testid="spatial-overlay"]') as HTMLElement;
const video = () => container.querySelector('video') as HTMLVideoElement;
const text = () => container.textContent || '';
const buttons = () => [...container.querySelectorAll('button')] as HTMLButtonElement[];

const fire = async (el: HTMLElement, type: string, opts: Record<string, unknown> = {}) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...opts }));
  });
};
const key = async (el: HTMLElement, k: string, opts: Record<string, unknown> = {}) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k, ...opts }));
  });
};
const media = async (el: HTMLElement, type: string) => {
  await act(async () => { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); });
};
// THE COMPOSER'S OWN BOX — never a bare textarea query: once a draft is saved the
// footer's revision-note textarea exists too, and existence assertions against
// "any textarea" answer the wrong question. Booleans only in assertions: a failed
// assert over a DOM node makes node:assert serialize the whole jsdom graph.
const composerBox = () => container.querySelector('textarea[placeholder="What should change here?"]') as HTMLTextAreaElement | null;
const typeBody = async (value: string) => {
  const box = composerBox()!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(box, value);
    box.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const clickButton = async (re: RegExp) => {
  const b = buttons().find((x) => re.test(x.textContent || ''));
  assert.ok(b, `no button matching ${re}`);
  await fire(b!, 'click');
};

async function mountVideo(over: Record<string, unknown> = {}) {
  await mount(over);
  const state = rigVideo(video());
  await media(video(), 'loadedmetadata');
  return state;
}

// ── discoverability ─────────────────────────────────────────────────────────

test('the overlay and the outside (i) hint render over a validated video, leaving the controls strip native', async () => {
  await mountVideo();
  assert.ok(overlay(), 'the annotation overlay must exist over the player');
  assert.match(text(), new RegExp(SPATIAL_HINT_COPY.slice(0, 30)));
  assert.equal(overlay().style.bottom, '48px', 'the native transport strip stays uncovered');
  assert.equal(video().hasAttribute('controls'), true, 'native controls survive the overlay');
  root.unmount();
});

// ── the primary path: click → pause → freeze → exact anchor → evidence ──────

test('REPRO: a click pauses the video, freezes the exact frame, and saves the EXACT v2 anchor', async () => {
  const state = await mountVideo();
  // Center of the visual content: element (10,20) + content offset (0,75) + (400,225).
  await fire(overlay(), 'pointerdown', { clientX: 410, clientY: 320 });
  assert.equal(state.pauses, 1, 'starting an annotation must pause playback immediately');
  await fire(overlay(), 'pointerup', { clientX: 410, clientY: 320 });
  assert.match(text(), /Pin · 00:01\.656 · \(50%, 50%\)/, 'the composer states the frozen place');

  // Playback moving on — and even a scrub — must not drag the frozen claim along.
  state.currentTime = 5.2;
  await media(video(), 'timeupdate');
  await media(video(), 'seeked');
  assert.match(text(), /Pin · 00:01\.656 · \(50%, 50%\)/, 'the freeze survived playback and seeking');

  await typeBody('make this card smaller');
  await clickButton(/^Save issue$/);

  const create = calls.find((c) => c.body.action === 'create_issue')!;
  assert.ok(create, 'no create_issue reached the wire');
  assert.equal(create.body.artifactId, VID);
  // THE LOAD-BEARING ASSERTION: byte-for-byte the backend 0155 shape.
  assert.deepEqual(create.body.anchor, {
    version: 2,
    type: 'visual_spatial',
    observedArtifactId: VID,
    observedArtifactSha256: SHA_V,
    intent: { mode: 'change_observed_artifact' },
    temporal: { startMs: 1656, endMs: null },
    geometry: {
      kind: 'point', coordinateSpace: 'normalized_visual_content_v1',
      x: 0.5, y: 0.5, width: null, height: null,
    },
    sourceFrame: { visualWidth: 1600, visualHeight: 900 },
  });

  // And the saved issue immediately asks for its screenshot evidence.
  const evidence = calls.find((c) => c.body.action === 'request_evidence')!;
  assert.ok(evidence, 'a saved spatial issue must request evidence');
  assert.equal(evidence.body.issueId, 'eeeeeeee-0001-4111-8111-111111111111');
  root.unmount();
});

test('a drag beyond the threshold saves a RECT; sub-threshold wobble stays a POINT', async () => {
  await mountVideo();
  await fire(overlay(), 'pointerdown', { clientX: 410, clientY: 320 });
  await fire(overlay(), 'pointermove', { clientX: 490, clientY: 380 });
  await fire(overlay(), 'pointerup', { clientX: 490, clientY: 380 });
  await typeBody('this whole area');
  await clickButton(/^Save issue$/);
  const rect = (calls.find((c) => c.body.action === 'create_issue')!.body.anchor as {
    geometry: Record<string, unknown>;
  }).geometry;
  assert.equal(rect.kind, 'rect');
  assert.equal(rect.x, 0.5);
  assert.equal(rect.y, 0.5);
  assert.equal(rect.width, 0.1);
  assert.ok(Math.abs(Number(rect.height) - 60 / 450) < 1e-6);

  // A 4px wobble is a point, not a sliver rectangle.
  await fire(overlay(), 'pointerdown', { clientX: 410, clientY: 320 });
  await fire(overlay(), 'pointerup', { clientX: 414, clientY: 322 });
  assert.match(text(), /Pin · /, 'sub-threshold travel must read as a point');
  root.unmount();
});

test('a click on the letterbox neither pauses nor opens a composer', async () => {
  const state = await mountVideo();
  // y=40 is inside the element (top 20) but above the picture (content top 95).
  await fire(overlay(), 'pointerdown', { clientX: 410, clientY: 40 });
  await fire(overlay(), 'pointerup', { clientX: 410, clientY: 40 });
  assert.equal(state.pauses, 0, 'a letterbox press must not pause — it marks nothing');
  assert.equal(!!composerBox(), false, 'no composer for a bar click');
  root.unmount();
});

// ── keyboard access ─────────────────────────────────────────────────────────

test('KEYBOARD: Enter places a center point, arrows nudge it, Escape cancels an empty draft', async () => {
  const state = await mountVideo();
  assert.equal(overlay().getAttribute('tabindex'), '0', 'the overlay must be focusable');
  await key(overlay(), 'Enter');
  assert.equal(state.pauses, 1, 'keyboard placement freezes like a click');
  assert.match(text(), /Pin · 00:01\.656 · \(50%, 50%\)/);
  await key(overlay(), 'ArrowRight');
  assert.match(text(), /\(51%, 50%\)/, 'an arrow nudges by one percent');
  await key(overlay(), 'ArrowUp', { shiftKey: true });
  assert.match(text(), /\(51%, 40%\)/, 'shift nudges by ten');
  await key(overlay(), 'Escape');
  assert.equal(!!composerBox(), false, 'Escape cancels the unsaved annotation');

  // But typed text is never silently discarded by Escape.
  await key(overlay(), 'Enter');
  await typeBody('half-written thought');
  await key(overlay(), 'Escape');
  assert.equal(!!composerBox(), true, 'typed text survives Escape — Cancel is the explicit act');
  root.unmount();
});

// ── freeze vs the world ─────────────────────────────────────────────────────

test('switching files clears an empty spatial composer and never retargets a saved issue', async () => {
  await mountVideo();
  await fire(overlay(), 'pointerdown', { clientX: 410, clientY: 320 });
  await fire(overlay(), 'pointerup', { clientX: 410, clientY: 320 });
  await typeBody('about the video');
  await clickButton(/^Save issue$/);
  const saved = calls.find((c) => c.body.action === 'create_issue')!;
  assert.equal(saved.body.artifactId, VID);

  // Open a fresh (empty) composer, then switch files: the draft must die with the
  // file it was aimed at, not follow the selection.
  await fire(overlay(), 'pointerdown', { clientX: 410, clientY: 320 });
  await fire(overlay(), 'pointerup', { clientX: 410, clientY: 320 });
  assert.equal(!!composerBox(), true);
  const select = container.querySelector('select') as HTMLSelectElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, IMG);
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  assert.equal(!!composerBox(), false, 'an empty composer must not survive a file switch');
  // The issue saved against the video is untouched — same file, same place.
  assert.match(text(), /Pin 00:01\.656 \(50%, 50%\)/, 'the saved annotation keeps its frozen identity');
  root.unmount();
});

test('reopening an existing spatial issue seeks to its frozen timestamp and renders its numbered pin', async () => {
  const state = await mountVideo({ issues: [storedSpatialIssue] });
  await clickButton(/Pin 00:03\.000/);
  assert.deepEqual(state.seeks, [3], 'opening the issue must seek the player to the frozen frame');
  const pin = container.querySelector('[data-testid="spatial-pin-1"]');
  assert.ok(pin, 'the opened issue renders its numbered pin');
  root.unmount();
});

// ── the evidence gate on the real button ────────────────────────────────────

const sendButton = () => buttons().find((b) => /^Send \d+ unresolved \+ \d+ new change/.test((b.textContent || '').trim()))!;

test('GATE: Send stays locked while a capture is pending, offers retry on failure, unlocks on validated', async () => {
  evidenceReply = {
    ok: true, state: 'ready',
    issues: [{ issueId: ISSUE_ID, anchorDigest: 'f'.repeat(64), evidence: { status: 'pending', ready: false } }],
  };
  await mountVideo({ issues: [storedSpatialIssue] });
  await act(async () => { await Promise.resolve(); });
  assert.equal(sendButton().disabled, true, 'a pending capture must lock the send');
  assert.match(text(), /Capturing screenshot evidence/);

  // The capture fails: the lock stays, and a retry appears.
  evidenceReply = {
    ok: true, state: 'ready',
    issues: [{ issueId: ISSUE_ID, anchorDigest: 'f'.repeat(64), evidence: { status: 'unavailable', ready: false, reason: 'capture_failed' } }],
  };
  await mountVideo({ issues: [storedSpatialIssue] });
  await act(async () => { await Promise.resolve(); });
  assert.equal(sendButton().disabled, true);
  assert.match(text(), /capture failed/i);

  // Retry re-requests, the capture validates, and the SAME room unlocks.
  evidenceReply = {
    ok: true, state: 'ready',
    issues: [{ issueId: ISSUE_ID, anchorDigest: 'f'.repeat(64), evidence: { status: 'validated', ready: true, sha256: '9'.repeat(64) } }],
  };
  await clickButton(/Retry screenshot capture/);
  await act(async () => { await Promise.resolve(); });
  assert.ok(calls.some((c) => c.body.action === 'request_evidence' && c.body.issueId === ISSUE_ID),
    'retry must re-request the failed capture');
  assert.equal(sendButton().disabled, false, 'validated evidence unlocks the send');
  assert.match(text(), /Screenshot: verified/);
  root.unmount();
});

// ── Tranche 1 (REV-U01): bounded retry, verified stability, stalled, disabled ──

const retryButton = () => buttons().find((b) => /Retry screenshot capture/.test(b.textContent || ''));

test('RETRY POOL: failed captures retry through a pool of ≤3, all issued once, verified never re-requested, one refresh after the batch', async () => {
  const spatialIssues = [1, 2, 3, 4, 5, 6].map((n) => ({
    ...storedSpatialIssue, id: `dddddddd-000${n}-4111-8111-111111111111`,
  }));
  // Five failed captures and ONE already verified.
  evidenceReply = {
    ok: true, state: 'ready',
    issues: spatialIssues.map((iss, idx) => ({
      issueId: iss.id, anchorDigest: 'f'.repeat(64),
      evidence: idx === 5
        ? { status: 'validated', ready: true, sha256: '9'.repeat(64) }
        : { status: 'unavailable', ready: false, reason: 'capture_failed' },
    })),
  };
  await mountVideo({ issues: spatialIssues });
  await act(async () => { await Promise.resolve(); });
  assert.ok(retryButton(), 'failed captures must offer a retry');

  // Wrap the transport so request_evidence stays IN FLIGHT until the test releases
  // it — the only way to observe the pool bound rather than assert it from source.
  const baseFetch = (globalThis as Record<string, unknown>).fetch as typeof fetch;
  let open = 0;
  let maxOpen = 0;
  const releases: Array<() => void> = [];
  (globalThis as Record<string, unknown>).fetch = (async (url: string, init: { body?: string }) => {
    const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (parsed.action === 'request_evidence') {
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      await new Promise<void>((res) => releases.push(res));
      open -= 1;
    }
    return baseFetch(url as never, init as never);
  }) as typeof fetch;

  const statusCallsBefore = calls.filter((c) => c.body.action === 'evidence_status').length;
  try {
    await clickButton(/Retry screenshot capture/);
    await act(async () => { await Promise.resolve(); });
    assert.equal(open, 3, 'exactly the pool width may be in flight after the click — not 1, not all 5');
    // Release captures one at a time; the pool tops back up but never over-fills.
    while (releases.length) {
      const release = releases.shift()!;
      await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      assert.ok(open <= 3, 'the pool bound must hold as the batch drains');
    }
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  } finally {
    (globalThis as Record<string, unknown>).fetch = baseFetch;
  }

  const requested = calls.filter((c) => c.body.action === 'request_evidence').map((c) => String(c.body.issueId));
  for (const iss of spatialIssues.slice(0, 5)) {
    assert.equal(requested.filter((id) => id === iss.id).length, 1, `failed capture ${iss.id} must be re-requested exactly once`);
  }
  assert.equal(maxOpen, 3, 'the retry pool is bounded at 3');
  // VERIFIED STAYS STABLE: the ready capture is never re-requested — doing so would
  // revoke the validated frame the submit gate already accepted.
  assert.equal(requested.includes(spatialIssues[5].id), false, 'a verified capture must never be re-requested');
  const statusCallsAfter = calls.filter((c) => c.body.action === 'evidence_status').length;
  assert.equal(statusCallsAfter - statusCallsBefore, 1, 'ONE status refresh after the whole batch — not one per issue');
  root.unmount();
});

test('STALLED: a capture pending across the poll bound surfaces a stalled state with Retry; submit stays blocked', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  evidenceReply = {
    ok: true, state: 'ready',
    issues: [{ issueId: ISSUE_ID, anchorDigest: 'f'.repeat(64), evidence: { status: 'pending', ready: false } }],
  };
  await mountVideo({ issues: [storedSpatialIssue] });
  await act(async () => { await Promise.resolve(); });
  assert.match(text(), /Capturing screenshot evidence/);
  assert.equal(!!retryButton(), false, 'a merely-pending capture offers no retry');

  // 25 poll beats (~100s) with the capture still pending.
  for (let i = 0; i < 25; i += 1) {
    await act(async () => {
      t.mock.timers.tick(4000);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
  }
  assert.match(text(), /stalled/i, 'the stall must be named, not left as a silent forever-lock');
  assert.ok(retryButton(), 'a stalled capture must offer Retry');
  assert.equal(sendButton().disabled, true, 'submit stays blocked — fail closed');

  // Retry re-requests capture for exactly the stalled issue.
  await fire(retryButton()!, 'click');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  assert.ok(calls.some((c) => c.body.action === 'request_evidence' && c.body.issueId === ISSUE_ID),
    'retry must re-request the stalled capture');
  root.unmount();
});

test('DISABLED: spatial drafts over a disabled evidence backend block with typed copy and retry, never the unknown spinner', async () => {
  evidenceReply = { ok: true, state: 'disabled', issues: [] };
  await mountVideo({ issues: [storedSpatialIssue] });
  await act(async () => { await Promise.resolve(); });
  assert.equal(sendButton().disabled, true, 'disabled with spatial drafts fails closed, mirroring the backend compile gate');
  assert.match(text(), /disabled on this backend/i, 'the situation is named in words');
  assert.doesNotMatch(text(), /Checking screenshot evidence/, 'never the generic forever-spinner');
  assert.ok(retryButton(), 'a retry affordance is offered in case capture support returns');
  root.unmount();
});

test('GATE: a v1-only review never waits on evidence', async () => {
  await mountVideo({
    issues: [{
      id: ISSUE_ID, sessionId: SESSION_ID, runId: RUN_ID, artifactId: VID,
      kind: 'timing', anchor: { version: 1, type: 'media_time', artifactSha256: SHA_V, timeStartMs: 5000, timeEndMs: null },
      anchorDigest: null, body: 'trim here', status: 'draft', submittedRequestId: null,
      createdAt: '2026-08-08T10:00:00Z', updatedAt: null,
    }],
  });
  assert.equal(sendButton().disabled, false, 'temporal-only feedback needs no captures');
  assert.equal(calls.filter((c) => c.body.action === 'evidence_status').length, 0,
    'no evidence poll for a review with nothing spatial');
  root.unmount();
});

// ── images and reference mode ───────────────────────────────────────────────

test('IMAGE: a click saves a temporal-null anchor against the image dimensions', async () => {
  await mount({ initialArtifactId: IMG });
  rigImage(container.querySelector('img') as HTMLImageElement);
  await media(container.querySelector('img') as HTMLImageElement, 'load');
  // Image 1080×1920 contained in 270×480: fills exactly (same aspect). Click 25%/25%.
  await fire(overlay(), 'pointerdown', { clientX: 67.5, clientY: 120 });
  await fire(overlay(), 'pointerup', { clientX: 67.5, clientY: 120 });
  assert.match(text(), /Pin · \(25%, 25%\)/, 'an image pin has no timestamp in its header');
  await typeBody('match this framing');
  await clickButton(/^Save issue$/);
  const anchor = calls.find((c) => c.body.action === 'create_issue')!.body.anchor as Record<string, unknown>;
  assert.equal(anchor.temporal, null, 'a still image freezes NO timestamp');
  assert.deepEqual(anchor.sourceFrame, { visualWidth: 1080, visualHeight: 1920 });
  assert.equal((anchor.geometry as { x: number }).x, 0.25);
  root.unmount();
});

test('REFERENCE MODE: observe the image, change the video — typed intent, exact identities', async () => {
  await mount({ initialArtifactId: IMG });
  rigImage(container.querySelector('img') as HTMLImageElement);
  await media(container.querySelector('img') as HTMLImageElement, 'load');
  await fire(overlay(), 'pointerdown', { clientX: 67.5, clientY: 120 });
  await fire(overlay(), 'pointerup', { clientX: 67.5, clientY: 120 });

  // Pick the video as the file this mark applies to.
  const applies = container.querySelector('select[aria-label="File this annotation applies to"]') as HTMLSelectElement;
  assert.ok(applies, 'a multi-file review offers the reference choice');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(applies, VID);
    applies.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  assert.match(text(), /Marked on refs\/board\.png as a reference/);
  assert.match(text(), /applies to out\/final\.mp4/);

  await typeBody('use this board framing for the title card');
  await clickButton(/^Save issue$/);
  const anchor = calls.find((c) => c.body.action === 'create_issue')!.body.anchor as Record<string, unknown>;
  assert.equal((anchor as { observedArtifactId: string }).observedArtifactId, IMG,
    'geometry belongs to the OBSERVED reference');
  assert.deepEqual(anchor.intent, {
    mode: 'reference_for_artifact', targetArtifactId: VID, targetArtifactSha256: SHA_V,
  });
  root.unmount();
});

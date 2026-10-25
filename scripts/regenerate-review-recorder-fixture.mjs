#!/usr/bin/env node
/**
 * Regenerate test-fixtures/review-recorder/desktop-contract-v1.json from the REAL
 * Desktop recorder: its dispatcher (src/recorder/review-recorder.js
 * handleDashboardOperation) over a real recording store and pointer track, in a temp
 * directory. lib/review-recorder.test.ts asserts the Dashboard parsers accept it, so a
 * Desktop shape change shows up as a Dashboard test failure, not as a blank page.
 *
 *   IMPLEXA_DESKTOP_DIR=../implexa-desktop node scripts/regenerate-review-recorder-fixture.mjs
 *
 * Reads the Desktop checkout; writes only the fixture and a temp directory it removes.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const desktopDir = process.env.IMPLEXA_DESKTOP_DIR;
if (!desktopDir) { console.error('Set IMPLEXA_DESKTOP_DIR to an Implexa Desktop checkout.'); process.exit(1); }
const require = createRequire(import.meta.url);
const DESK = path.resolve(desktopDir, 'src/recorder') + path.sep;
const { createRecordingStore } = require(DESK + 'recording-store.js');
const { createPointerTrack } = require(DESK + 'pointer-track.js');
const { handleDashboardOperation } = require(DESK + 'review-recorder.js');
const commit = execFileSync('git', ['-C', desktopDir, 'rev-parse', '--short', 'HEAD']).toString().trim();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-fixture-'));
const owner = crypto.randomUUID();
const store = createRecordingStore({ root, media: {} });
const recorder = { store, controller: { activeIds: () => new Set(), status: () => null }, mediaToolsReady: () => true };
const ctx = { ownerId: owner, notify: () => {}, confirmDelete: async () => false, revokePreviews: () => {}, pickVideoFile: async () => null };
const op = (operation, args) => handleDashboardOperation(recorder, { operation, args }, ctx);
function packet(id, state, extra = {}) {
  fs.mkdirSync(path.join(root, id));
  fs.writeFileSync(path.join(root, id, 'packet.json'), JSON.stringify({
    contractVersion: 'review-recording.v1', recordingId: id, ownerId: owner, origin: 'recorded', title: 'Checkout flow', state, failureReason: null,
    createdAt: '2026-10-25T12:00:00.000Z', updatedAt: '2026-10-25T12:00:00.000Z', container: 'mp4', microphone: true,
    capture: { chunkCount: 0, bytes: 0, endedAt: null, stopReason: null }, media: null, pointer: null, ...extra,
  }));
}
let t = 0;
const tr = createPointerTrack({ display: { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }, now: () => t });
tr.start();
for (let i = 0; i < 50; i++) { t += 33; tr.sample({ x: i * 20, y: i * 10 }); }
t += 10; tr.sample({ x: -5, y: 0 }); t += 50; tr.sample({ x: 1439.9, y: 899.9 });
const text = tr.serialize();
const ready = '0b8f3a52-6f1e-4c2a-9d1b-3e5f7a9c1d2e', interrupted = '1c9e4b63-7a2f-4d3b-8e2c-4f6a8b0d2e3f', failed = '2d0f5c74-8b3a-4e4c-9f3d-5a7b9c1e3f4a';
packet(ready, 'ready', { media: { sha256: 'a'.repeat(64), sizeBytes: 1234, mtime: 1, durationMs: 10007, width: 2880, height: 1800, videoCodec: 'h264', audioCodec: 'aac' },
  pointer: { sha256: crypto.createHash('sha256').update(text).digest('hex') } });
fs.writeFileSync(path.join(root, ready, 'pointer.v1'), text);
packet(interrupted, 'recording', { title: 'Half a session' });
packet(failed, 'failed', { failureReason: 'empty_capture', title: 'Empty' });
const moments = [{ momentId: 'aa0f5c74-8b3a-4e4c-9f3d-5a7b9c1e3f4a', startMs: 500, endMs: 1600, region: { x: 0, y: 0, width: 400000, height: 300000 },
  card: { whatToDo: 'Keep the price visible', why: '', insteadOf: '', howToCheck: '', whenNot: '' }, createdAt: '2026-10-25T12:05:00.000Z' }];
const out = {
  _provenance: `Generated from Implexa Desktop feat review recorder at ${commit}: src/recorder/review-recorder.js handleDashboardOperation over a real createRecordingStore and createPointerTrack. Do not hand-edit; regenerate.`,
  list: await op('list', {}),
  saveMoments: await op('saveMoments', { recordingId: ready, moments }),
  get: await op('get', { recordingId: ready }),
  getInterrupted: await op('get', { recordingId: interrupted }),
  refusals: {
    notFound: await op('get', { recordingId: 'not-a-uuid' }),
    deleteCancelled: await op('delete', { recordingId: ready }),
    unknownOperation: await op('rename', {}),
    importCancelled: await op('import', {}),
  },
};
fs.rmSync(root, { recursive: true, force: true });
const target = new URL('../test-fixtures/review-recorder/desktop-contract-v1.json', import.meta.url);
fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${target.pathname} from Desktop ${commit}`);

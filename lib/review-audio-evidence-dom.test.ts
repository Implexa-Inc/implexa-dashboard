import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
register(new URL('../scripts/dom-test-loader.mjs', import.meta.url));
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Component: typeof import('../app/(dashboard)/_components/review-audio-evidence.tsx').ReviewAudioEvidence;
let dom: JSDOM;
before(async () => {
  dom = new JSDOM('<html><body></body></html>');
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[name] });
  }
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  React = await import('react'); ({ createRoot } = await import('react-dom/client'));
  ({ ReviewAudioEvidence: Component } = await import('../app/(dashboard)/_components/review-audio-evidence.tsx'));
});
after(() => dom.window.close());
test('actual composer adds named clip evidence, deduplicates overlap, previews limitations and requires explicit insertion', async () => {
  const host = dom.window.document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const inserted: Array<{ text: string; prior: string | null }> = [];
  await React.act(async () => root.render(React.createElement(Component, { reviewedFile: 'final.mp4', anchorMs: 33000,
    onInsert: (text, prior) => inserted.push({ text, prior }) })));
  const input = async (label: string, value: string) => {
    const element = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    await React.act(async () => {
      const proto = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
  };
  const click = async (label: string) => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === label)!; assert.ok(b); await React.act(async () => b.click()); };
  await input('Audio reference timeline', 'clip'); await input('Audio reference file', 'audition.mp4');
  await input('Audio reference start', '1'); await input('Audio reference end', '2'); await input('Clip origin in reviewed output', '30');
  await click('Add reference'); await input('Audio reference start', '1.5'); await input('Audio reference end', '3'); await click('Add reference');
  assert.equal(inserted.length, 0, 'reference changes neither submit nor insert automatically');
  assert.match(host.querySelector('[aria-label="Audio evidence preview"]')!.textContent!, /31.000s–33.000s/);
  await input('Audio listening status', 'transcript_only'); await click('Add context to comment');
  assert.equal(inserted.length, 1); assert.equal((inserted[0].text.match(/Clip-relative time/g) || []).length, 1);
  assert.match(inserted[0].text, /audio has not been checked by listening/);
  assert.equal(inserted[0].prior, null);
  await input('Audio listening status', 'listened'); await click('Update context in comment');
  assert.equal(inserted.length, 2); assert.equal(inserted[1].prior, inserted[0].text);
  assert.match(inserted[1].text, /Reviewer reports listening/);
  assert.match(inserted[0].text, /does not verify an editorial correction/);
  await input('Audio reference start', '3'); await input('Audio reference end', '3'); await click('Add reference');
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /positive time range/);
  await React.act(async () => root.unmount()); host.remove();
});
test('changing timelines clears reviewed coordinates instead of implying source or clip alignment', async () => {
  const host = dom.window.document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(Component, { reviewedFile: 'final.mp4', anchorMs: 33000, onInsert: () => {} })));
  const select = host.querySelector('[aria-label="Audio reference timeline"]') as HTMLSelectElement;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(select, 'source');
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  assert.equal((host.querySelector('[aria-label="Audio reference start"]') as HTMLInputElement).value, '');
  assert.equal((host.querySelector('[aria-label="Audio reference end"]') as HTMLInputElement).value, '');
  assert.equal((host.querySelector('[aria-label="Audio reference file"]') as HTMLInputElement).value, '');
  await React.act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Add reference')!.click());
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /Name the reference/);
  await React.act(async () => root.unmount()); host.remove();
});

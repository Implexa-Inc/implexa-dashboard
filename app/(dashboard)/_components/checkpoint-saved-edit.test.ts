import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

test('a saved edit queues the two verified files and one brief after the original source is checked', async () => {
  const runId = '77fd8675-1b02-4881-a59f-c43012d98d9f';
  const phases: string[] = [];
  const rendered = await render('checkpoint-saved-edit.tsx', { runId }, {
    bridge: {
      pickRunInput: async (opts: { inputKey: string; inputSessionId?: string }) => {
        phases.push(`pick:${opts.inputKey}`);
        if (opts.inputKey === 'checkpoint_edit_project') assert.equal(opts.inputSessionId, 'one-session');
        return { ok: true, storageMode: 'managed_copy', inputSessionId: 'one-session', artifactId: opts.inputKey,
          displayName: opts.inputKey.endsWith('video') ? 'Saved.mp4' : 'Project.zip' };
      },
      localInputReauthorizationState: async () => {
        phases.push('verify-original');
        return { ok: true, applicable: true, required: false };
      },
    },
    backend: (_path, init) => {
      if (init?.method === 'POST') { phases.push('queue'); return { ok: true, queued: true }; }
      return { ok: true, eligible: true };
    },
  });
  try {
    await rendered.click(rendered.getByText(/^Resume with saved edit$/));
    assert.equal((rendered.getByText(/^Resume this edit$/) as HTMLButtonElement).disabled, true);
    await rendered.click(rendered.getByText(/^First cut \(MP4\)$/));
    await rendered.click(rendered.getByText(/^Editable project \(ZIP\)$/));
    const note = rendered.document.querySelector('textarea')!;
    const set = Object.getOwnPropertyDescriptor(rendered.window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await rendered.act(() => {
      set.call(note, 'Keep the animations. Match the gray pins to the narration.');
      note.dispatchEvent(new rendered.window.Event('input', { bubbles: true }));
      note.dispatchEvent(new rendered.window.Event('change', { bubbles: true }));
    });
    await rendered.click(rendered.getByText(/^Resume this edit$/));
    assert.deepEqual(phases, ['pick:checkpoint_edit_video', 'pick:checkpoint_edit_project', 'verify-original', 'queue']);
    const sent = rendered.calls.backend.find(c => c.init?.method === 'POST');
    assert.equal(sent?.path, `/api/v2/me/runs/${runId}/checkpoint-edit`);
    assert.deepEqual(JSON.parse(JSON.stringify(sent?.init?.body)), {
      inputSessionId: 'one-session', videoArtifactId: 'checkpoint_edit_video', projectArtifactId: 'checkpoint_edit_project',
      brief: 'Keep the animations. Match the gray pins to the narration.',
    });
    assert.match(rendered.text(), /Edit queued/);
  } finally { rendered.cleanup(); }
});

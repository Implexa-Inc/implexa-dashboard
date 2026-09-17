'use client';

/**
 * <AgentEditButton /> — the header's "Edit Agent" trigger.
 *
 * Used to be a Link that jumped to the Setup tab and scrolled to the "Edit this
 * agent" card (founder feedback: it "doesn't do anything" — no visible action at
 * the point of the click, just a tab-switch + scroll). Now it opens the SAME
 * ImproveAgent form directly in a pop-up, right where the click happened — the
 * Setup tab no longer carries its own copy of this card.
 */

import { useState } from 'react';
import Modal from './modal';
import ImproveAgent from './improve-agent';

export default function AgentEditButton({ slug, statusUnavailable = false, revisePending = false }: { slug: string; statusUnavailable?: boolean; revisePending?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={statusUnavailable || revisePending}
        title={statusUnavailable ? 'Edit status is unavailable. Reload before queueing another edit.' : revisePending ? 'An edit is already queued.' : undefined}
        className={`text-xs underline underline-offset-2 ${statusUnavailable || revisePending
          ? 'text-ink-600 cursor-not-allowed'
          : 'text-ink-400 hover:text-ink-200'}`}
      >
        {statusUnavailable ? 'Edit status unavailable' : revisePending ? 'Edit queued' : 'Edit Agent'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit this agent" maxWidth="max-w-md">
        <ImproveAgent slug={slug} bare statusUnavailable={statusUnavailable} revisePending={revisePending} />
      </Modal>
    </>
  );
}

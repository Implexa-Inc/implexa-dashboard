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

export default function AgentEditButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink-400 hover:text-ink-200 underline underline-offset-2"
      >
        Edit Agent
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit this agent" maxWidth="max-w-md">
        <ImproveAgent slug={slug} bare />
      </Modal>
    </>
  );
}

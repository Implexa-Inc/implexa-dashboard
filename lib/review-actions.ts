/**
 * lib/review-actions.ts — the Review write-path allowlist.
 *
 * PURE ON PURPOSE. The mapping from a client action to exactly one upstream call is
 * the security boundary of the write path — an open `[...path]` proxy carrying the
 * user's JWT would let any client-side bug reach an arbitrary backend endpoint as that
 * user. Keeping it free of next/server means every branch is executable in a test
 * instead of being asserted by reading the file.
 */

export type Upstream = { path: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown };

/**
 * The backend's own bound, not ours.
 *
 * `REVISION_NOTE_MAX` in implexa-backend@8c0f71d `src/lib/review-submission.js`, applied
 * AFTER `.trim()`. Duplicated here because the client must refuse the same input the
 * server would; if the two ever disagree the server wins and the user sees its refusal.
 */
export const REVISION_NOTE_MAX = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);

/**
 * Map an action to its single upstream call. Returns a string on refusal so the
 * client gets a real reason instead of a generic 400.
 */
export function resolveReviewAction(action: string, b: Record<string, unknown>): Upstream | string {
  switch (action) {
    case 'ensure_session': {
      const runId = id(b.runId);
      if (!runId) return 'A valid runId is required.';
      const artifactId = id(b.artifactId);
      return {
        path: `/api/v2/review/runs/${runId}/session`, method: 'POST',
        body: artifactId ? { artifactId } : {},
      };
    }
    case 'create_issue': {
      const sessionId = id(b.sessionId);
      if (!sessionId) return 'A valid sessionId is required.';
      return {
        path: `/api/v2/review/sessions/${sessionId}/issues`, method: 'POST',
        // `anchor` is forwarded verbatim to the backend's typed validator. There is
        // deliberately no "any JSON is fine" shortcut on either side.
        body: { artifactId: id(b.artifactId), kind: b.kind, anchor: b.anchor, body: b.body },
      };
    }
    case 'update_issue': {
      const issueId = id(b.issueId);
      if (!issueId) return 'A valid issueId is required.';
      const patch: Record<string, unknown> = {};
      if (b.kind !== undefined) patch.kind = b.kind;
      if (b.anchor !== undefined) patch.anchor = b.anchor;
      if (b.body !== undefined) patch.body = b.body;
      return { path: `/api/v2/review/issues/${issueId}`, method: 'PATCH', body: patch };
    }
    case 'dismiss_issue': {
      const issueId = id(b.issueId);
      if (!issueId) return 'A valid issueId is required.';
      return { path: `/api/v2/review/issues/${issueId}`, method: 'DELETE' };
    }
    case 'request_evidence': {
      // Ask the backend for an annotated frame of the issue's CURRENT anchor. The
      // server rebinds identity from the durable row — nothing else rides in the body,
      // so there is nothing here a compromised client could redirect.
      const issueId = id(b.issueId);
      if (!issueId) return 'A valid issueId is required.';
      return { path: `/api/v2/review/issues/${issueId}/evidence`, method: 'POST', body: {} };
    }
    case 'evidence_status': {
      // The polling read while Submit waits on validated captures. Read-only.
      const sessionId = id(b.sessionId);
      if (!sessionId) return 'A valid sessionId is required.';
      return { path: `/api/v2/review/sessions/${sessionId}/evidence`, method: 'GET' };
    }
    case 'submit': {
      const sessionId = id(b.sessionId);
      if (!sessionId) return 'A valid sessionId is required.';
      // THE REVISION NOTE, under the backend's own field name and bounds — read from
      // implexa-backend@8c0f71d, src/lib/review-submission.js: the request body key is
      // `revisionNote`, it must be a string, it is `.trim()`ed, an empty result becomes
      // null, and REVISION_NOTE_MAX is 2000 measured AFTER the trim.
      //
      // Mirrored here rather than left to the server so an over-long note is refused
      // before a round trip — and, more importantly, so the note that travels is
      // byte-identical to the one the server will store. Sending untrimmed text would
      // make the reviewer's copy and the persisted copy differ by whitespace.
      const raw = b.revisionNote;
      if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        return 'The revision note must be text.';
      }
      const note = typeof raw === 'string' ? raw.trim() : '';
      if (note.length > REVISION_NOTE_MAX) {
        return `Keep the revision note to ${REVISION_NOTE_MAX} characters or fewer.`;
      }
      // Idempotent upstream: a double click, a retry, or a crashed attempt all
      // converge on the SAME continuation. The client must not try to dedupe.
      return {
        path: `/api/v2/review/sessions/${sessionId}/submit`, method: 'POST',
        // Explicit null rather than an absent key: the backend reads
        // `typeof req.body.revisionNote === 'string' ? … : null`, so both are accepted,
        // and stating it makes "no note" a decision rather than an omission.
        body: { revisionNote: note.length ? note : null },
      };
    }
    case 'accept': {
      const sessionId = id(b.sessionId);
      if (!sessionId) return 'A valid sessionId is required.';
      return {
        path: `/api/v2/review/sessions/${sessionId}/accept`, method: 'POST',
        // STRICTLY boolean true. Forwarding a truthy string would let a UI slip
        // silently discard written feedback.
        body: { discardOpenIssues: b.discardOpenIssues === true },
      };
    }
    default:
      return 'Unknown review action.';
  }
}


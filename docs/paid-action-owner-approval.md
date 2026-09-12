# Paid action owner approval

A run held at `approval_before_action` never uses the generic Continue contract. The run-detail page reads the authenticated `GET /api/v2/runs/:runId` projection and accepts only `paid-action-approval-summary.v3`.

The v3 summary must contain:

- immutable approval-intent and request-manifest artifact identities;
- `project_bundle` and `presenter_video` inputs with server-derived basenames, artifact IDs and SHA-256 digests;
- every request's request/scene IDs, complete prompt, half-open source-frame range, model, resolution, duration, estimated cost, intended downstream use and exact composition-declared `public/media/<filename>.mp4` destination;
- an exact request count and an estimated total equal to the sum of item costs.

`intendedUse` is editorial context only. It is never interpreted as a filesystem destination; only the separately validated `outputRelativePath` controls where Desktop materializes the approved output.

Unknown, extra, malformed, incomplete, legacy-v1/v2 or differently bound data shows no approval action. A v1 unavailable projection naming `paid_action_manifest_v3_required` is rendered as an agent-update requirement.

The only approval write is:

```text
POST /api/v2/runs/:runId/paid-action-approval
{ approvalIntentId, requestManifestArtifactId, requestManifestDigest }
```

Dashboard accepts success only when the response has the exact typed shape and repeats the identical reviewed v3 summary. A lost or invalid response leaves the button retryable with the same three immutable identities. The backend owns idempotency and creates or adopts one digest-bound continuation.

Inbox and Review Room route the owner to the exact run page. The shared held-run action component also refuses to create a generic continuation if a paid hold reaches it accidentally.

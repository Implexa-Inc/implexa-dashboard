/**
 * /review — legacy compatibility redirect.
 *
 * The review QUEUE moved into Work as the "Ready for review" filter: there is
 * no top-level Review navigation entry, and one queue must not have two
 * destinations (DESIGN.md §9.3, §11.1).
 *
 * The route is kept, not deleted. Older Run Cards, notification emails, desktop
 * notifications and `/review/[runId]`'s own back link all point at `/review`,
 * and the query string is carried across so any of them can keep addressing a
 * specific slice.
 *
 * `/review/[runId]` — the artifact-aware Review Room itself — is untouched and
 * remains the canonical review mode that this queue links into.
 */

import { redirect } from 'next/navigation';
import { legacyDestination } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export default function ReviewQueueRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(legacyDestination('/work?view=review', searchParams));
}

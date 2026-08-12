/**
 * /inbox — legacy compatibility redirect.
 *
 * Results is the **Delivered** filter of Work (DESIGN.md §8.2). The route stays
 * live because it is the single most deep-linked URL in the product: result
 * notification emails and desktop notifications address `/inbox?run=<id>`, and
 * `inbox-list.tsx` syncs that same `?run=` parameter into the URL when an
 * overlay opens.
 *
 * That is why the redirect goes through `legacyDestination` rather than a
 * string literal — dropping `run` would land the user on a list instead of the
 * result they clicked. `inbox-list.tsx` itself is unchanged and is now rendered
 * by /work with `basePath="/work"`.
 */

import { redirect } from 'next/navigation';
import { legacyDestination } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export default function InboxRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(legacyDestination('/work?view=delivered', searchParams));
}

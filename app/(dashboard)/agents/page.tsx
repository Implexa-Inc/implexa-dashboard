/**
 * /agents — forward alias for the canonical Agents vocabulary.
 *
 * The nav says "Agents" and the roadmap says Agents; the page still lives at
 * `/workflows`. Renaming that directory is deliberately NOT part of this change:
 * the Agents page and the agent resume are owned by the Marketplace lane, which
 * is actively building outcome-first search and the flat resume inside them, and
 * moving the files underneath that work would collide for no user-visible gain.
 *
 * So the new URL resolves today and the rename can happen later without
 * breaking anything written against it.
 */

import { redirect } from 'next/navigation';
import { legacyDestination } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export default function AgentsAliasRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(legacyDestination('/workflows', searchParams));
}

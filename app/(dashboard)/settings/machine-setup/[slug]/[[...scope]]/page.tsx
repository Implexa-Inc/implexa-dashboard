import { notFound } from 'next/navigation';
import { parseSetupScope } from '@/lib/setup-required';
import MachineSetupPage from '../machine-setup-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Machine setup — Implexa' };

/**
 * /settings/machine-setup/:slug[/machine/:machineId][/version/:workflowVersionId]
 *
 * "Open setup in Implexa" carries THE machine the Setup-required card was
 * raised for and THE frozen version that was refused (a continuation's run
 * version can differ from the agent's current one). Named path segments, not a
 * query string: the app's implexa:// deep-link router drops queries. Malformed
 * segments 404 instead of silently showing another machine or version.
 */
export default async function Page({ params }: { params: { slug: string; scope?: string[] } }) {
  const scope = parseSetupScope(params.scope);
  if (!scope) notFound();
  return <MachineSetupPage slug={params.slug} machineId={scope.machineId} workflowVersionId={scope.workflowVersionId} />;
}

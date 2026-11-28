import type { MyWorkflowsRead } from '@/lib/workflow-catalog';
import { CoachOwnershipSync } from './sidebar';

/** Publish the owner-library result an existing page already needs. */
export default async function CoachOwnership({ owned }: { owned: Promise<MyWorkflowsRead> }) {
  const library = await owned;
  if (library.status !== 'ready') return null;
  const canTrain = library.workflows.some(agent => agent.source === 'generated');
  return <CoachOwnershipSync canTrain={canTrain || !library.unavailableEntries ? canTrain : null} />;
}

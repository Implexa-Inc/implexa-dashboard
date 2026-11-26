'use client';

import { useState } from 'react';
import type { ReviewArtifact, ReviewIssue, ReviewSession } from '@/lib/review';
import AnnotationLeaveGuard from './annotation-leave-guard';
import ReviewRoom from './review-room';

export default function RecoveredExportFeedback({ artifact, agentName, agentSlug, issues, session, canRevise }: {
  artifact: ReviewArtifact;
  agentName: string;
  agentSlug?: string | null;
  issues: ReviewIssue[];
  session: ReviewSession;
  canRevise?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  return <>
    <AnnotationLeaveGuard dirty={dirty} />
    <ReviewRoom runId={artifact.runId} agentName={agentName} agentSlug={agentSlug} artifacts={[artifact]} initialArtifactId={artifact.id}
      production={null} issues={issues} session={session} reviewArtifacts={[]} isApprovalHold={false}
      sources={{ session: 'ready', issues: 'ready', reviewer_resolutions: 'ready' }}
      onDirtyChange={setDirty} trainingMode recoveredFeedback canReviseRecoveredExport={canRevise} />
  </>;
}

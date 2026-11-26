'use client';

import { useState } from 'react';
import type { ReviewArtifact, ReviewIssue, ReviewSession } from '@/lib/review';
import AnnotationLeaveGuard from './annotation-leave-guard';
import ReviewRoom from './review-room';

export default function RecoveredExportFeedback({ artifact, agentName, issues, session }: {
  artifact: ReviewArtifact;
  agentName: string;
  issues: ReviewIssue[];
  session: ReviewSession;
}) {
  const [dirty, setDirty] = useState(false);
  return <>
    <AnnotationLeaveGuard dirty={dirty} />
    <ReviewRoom runId={artifact.runId} agentName={agentName} artifacts={[artifact]} initialArtifactId={artifact.id}
      production={null} issues={issues} session={session} reviewArtifacts={[]} isApprovalHold={false}
      sources={{ session: 'ready', issues: 'ready', reviewer_resolutions: 'ready' }}
      onDirtyChange={setDirty} trainingMode recoveredFeedback />
  </>;
}

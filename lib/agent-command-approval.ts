import { BackendError, callBackend } from './api';

type Decision = { accountId: string } & (
  { operation: 'check' } | { operation: 'save'; granted: boolean; ownerSessionToken: string }
);
type Result = { ok?: boolean; granted?: boolean; code?: string };

function commandApprovalBridge() {
  return (window as Window & {
    implexaDesktop?: { commandApproval?: (decision: Decision) => Promise<Result> };
  }).implexaDesktop;
}

export async function commandApprovalAccountMatches(accountId: string) {
  const bridge = commandApprovalBridge();
  if (!bridge) return true;
  return (await bridge.commandApproval?.({ operation: 'check', accountId }))?.ok === true;
}

export async function saveAgentCommandApproval(accountId: string, granted: boolean, token: string) {
  const bridge = commandApprovalBridge();
  if (bridge && typeof bridge.commandApproval !== 'function') {
    throw Error('Update Tukido Desktop or open Settings in your browser.');
  }
  let result: Result;
  try {
    result = bridge?.commandApproval
      ? await bridge.commandApproval({ operation: 'save', accountId, granted, ownerSessionToken: token })
      : await callBackend('/api/v2/me/agent-command-approval', {
        jwt: token, method: 'POST', body: { accountId, granted },
      });
  } catch (error) {
    if (error instanceof BackendError && error.status === 409) throw Error('The account changed. Reload Settings.');
    throw Error('Could not save command permission. Try again.');
  }
  if (result?.code === 'command_approval_account_changed') throw Error('Use the same Tukido account in Desktop and Dashboard.');
  if (result?.ok !== true || result.granted !== granted) throw Error('Could not save command permission. Try again.');
}

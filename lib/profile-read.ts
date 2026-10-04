/**
 * Replaces data-only profile reads that treated a failed lookup as a new account.
 * Only an error-free null result may enter onboarding. Keep the caller's RLS
 * client, selected columns and user-id filter unchanged; never cache membership.
 */
export const PROFILE_READ_TIMEOUT_MS = 4000;

export class ProfileReadUnavailableError extends Error {
  readonly code = 'profile_read_unavailable';
  constructor() {
    super('Account details are temporarily unavailable. Please try again.');
    this.name = 'ProfileReadUnavailableError';
  }
}

type ProfileResult = { data: unknown; error: unknown };
type ProfileQuery = {
  abortSignal(signal: AbortSignal): { maybeSingle(): PromiseLike<ProfileResult> };
};

export async function readUserProfile(query: ProfileQuery): Promise<Record<string, any> | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProfileReadUnavailableError());
    }, PROFILE_READ_TIMEOUT_MS);
  });
  try {
    // The race bounds even a transport that ignores AbortSignal; abort also
    // cancels the real PostgREST request rather than leaving it running.
    const result = await Promise.race([query.abortSignal(controller.signal).maybeSingle(), deadline]);
    if (!result || result.error || result.data === undefined
      || (result.data !== null && (typeof result.data !== 'object' || Array.isArray(result.data)))) {
      throw new ProfileReadUnavailableError();
    }
    return result.data as Record<string, any> | null;
  } catch {
    // Do not expose upstream diagnostics, tokens or row contents in the UI.
    throw new ProfileReadUnavailableError();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

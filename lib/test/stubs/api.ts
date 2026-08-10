export class BackendError extends Error {
  status: number;
  body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
export async function callBackend(path: string, init: unknown) {
  globalThis.__implexaCalls.backend.push({ path, init });
  const reply = globalThis.__implexaBackend;
  return reply ? reply(path, init) : { ok: true };
}

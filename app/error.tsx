'use client';

/** A failed required read is a hold, not onboarding or an empty account. */
export default function PageUnavailable() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div role="alert" className="max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 p-6">
        <h1 className="text-xl font-semibold">Temporarily unavailable</h1>
        <p className="mt-3 text-sm text-ink-300">
          We couldn&apos;t verify the information needed to open this page.
          This does not mean you need a new account or workspace.
        </p>
        <button className="btn-primary mt-5" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </main>
  );
}

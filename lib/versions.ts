// versions.ts — reads the canonical "latest client versions" feed the backend
// serves at GET /api/v2/versions. Drives the Updates surface so users can keep
// their plugin + desktop app current. Single source of truth lives in the
// backend (src/routes/versions.js); bumping a release there updates the
// dashboard without a redeploy.
//
// Degrades gracefully: returns null on any failure so the Updates page can fall
// back to a static "here is how to update" view rather than 500.

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

export type PluginVersion = {
  latest: string;
  update_command: string;
  notes: string | null;
  changelog_url: string | null;
};

export type DesktopVersion = {
  latest: string;
  download_url: string | null;
  notes: string | null;
};

export type LatestVersions = {
  plugin: PluginVersion;
  desktop: DesktopVersion;
};

export async function getLatestVersions(): Promise<LatestVersions | null> {
  try {
    const res = await fetch(`${BACKEND}/api/v2/versions`, {
      signal: AbortSignal.timeout(8000),
      // Refresh every 5 min — matches the backend Cache-Control.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<LatestVersions> & { ok?: boolean };
    if (!body?.plugin || !body?.desktop) return null;
    return {
      plugin: {
        latest: String(body.plugin.latest ?? ''),
        update_command: String(body.plugin.update_command ?? ''),
        notes: body.plugin.notes ?? null,
        changelog_url: body.plugin.changelog_url ?? null,
      },
      desktop: {
        latest: String(body.desktop.latest ?? ''),
        download_url: body.desktop.download_url ?? null,
        notes: body.desktop.notes ?? null,
      },
    };
  } catch {
    return null;
  }
}

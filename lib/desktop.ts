// Desktop handoff helpers (boardroom/HANDOFF_PROCESS.md).
//
// The Implexa desktop app is the one activate/run surface. In a normal browser we
// hand off to it via the implexa:// scheme; inside the app's own window
// (window.implexaDesktop is exposed by its preload) we stay put and render the
// page directly, so a deep link never loops back into itself.
//
// Plain client-usable module: every function guards `typeof window`, so importing
// it from a client component is safe and it no-ops during SSR.

type WindowWithBridge = Window & { implexaDesktop?: unknown };

/** True when this page is running inside the Implexa desktop app's window. */
export function isInDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!(window as WindowWithBridge).implexaDesktop;
}

/** "/workflows/x/activate" -> "implexa://workflows/x/activate". */
export function appDeepLink(path: string): string {
  return `implexa://${path.replace(/^\/+/, '')}`;
}

/**
 * Open the desktop app at `path`. The OS launches the app if it's installed and
 * the implexa:// scheme is registered; otherwise nothing happens (the browser may
 * show a one-time "Open Implexa?" prompt). No-op during SSR.
 */
export function openInApp(path: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = appDeepLink(path);
}

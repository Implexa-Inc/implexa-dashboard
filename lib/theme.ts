/**
 * lib/theme.ts — which color theme a browser gets, decided before first paint.
 *
 * Supersedes the hard-coded `className="dark"` in app/layout.tsx (that forced
 * dark for everyone with no way to see the light theme).
 *
 * THEME_MODE (server env, read in the root layout):
 *   - unset / "dark"  → everyone gets dark (today's behavior, the default).
 *   - "clock"         → light by day, dark from 19:00 to 06:00 in the user's
 *                       local time (same rule as tukido.ai).
 * In either mode a browser may pin a choice with `?theme=light|dark`, and
 * `?theme=auto` clears it. That is how the light theme is previewed on the real
 * app without changing it for anyone else.
 *
 * Owner: founder. Removal condition for THEME_MODE: once the light theme has
 * been checked screen-by-screen (redesign step 3), "clock" becomes the
 * hard-coded behavior and the env var is deleted.
 */

export type ThemeMode = 'dark' | 'clock';

export const THEME_STORAGE_KEY = 'tukido-theme';

export function themeMode(env: Record<string, string | undefined> = process.env): ThemeMode {
  return env.THEME_MODE === 'clock' ? 'clock' : 'dark';
}

/** Dark from 19:00 up to (not including) 06:00, local time. */
export function isNightHour(hour: number): boolean {
  return hour >= 19 || hour < 6;
}

/**
 * Inline <head> script. Plain ES5, no imports: it runs before React and must
 * not throw (storage can be blocked). It re-checks on the next 06:00/19:00
 * boundary and whenever the tab becomes visible again.
 */
export function themeBootScript(mode: ThemeMode): string {
  return `(function(){
var d=document.documentElement,k=${JSON.stringify(THEME_STORAGE_KEY)},mode=${JSON.stringify(mode)},t;
try{var q=new URLSearchParams(location.search).get('theme');
if(q==='auto')localStorage.removeItem(k);else if(q==='light'||q==='dark')localStorage.setItem(k,q);}catch(e){}
function night(){var h=new Date().getHours();return h>=19||h<6;}
function apply(){var p=null;try{p=localStorage.getItem(k);}catch(e){}
var dark=p==='light'?false:p==='dark'?true:(mode==='clock'?night():true);
d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';
clearTimeout(t);if(mode==='clock'&&!p){var n=new Date(),b=new Date(n);b.setMinutes(0,0,0);
b.setHours(n.getHours()<6?6:n.getHours()<19?19:30);t=setTimeout(apply,b-n+1000);}}
apply();document.addEventListener('visibilitychange',function(){if(!document.hidden)apply();});
})();`;
}

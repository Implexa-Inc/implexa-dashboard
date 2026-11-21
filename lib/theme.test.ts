import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNightHour, themeBootScript, themeMode, THEME_STORAGE_KEY, type ThemeMode } from './theme.ts';

test('clock is the launch default; explicit dark remains a temporary rollback', () => {
  assert.equal(themeMode({}), 'clock');
  assert.equal(themeMode({ THEME_MODE: 'dark' }), 'dark');
  assert.equal(themeMode({ THEME_MODE: 'light' }), 'clock');
  assert.equal(themeMode({ THEME_MODE: 'clock' }), 'clock');
});

test('night is 19:00 through 05:59', () => {
  const night = Array.from({ length: 24 }, (_, h) => h).filter(isNightHour);
  assert.deepEqual(night, [0, 1, 2, 3, 4, 5, 19, 20, 21, 22, 23]);
});

/** Runs the real boot script against a minimal fake browser at a given hour. */
function boot(mode: ThemeMode, hour: number, opts: { search?: string; stored?: string | null; storageThrows?: boolean } = {}) {
  const store = new Map<string, string>();
  if (opts.stored) store.set(THEME_STORAGE_KEY, opts.stored);
  const classes = new Set<string>(['dark']);
  const html = {
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
    style: { colorScheme: 'dark' },
  };
  const localStorage = {
    getItem: (k: string) => { if (opts.storageThrows) throw new Error('blocked'); return store.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (opts.storageThrows) throw new Error('blocked'); store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a: unknown[]) {
      if (a.length) super(...(a as [number])); else { super(); this.setHours(hour, 15, 0, 0); }
    }
  }
  const run = new Function('document', 'localStorage', 'location', 'URLSearchParams', 'Date', 'setTimeout', 'clearTimeout',
    themeBootScript(mode));
  run({ documentElement: html, addEventListener() {} }, localStorage, { search: opts.search ?? '' },
    URLSearchParams, FakeDate, () => 0, () => {});
  return { dark: classes.has('dark'), scheme: html.style.colorScheme, stored: store.get(THEME_STORAGE_KEY) ?? null };
}

test('dark mode keeps everyone dark at any hour', () => {
  for (const h of [3, 12, 21]) assert.equal(boot('dark', h).dark, true);
});

test('clock mode: light by day, dark at night, color-scheme follows', () => {
  assert.deepEqual(boot('clock', 12), { dark: false, scheme: 'light', stored: null });
  assert.deepEqual(boot('clock', 21), { dark: true, scheme: 'dark', stored: null });
  assert.equal(boot('clock', 5).dark, true);
  assert.equal(boot('clock', 6).dark, false);
});

test('?theme= pins a per-browser choice in either mode; auto clears it', () => {
  assert.deepEqual(boot('dark', 12, { search: '?theme=light' }), { dark: false, scheme: 'light', stored: 'light' });
  assert.equal(boot('clock', 12, { search: '?theme=dark' }).dark, true);
  assert.equal(boot('dark', 12, { stored: 'light' }).dark, false);
  assert.deepEqual(boot('dark', 12, { stored: 'light', search: '?theme=auto' }), { dark: true, scheme: 'dark', stored: null });
  assert.equal(boot('dark', 12, { search: '?theme=sepia' }).stored, null);
});

test('blocked storage never throws and falls back to the mode', () => {
  assert.equal(boot('clock', 12, { search: '?theme=dark', storageThrows: true }).dark, false);
  assert.equal(boot('dark', 12, { storageThrows: true }).dark, true);
});

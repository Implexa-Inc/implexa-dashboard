'use client';

import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/theme';

type Preference = 'auto' | 'light' | 'dark';

/** A device-local appearance choice; never changes account or run settings. */
export default function ThemeControl({enabled=false}:{enabled?:boolean}) {
  const [preference, setPreference] = useState<Preference>('auto');
  useEffect(() => {
    const sync = () => {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        setPreference(saved === 'light' || saved === 'dark' ? saved : 'auto');
      } catch { setPreference('auto'); }
    };
    sync();
    window.addEventListener('storage', sync);
    document.addEventListener('tukido-theme-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      document.removeEventListener('tukido-theme-change', sync);
    };
  }, []);

  function select(value: Preference) {
    try {
      if (value === 'auto') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, value);
      document.dispatchEvent(new Event('tukido-theme-change'));
    } catch { /* Storage can be disabled; keep the effective theme unchanged. */ }
  }

  if(!enabled)return null;
  return <div className="theme-switch" role="group" aria-label="Appearance">
    {(['auto', 'light', 'dark'] as const).map(value => <button
      key={value} type="button" aria-pressed={preference === value}
      onClick={() => select(value)} title={value === 'auto' ? 'Follow the time of day' : `Use ${value} appearance`}
    >{value[0].toUpperCase() + value.slice(1)}</button>)}
  </div>;
}

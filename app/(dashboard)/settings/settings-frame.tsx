'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';

const sections=[
 ['Account',[['Profile','/settings/account'],['Billing & plan','/settings/billing'],['Team','/settings/team']]],
 ['Your workspace',[['AI engines','/settings/engines'],['Connected accounts','/settings/connections'],['Devices & installs','/settings/api-keys'],['Local key vault','/settings/local-vault'],['Run environment','/settings/run-environment'],['Updates','/settings/updates']]],
 ['Privacy',[['Data & privacy','/settings/data']]],
] as const;

/** Navigation only: each existing page retains its own data and permission gates. */
export default function SettingsFrame({children}:{children:ReactNode}){
 const path=usePathname();
 return <div className="app-page"><div className="app-content settings-frame">
  <nav className="settings-nav" aria-label="Settings sections">
   <Link href="/settings" aria-current={path==='/settings'?'page':undefined} className="settings-overview">Settings</Link>
   {sections.map(([heading,links])=><div key={heading} className="settings-nav-group"><p>{heading}</p>{links.map(([label,href])=><Link key={href} href={href} aria-current={path===href?'page':undefined}>{label}</Link>)}</div>)}
  </nav>
  <article className="settings-main">{children}</article>
 </div></div>;
}

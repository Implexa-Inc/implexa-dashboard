import type { ReactNode } from 'react';

/** Shared mockup page heading: title/description left, actions aligned at its foot. */
export default function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return <header className="app-page-head">
    <div><h1>{title}</h1>{children}</div>
    {actions && <div className="app-page-actions">{actions}</div>}
  </header>;
}

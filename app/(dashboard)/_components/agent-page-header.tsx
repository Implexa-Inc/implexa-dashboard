import type { ReactNode } from 'react';

/** Shared role-neutral header. Actions keep their existing writers. */
export default function AgentPageHeader({ title, description, byline, actions, more, children }: {
  title: ReactNode;
  description: string;
  byline: ReactNode;
  actions?: ReactNode;
  more?: ReactNode;
  children?: ReactNode;
}) {
  const longDescription = description.length > 160;
  return <header className="agent-page-header">
    <div className="agent-page-heading">
      <div className="min-w-0 flex-1">
        {title}
        <div className="agent-description">
          <p className={longDescription ? 'agent-page-lede agent-description-preview' : 'agent-page-lede'}>{description}</p>
          {longDescription && <details><summary>More</summary><p className="text-reading agent-page-lede">{description}</p></details>}
        </div>
        <div className="agent-page-byline">{byline}</div>
      </div>
      {(actions || more) && <div className="flex shrink-0 flex-wrap items-start gap-2">
        {actions}
        {more && <details className="agent-page-more">
          <summary aria-label="More agent actions">⋯</summary>
          <div className="agent-page-menu">{more}</div>
        </details>}
      </div>}
    </div>
    {children}
  </header>;
}

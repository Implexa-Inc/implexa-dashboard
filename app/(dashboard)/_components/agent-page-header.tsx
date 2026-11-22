import type { ReactNode } from 'react';

/** Shared role-neutral header; acquisition and owner actions keep their existing writers. */
export default function AgentPageHeader({ title, description, byline, more, children }: {
  title: ReactNode; description: string; byline: ReactNode; more?: ReactNode; children?: ReactNode;
}) {
  return <header className="agent-page-header"><div className="agent-page-heading"><div className="min-w-0 flex-1">{title}<div className="agent-description"><p className={description.length>160?"agent-page-lede agent-description-preview":"agent-page-lede"}>{description}</p>{description.length>160&&<details><summary>More</summary><p className="agent-page-lede">{description}</p></details>}</div><div className="agent-page-byline">{byline}</div></div>{more&&<details className="agent-page-more"><summary aria-label="More agent actions">⋯</summary><div className="agent-page-menu">{more}</div></details>}</div>{children}</header>;
}

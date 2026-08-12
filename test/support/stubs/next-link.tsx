/**
 * `next/link` stub for rendered tests.
 *
 * Next's real Link reads the App Router context, which does not exist outside a
 * Next render. It emits an `<a href>` in every case the shell uses, so the stub
 * emits exactly that and forwards every other prop untouched — which is what
 * the accessibility and keyboard assertions inspect (`href`, `aria-current`,
 * `class`, and the absence of a `tabindex` that would remove it from the tab
 * order).
 */

import type { AnchorHTMLAttributes, ReactNode } from 'react';

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, children, prefetch, replace, scroll, ...rest }: LinkProps) {
  void prefetch; void replace; void scroll;   // Next-only props, not rendered
  return <a href={href} {...rest}>{children}</a>;
}

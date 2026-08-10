import { createElement, type ReactNode } from 'react';

export default function Link({ href, children, ...rest }: { href: unknown; children?: ReactNode; [key: string]: unknown }) {
  return createElement('a', { href: String(href), ...rest }, children);
}

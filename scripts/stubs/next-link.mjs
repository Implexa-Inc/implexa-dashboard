/** `next/link` outside Next: a plain anchor. The card only needs it to render. */
import { createElement } from 'react';

export default function Link({ href, children, ...rest }) {
  return createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children);
}

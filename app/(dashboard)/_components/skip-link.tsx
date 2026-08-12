import { MAIN_CONTENT_ID } from '@/lib/navigation';

/**
 * "Skip to main content" — the first focusable element on every authed page.
 *
 * Without it, a keyboard or screen-reader user tabs through the brand, four
 * navigation destinations and the account block before reaching the page on
 * every single navigation. Visually hidden until it takes focus
 * (`sr-only focus:not-sr-only`), so it costs sighted users nothing.
 *
 * It only works if its target can hold focus: the layout's `<main>` carries
 * both `id={MAIN_CONTENT_ID}` and `tabIndex={-1}`. Without the tabindex the
 * browser scrolls the page but leaves focus on the link, so the next Tab press
 * lands back in the navigation — the exact bug the link exists to fix.
 */
export default function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-md focus:bg-ink-100 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-950"
    >
      Skip to main content
    </a>
  );
}

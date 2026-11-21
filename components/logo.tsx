/** Founder-provided Tukido wordmarks, used unchanged in both appearances. */
export function Logo({ className = '', height = 24, theme }: {
  className?: string; height?: number; theme?: 'dark' | 'light';
}) {
  const image = theme === 'dark' ? 'url(/brand/tukido-logo-on-dark.svg)'
    : theme === 'light' ? 'url(/brand/tukido-logo.svg)' : 'var(--logo)';
  return <span role="img" aria-label="Tukido" className={className} style={{
    display: 'inline-block', flexShrink: 0, width: height * 649 / 142, height,
    backgroundImage: image, backgroundSize: 'contain', backgroundRepeat: 'no-repeat',
    backgroundPosition: 'left center',
  }} />;
}

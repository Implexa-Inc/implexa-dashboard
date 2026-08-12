/**
 * A very small HTML reader for rendered-markup assertions.
 *
 * Not a browser and not trying to be. `renderToStaticMarkup` gives us the exact
 * HTML the server sends, and these helpers pull elements and attributes back out
 * of it so a test can say "the primary nav exposes these three destinations, the
 * selected one carries aria-current, and none of them is removed from the tab
 * order" without pulling in jsdom.
 *
 * Note the difference from the older source-string tests in this repo: these
 * regexes run over RENDERED OUTPUT, so they observe what the component actually
 * produced for a given pathname — including branches, conditionals and props —
 * rather than checking that a line of source still exists.
 */

/**
 * Every `<tag …>…</tag>` in `html`, nesting-aware, in document order.
 * Returns `{ outer, inner, attrs }` per element.
 */
export function findElements(html, tagName) {
  const out = [];
  const open = new RegExp(`<${tagName}(\\s[^>]*)?>`, 'gi');
  const boundary = new RegExp(`<${tagName}(?:\\s[^>]*)?>|</${tagName}>`, 'gi');

  let m;
  while ((m = open.exec(html)) !== null) {
    const openTag = m[0];
    // Self-closing (React emits these for void elements only, but be safe).
    if (openTag.endsWith('/>')) {
      out.push({ outer: openTag, inner: '', attrs: parseAttrs(openTag) });
      continue;
    }
    boundary.lastIndex = m.index + openTag.length;
    let depth = 1;
    let b;
    let end = -1;
    while ((b = boundary.exec(html)) !== null) {
      depth += b[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { end = b.index; break; }
    }
    if (end === -1) continue;   // unbalanced — ignore rather than guess
    out.push({
      outer: html.slice(m.index, end + `</${tagName}>`.length),
      inner: html.slice(m.index + openTag.length, end),
      attrs: parseAttrs(openTag),
    });
  }
  return out;
}

/** Attributes of a single open tag, as a plain object. */
export function parseAttrs(openTag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(openTag)) !== null) attrs[m[1]] = decodeEntities(m[2]);
  return attrs;
}

/** Visible text of a fragment: tags stripped, entities decoded, whitespace collapsed. */
export function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** Anchors as `{ href, label, attrs }`, in document order. */
export function anchors(html) {
  return findElements(html, 'a').map((el) => ({
    href:  el.attrs.href ?? null,
    label: textOf(el.inner),
    attrs: el.attrs,
  }));
}

/** The single `<nav aria-label="…">` block, or null. */
export function navByLabel(html, label) {
  return findElements(html, 'nav').find((el) => el.attrs['aria-label'] === label) ?? null;
}

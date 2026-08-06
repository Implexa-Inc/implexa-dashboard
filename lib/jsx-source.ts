// TEST TOOLING — imported only by *.test.ts, never by app code (nothing here
// runs in a request or a browser).
//
// WHY IT EXISTS: this repo has no DOM renderer, so several guards assert wiring
// as source text. The obvious way to grab one JSX element is /<Tag[^>]*>/ — and
// it is wrong, because a prop value may legitimately contain '>':
//
//   <Card onSaved={() => refresh()} surface="setup" />
//                          ^ [^>]* stops here, so every later prop is invisible
//
// That failure is silent and it fails OPEN: the assertion that a prop is present
// starts failing on correct code, and the assertion that a prop is ABSENT starts
// passing on code that has it. So the scan is brace-aware and shared, once.

/**
 * Every `<Tag …>` opening element in `source`, as raw text. Scans to the first
 * `>` outside any `{…}` expression, so `foo={a > b}`, arrow-function props, and
 * nested JSX in a prop don't truncate the element early.
 */
export function openingElements(source: string, tag: string): string[] {
  const out: string[] = [];
  const open = `<${tag}`;
  for (let i = source.indexOf(open); i !== -1; i = source.indexOf(open, i + 1)) {
    // Reject `<AgentActionsSomethingElse` — the tag name must end here.
    if (/[A-Za-z0-9_]/.test(source[i + open.length] ?? '')) continue;
    let depth = 0;
    let j = i + open.length;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(source.slice(i, j + 1));
  }
  return out;
}

/**
 * The raw expression a JSX element passes for `prop`, or null when the prop is
 * absent. `{…}` values are returned unwrapped and trimmed; "quoted" values are
 * returned with their quotes, so a caller can tell `foo="null"` from `foo={null}`.
 */
export function propValue(element: string, prop: string): string | null {
  const at = element.search(new RegExp(`(?<![A-Za-z0-9_])${prop}=`));
  if (at === -1) return null;
  const rest = element.slice(at + prop.length + 1);
  if (rest[0] === '"' || rest[0] === "'") {
    const end = rest.indexOf(rest[0], 1);
    return end === -1 ? rest : rest.slice(0, end + 1);
  }
  if (rest[0] !== '{') return null; // bare shorthand isn't valid JSX for a value
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '{') depth++;
    else if (rest[i] === '}' && --depth === 0) return rest.slice(1, i).trim();
  }
  return null;
}

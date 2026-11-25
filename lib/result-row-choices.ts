import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';

// Keep column labels alongside the displayed cell text. Two records can share
// a street name, title or customer name while differing in another column.
export function resultRowChoices(markdown: string): string[] {
  const choices = new Set<string>();
  const doc = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  for (const block of doc.children) {
    if (block.type !== 'table') continue;
    const [header, ...rows] = block.children;
    if (!header) continue;
    const columns = header.children.map(cell => toString(cell).trim());
    for (const row of rows) {
      const text = row.children.map((cell, index) => {
        const value = toString(cell).trim();
        return value && (columns[index] ? columns[index] + ' — ' + value : value);
      }).filter(Boolean).join(' · ');
      if (text && text.length <= 2000) choices.add(text);
    }
  }
  return [...choices];
}

export interface TextPart {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into matching and non-matching parts for the given lower-cased
 * search terms (case-insensitive). Rendering the parts as React elements keeps
 * highlighting free of HTML injection.
 */
export function splitHighlights(text: string, terms: readonly string[]): TextPart[] {
  const usable = terms.filter((term) => term !== '');
  if (usable.length === 0 || text === '') return [{ text, match: false }];

  const lower = text.toLowerCase();
  // A few characters change length when lower-cased; offsets would not line up.
  if (lower.length !== text.length) return [{ text, match: false }];
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of usable) {
    let from = lower.indexOf(term);
    while (from !== -1) {
      marked.fill(true, from, from + term.length);
      from = lower.indexOf(term, from + term.length);
    }
  }

  const parts: TextPart[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marked[i] !== marked[start]) {
      parts.push({ text: text.slice(start, i), match: marked[start] ?? false });
      start = i;
    }
  }
  return parts;
}

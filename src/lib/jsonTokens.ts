export type JsonTokenType =
  'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'plain';

export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

// Strings (optionally followed by a colon, making them keys), numbers,
// literals, and structural punctuation. Anything else is plain text.
const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g;

/** Splits pretty-printed JSON into tokens for syntax coloring. */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > lastIndex)
      tokens.push({ type: 'plain', text: text.slice(lastIndex, match.index) });
    const [whole, string, colon, number, boolean, nullLiteral] = match;
    if (string !== undefined) {
      tokens.push({ type: colon ? 'key' : 'string', text: string });
      if (colon) tokens.push({ type: 'punctuation', text: colon });
    } else if (number !== undefined) {
      tokens.push({ type: 'number', text: number });
    } else if (boolean !== undefined) {
      tokens.push({ type: 'boolean', text: boolean });
    } else if (nullLiteral !== undefined) {
      tokens.push({ type: 'null', text: nullLiteral });
    } else {
      tokens.push({ type: 'punctuation', text: whole });
    }
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < text.length) tokens.push({ type: 'plain', text: text.slice(lastIndex) });
  return tokens;
}

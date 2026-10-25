import { Fragment, useMemo } from 'react';
import { splitHighlights } from '../lib/highlight';

/** Renders text with search matches wrapped in <mark>, without interpreting any HTML. */
export function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  const parts = useMemo(() => splitHighlights(text, terms), [text, terms]);
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * A tiny structured-text format used by diagnoses.
 *
 * It lets the UI render code spans and clickable event references without
 * interpreting any HTML, and lets exporters render the same content as
 * Markdown or plain text.
 */
export type RichSegment =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'event'; eventId: string };

export type RichText = readonly RichSegment[];

type RichValue = string | number | RichSegment | RichText;

export function code(text: string): RichSegment {
  return { type: 'code', text };
}

export function eventRef(eventId: string): RichSegment {
  return { type: 'event', eventId };
}

/**
 * Tagged template for building rich text, e.g.
 * rich`${code(toolName)} timed out at ${eventRef(event.id)}.`
 * Strings and numbers become plain text; segments and rich text are spliced in.
 */
export function rich(strings: TemplateStringsArray, ...values: RichValue[]): RichText {
  const segments: RichSegment[] = [];
  strings.forEach((literal, index) => {
    pushText(segments, literal);
    const value = values[index];
    if (value !== undefined) appendValue(segments, value);
  });
  return segments;
}

/** Joins rich-text fragments with a plain-text separator. */
export function joinRich(parts: readonly RichText[], separator = ' '): RichText {
  const segments: RichSegment[] = [];
  parts.forEach((part, index) => {
    if (index > 0) pushText(segments, separator);
    appendValue(segments, part);
  });
  return segments;
}

export function toPlainText(value: RichText): string {
  return value
    .map((segment) => (segment.type === 'event' ? segment.eventId : segment.text))
    .join('');
}

/** Applies `transform` to every text and code segment (used for redaction). */
export function mapRichText(value: RichText, transform: (text: string) => string): RichText {
  return value.map((segment) =>
    segment.type === 'event' ? segment : { ...segment, text: transform(segment.text) },
  );
}

function isRichText(value: RichValue): value is RichText {
  return Array.isArray(value);
}

function appendValue(segments: RichSegment[], value: RichValue): void {
  if (typeof value === 'string' || typeof value === 'number') {
    pushText(segments, String(value));
  } else if (isRichText(value)) {
    value.forEach((segment) => appendSegment(segments, segment));
  } else {
    appendSegment(segments, value);
  }
}

function appendSegment(segments: RichSegment[], segment: RichSegment): void {
  if (segment.type === 'text') pushText(segments, segment.text);
  else segments.push(segment);
}

function pushText(segments: RichSegment[], text: string): void {
  if (text === '') return;
  const last = segments.at(-1);
  if (last?.type === 'text') {
    segments[segments.length - 1] = { type: 'text', text: last.text + text };
  } else {
    segments.push({ type: 'text', text });
  }
}

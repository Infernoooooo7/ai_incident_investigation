import { Fragment, useId, useMemo, useState } from 'react';
import type { JsonValue } from '../domain/types';
import { cx } from '../lib/cx';
import { tokenizeJson } from '../lib/jsonTokens';
import { CopyButton } from './CopyButton';
import { Highlight } from './Highlight';

const NO_TERMS: readonly string[] = [];
const COLLAPSED_LINES = 14;
const COLLAPSED_CHARS = 1500;

interface CodeBlockProps {
  /** Names the content for the copy button, e.g. "input JSON". */
  label: string;
  terms?: readonly string[];
}

function JsonTokens({ text, terms }: { text: string; terms: readonly string[] }) {
  const tokens = useMemo(() => tokenizeJson(text), [text]);
  return (
    <>
      {tokens.map((token, index) =>
        token.type === 'plain' ? (
          <Fragment key={index}>{token.text}</Fragment>
        ) : (
          <span key={index} className={`json-${token.type}`}>
            <Highlight text={token.text} terms={terms} />
          </span>
        ),
      )}
    </>
  );
}

/**
 * Long content starts collapsed to a few lines (or characters, for long single
 * lines) with an explicit control to expand it; text always wraps.
 */
function CollapsibleCode({
  text,
  kind,
  label,
  terms,
}: CodeBlockProps & { text: string; kind: 'json' | 'text'; terms: readonly string[] }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const lines = useMemo(() => text.split('\n'), [text]);
  const collapsible = lines.length > COLLAPSED_LINES + 2 || text.length > COLLAPSED_CHARS + 200;

  let shown = text;
  if (collapsible && !expanded) {
    shown = lines.slice(0, COLLAPSED_LINES).join('\n');
    if (shown.length > COLLAPSED_CHARS) shown = `${shown.slice(0, COLLAPSED_CHARS)}…`;
  }

  const summary = kind === 'json' ? 'JSON' : 'Text';
  return (
    <div className={cx('code-block', kind === 'text' && 'code-block--text')}>
      <div className="code-block__toolbar">
        <span>
          {summary} · {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        </span>
        <CopyButton text={text} label={label} />
      </div>
      <div className={cx(collapsible && !expanded && 'code-block__fade')}>
        <pre id={contentId}>
          {kind === 'json' ? (
            <JsonTokens text={shown} terms={terms} />
          ) : (
            <Highlight text={shown} terms={terms} />
          )}
        </pre>
      </div>
      {collapsible && (
        <div className="code-block__footer">
          <button
            type="button"
            className="link-button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? 'Show less'
              : `Show all ${lines.length > 1 ? `${lines.length} lines` : 'text'}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Pretty-printed, syntax-colored JSON. Plain strings are shown as wrapped text. */
export function JsonBlock({
  value,
  label,
  terms = NO_TERMS,
}: CodeBlockProps & { value: JsonValue }) {
  const isText = typeof value === 'string';
  const text = useMemo(
    () => (typeof value === 'string' ? value : JSON.stringify(value, null, 2)),
    [value],
  );
  return (
    <CollapsibleCode text={text} kind={isText ? 'text' : 'json'} label={label} terms={terms} />
  );
}

export function TextBlock({ text, label, terms = NO_TERMS }: CodeBlockProps & { text: string }) {
  return <CollapsibleCode text={text} kind="text" label={label} terms={terms} />;
}

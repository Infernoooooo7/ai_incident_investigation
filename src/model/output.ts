/**
 * Validates the local model's answer in code (OWASP LLM01: "use deterministic
 * code to validate adherence" to the expected format) and checks its citations
 * against the run. Nothing the model says is trusted or acted on; this module
 * only decides how to display it.
 */
import { truncate } from '../domain/format';
import { eventRef } from '../domain/richText';
import type { RichSegment, RichText } from '../domain/richText';

export type ClaimKind = 'observation' | 'hypothesis';

export interface ModelClaim {
  kind: ClaimKind;
  statement: string;
  /** Cited event IDs that exist in the run. */
  eventIds: string[];
  /** Cited IDs that do not exist in the run. */
  unknownIds: string[];
  /** True when the claim cites at least one event and every cited ID exists. */
  grounded: boolean;
}

export interface Grounding {
  claims: number;
  grounded: number;
  /** Claims that cite no events at all. */
  uncited: number;
  /** Citations (in claims or the summary) to IDs that are not in the run. */
  unknownCitations: number;
}

export interface ModelSummary {
  /** The summary text with known event IDs turned into event links. */
  summary: RichText;
  claims: ModelClaim[];
  insufficientEvidence: boolean;
  nextCheck: string;
  grounding: Grounding;
}

export type ParsedOutput = { ok: true; value: ModelSummary } | { ok: false; reason: string };

const MAX_SUMMARY_CHARS = 1200;
const MAX_STATEMENT_CHARS = 500;
const MAX_CLAIMS = 12;
const MAX_IDS_PER_CLAIM = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first `{` to the last `}`, which tolerates code fences or a short preamble. */
function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start >= 0 && end > start ? content.slice(start, end + 1) : undefined;
}

const ID_LIKE = /^[A-Za-z][A-Za-z0-9]*[_-][A-Za-z0-9_-]+$/;

/**
 * Turns bracketed citations such as "[evt_04]" or "[evt_04, evt_07]" into
 * event links. Only bracketed tokens are considered, because plain words and
 * numbers in prose could collide with short event IDs. Tokens in a citation
 * group that are not events in the run are reported as unknown.
 */
export function linkEventIds(
  text: string,
  knownIds: ReadonlySet<string>,
): { rich: RichText; unknownIds: string[] } {
  const segments: RichSegment[] = [];
  const unknown = new Set<string>();
  const pushText = (value: string) => {
    if (value === '') return;
    const last = segments.at(-1);
    if (last?.type === 'text')
      segments[segments.length - 1] = { type: 'text', text: last.text + value };
    else segments.push({ type: 'text', text: value });
  };

  let lastIndex = 0;
  for (const group of text.matchAll(/\[([^[\]]{1,200})\]/g)) {
    const tokens = group[1]?.split(/[\s,;]+/).filter(Boolean) ?? [];
    const isCitation =
      tokens.length > 0 &&
      (tokens.some((token) => knownIds.has(token)) || tokens.every((token) => ID_LIKE.test(token)));
    if (!isCitation) continue;
    pushText(text.slice(lastIndex, group.index));
    pushText('[');
    tokens.forEach((token, position) => {
      if (position > 0) pushText(', ');
      if (knownIds.has(token)) {
        segments.push(eventRef(token));
      } else {
        unknown.add(token);
        pushText(token);
      }
    });
    pushText(']');
    lastIndex = group.index + group[0].length;
  }
  pushText(text.slice(lastIndex));
  return { rich: segments, unknownIds: [...unknown] };
}

function parseClaim(item: unknown, knownIds: ReadonlySet<string>): ModelClaim | undefined {
  if (!isRecord(item) || typeof item.statement !== 'string' || item.statement.trim() === '') {
    return undefined;
  }
  // Anything not explicitly an observation is shown as a hypothesis, the more cautious label.
  const kind: ClaimKind = item.kind === 'observation' ? 'observation' : 'hypothesis';
  const cited = Array.isArray(item.event_ids)
    ? [
        ...new Set(
          item.event_ids
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim().replace(/^\[|\]$/g, ''))
            .filter((id) => id !== ''),
        ),
      ].slice(0, MAX_IDS_PER_CLAIM)
    : [];
  const eventIds = cited.filter((id) => knownIds.has(id));
  const unknownIds = cited.filter((id) => !knownIds.has(id));
  return {
    kind,
    statement: truncate(item.statement, MAX_STATEMENT_CHARS),
    eventIds,
    unknownIds,
    grounded: cited.length > 0 && unknownIds.length === 0,
  };
}

export function parseModelOutput(content: string, knownIds: ReadonlySet<string>): ParsedOutput {
  const json = extractJsonObject(content);
  if (json === undefined) return { ok: false, reason: 'The model did not return a JSON object.' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'The model returned malformed JSON.' };
  }
  if (!isRecord(raw)) return { ok: false, reason: 'The model did not return a JSON object.' };
  if (typeof raw.summary !== 'string' || raw.summary.trim() === '') {
    return { ok: false, reason: 'The answer has no summary.' };
  }
  if (!Array.isArray(raw.claims)) return { ok: false, reason: 'The answer has no list of claims.' };
  if (typeof raw.insufficient_evidence !== 'boolean') {
    return { ok: false, reason: 'The answer does not say whether the evidence was sufficient.' };
  }

  const claims = raw.claims
    .slice(0, MAX_CLAIMS)
    .map((item) => parseClaim(item, knownIds))
    .filter((claim): claim is ModelClaim => claim !== undefined);
  const summaryText = truncate(raw.summary, MAX_SUMMARY_CHARS);
  const linked = linkEventIds(summaryText, knownIds);
  const nextCheck = typeof raw.next_check === 'string' ? truncate(raw.next_check, 600) : '';

  return {
    ok: true,
    value: {
      summary: linked.rich,
      claims,
      insufficientEvidence: raw.insufficient_evidence,
      nextCheck,
      grounding: {
        claims: claims.length,
        grounded: claims.filter((claim) => claim.grounded).length,
        uncited: claims.filter((claim) => claim.eventIds.length + claim.unknownIds.length === 0)
          .length,
        unknownCitations:
          claims.reduce((total, claim) => total + claim.unknownIds.length, 0) +
          linked.unknownIds.length,
      },
    },
  };
}

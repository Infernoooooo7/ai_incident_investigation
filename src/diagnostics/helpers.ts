/** Small, pure building blocks shared by the diagnostic rules. */
import { truncate } from '../domain/format';
import { code, eventRef, rich } from '../domain/richText';
import type { RichText } from '../domain/richText';
import type { RunIndex } from '../domain/runIndex';
import type {
  AgentEvent,
  JsonObject,
  JsonValue,
  ToolCallEvent,
  ToolResultEvent,
} from '../domain/types';
import type { Confidence, Evidence } from './types';

export function position(index: RunIndex, event: AgentEvent): number {
  return index.positionById.get(event.id) ?? -1;
}

export function eventsAfter(index: RunIndex, event: AgentEvent): AgentEvent[] {
  return index.run.events.slice(position(index, event) + 1);
}

export function isFailedResult(event: AgentEvent): event is ToolResultEvent {
  return event.kind === 'tool_result' && event.outcome !== 'success';
}

export function isSuccessfulResultFor(toolName: string) {
  return (event: AgentEvent): event is ToolResultEvent =>
    event.kind === 'tool_result' && event.toolName === toolName && event.outcome === 'success';
}

export function lowerConfidence(confidence: Confidence): Confidence {
  return confidence === 'high' ? 'medium' : 'low';
}

export function quote(text: string, maxLength = 140): string {
  return `"${truncate(text, maxLength)}"`;
}

/** "." unless `text` (possibly quoted) already ends a sentence, to avoid `access.".` */
export function sentenceEnd(text: string): string {
  return /[.!?]["')\]]*$/.test(text.trim()) ? '' : '.';
}

/** "stopped with `ToolTimeoutError` at evt_08", or "stopped at evt_08" for non-error events. */
export function stoppedAt(event: AgentEvent): RichText {
  return event.kind === 'error'
    ? rich`stopped with ${code(event.errorType)} at ${eventRef(event.id)}`
    : rich`stopped at ${eventRef(event.id)}`;
}

export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Orders evidence by event position and drops duplicate event IDs (first note wins). */
export function orderEvidence(index: RunIndex, evidence: readonly Evidence[]): Evidence[] {
  const unique = new Map<string, Evidence>();
  for (const item of evidence) {
    if (index.byId.has(item.eventId) && !unique.has(item.eventId)) unique.set(item.eventId, item);
  }
  const at = (item: Evidence) => index.positionById.get(item.eventId) ?? 0;
  return [...unique.values()].sort((a, b) => at(a) - at(b));
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collapses an error into a comparable signature so that repeated failures
 * match despite differing request IDs, durations, or counts.
 */
export function failureSignature(result: ToolResultEvent): string {
  if (result.errorCode) return `${result.outcome}:${result.errorCode.toUpperCase()}`;
  return `${result.outcome}:${normalizeErrorMessage(result.errorMessage ?? '')}`;
}

export function normalizeErrorMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b(?:req|request|trace|span|call)[_-][a-z0-9]+\b/g, '<id>')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short human label for a failure, e.g. TIMEOUT or the quoted message. */
export function failureLabel(result: ToolResultEvent): string {
  if (result.errorCode) return result.errorCode;
  if (result.outcome === 'timeout') return 'timeout';
  return result.errorMessage ? quote(result.errorMessage, 60) : 'error';
}

const VALIDATION_WORDS =
  /\b(?:validation|invalid|malformed|required|must (?:be|not)|expected|schema|parse|missing|non-empty)\b/i;
const VALIDATION_CODES = /VALIDATION|INVALID|BAD_REQUEST|SCHEMA|PARSE/i;
const INPUT_WORDS = /\b(?:input|argument|arguments|json|body|payload)\b/i;
const DETERMINISTIC_CODES =
  /VALIDATION|INVALID|BAD_REQUEST|SCHEMA|PARSE|NOT_FOUND|PERMISSION|FORBIDDEN|UNAUTHORI[SZ]ED|DENIED/i;
const TRANSIENT_CODES =
  /TIMEOUT|TIMED_OUT|RATE_LIMIT|THROTTL|UNAVAILABLE|OVERLOADED|5\d\d|UPSTREAM/i;

export type FailureClass = 'deterministic' | 'transient' | 'unknown';

/** Whether retrying unchanged could plausibly succeed. */
export function classifyFailure(result: ToolResultEvent): FailureClass {
  if (result.outcome === 'timeout') return 'transient';
  const text = `${result.errorCode ?? ''} ${result.errorMessage ?? ''}`;
  if (DETERMINISTIC_CODES.test(text) || VALIDATION_WORDS.test(text)) return 'deterministic';
  if (TRANSIENT_CODES.test(text) || /\b429\b|too many requests/i.test(text)) return 'transient';
  return 'unknown';
}

export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
    );
  }
  return false;
}

/** Top-level argument names whose values differ between any of the inputs. */
export function changedArgumentNames(inputs: ReadonlyArray<JsonValue | undefined>): string[] {
  const objects = inputs.filter(isJsonObject);
  if (objects.length !== inputs.length) return [];
  const keys = new Set(objects.flatMap((input) => Object.keys(input)));
  return [...keys].filter((key) =>
    objects.some((input) => !jsonEqual(input[key], objects[0]?.[key])),
  );
}

export interface InputProblem {
  /** Dotted path of the offending argument; absent when the input as a whole is the problem. */
  field?: string;
  /** e.g. "is null", "is an empty array", "is not valid JSON". */
  issue: string;
}

function describeEmptiness(value: JsonValue): string | undefined {
  if (value === null) return 'is null';
  if (typeof value === 'string' && value.trim() === '') return 'is an empty string';
  if (Array.isArray(value) && value.length === 0) return 'is an empty array';
  if (isJsonObject(value) && Object.keys(value).length === 0) return 'is an empty object';
  return undefined;
}

function collectEmptyFields(
  value: JsonObject,
  prefix: string,
  depth: number,
  problems: InputProblem[],
): void {
  for (const [key, entry] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    const issue = describeEmptiness(entry);
    if (issue) problems.push({ field, issue });
    else if (isJsonObject(entry) && depth < 2)
      collectEmptyFields(entry, field, depth + 1, problems);
  }
}

/** Empty, null, or unparseable arguments in a tool call's input. */
export function findInputProblems(input: JsonValue | undefined): InputProblem[] {
  if (input === undefined) return [];
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return [{ issue: 'the input is an empty string' }];
    if (/^[[{]/.test(trimmed)) {
      try {
        JSON.parse(trimmed);
      } catch {
        return [{ issue: 'the input is not valid JSON (it may have been truncated)' }];
      }
    }
    return [];
  }
  if (isJsonObject(input)) {
    if (Object.keys(input).length === 0) return [{ issue: 'no arguments were provided' }];
    const problems: InputProblem[] = [];
    collectEmptyFields(input, '', 0, problems);
    return problems;
  }
  const issue = describeEmptiness(input);
  return issue ? [{ issue: `the input ${issue}` }] : [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionsField(errorText: string, field: string): boolean {
  const leaf = field.split('.').at(-1) ?? field;
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(leaf)}(?:[^A-Za-z0-9_]|$)`, 'i').test(
    errorText,
  );
}

export interface MalformedCall {
  call: ToolCallEvent;
  result: ToolResultEvent;
  problems: InputProblem[];
  /** The error reads like a validation error. */
  validationLike: boolean;
  /** The error names an offending field (or the input as a whole). */
  fieldMentioned: boolean;
}

/**
 * Decides whether a failed result is plausibly explained by its call's empty
 * or malformed input. Requires at least one signal in the error text, so an
 * unrelated failure on a call that merely has an optional null field is not
 * blamed on the input.
 */
export function classifyMalformedCall(
  index: RunIndex,
  result: ToolResultEvent,
): MalformedCall | undefined {
  if (result.outcome !== 'error') return undefined;
  const call = index.callsByCallId.get(result.callId);
  if (!call) return undefined;
  const problems = findInputProblems(call.input);
  if (problems.length === 0) return undefined;

  const errorText = `${result.errorCode ?? ''} ${result.errorMessage ?? ''}`;
  const validationLike =
    VALIDATION_WORDS.test(errorText) || VALIDATION_CODES.test(result.errorCode ?? '');
  const fieldMentioned = problems.some((problem) =>
    problem.field ? mentionsField(errorText, problem.field) : INPUT_WORDS.test(errorText),
  );
  if (!validationLike && !fieldMentioned) return undefined;
  return { call, result, problems, validationLike, fieldMentioned };
}

const DATA_KEYS = /^(?:rows|results|items|data|records|entries|hits|matches|documents|values)$/i;
const COUNT_KEYS = /^(?:row_?count|count|total|total_?count|num_?results|result_?count)$/i;

export interface EmptyOutput {
  /** The field that shows emptiness, if the output is an object. */
  field?: string;
  issue: string;
}

/** Describes why a successful tool output looks empty, or undefined if it has data. */
export function describeEmptyOutput(output: JsonValue | undefined): EmptyOutput | undefined {
  if (output === undefined || output === null) return { issue: 'returned no output' };
  if (typeof output === 'string') {
    return output.trim() === '' ? { issue: 'returned an empty string' } : undefined;
  }
  if (Array.isArray(output))
    return output.length === 0 ? { issue: 'returned an empty list' } : undefined;
  if (!isJsonObject(output)) return undefined;

  const entries = Object.entries(output);
  if (entries.length === 0) return { issue: 'returned an empty object' };
  const emptyData = entries.find(
    ([key, value]) => DATA_KEYS.test(key) && Array.isArray(value) && value.length === 0,
  );
  if (emptyData) return { field: emptyData[0], issue: 'is an empty list' };
  const zeroCount = entries.find(([key, value]) => COUNT_KEYS.test(key) && value === 0);
  if (zeroCount) return { field: zeroCount[0], issue: 'is 0' };
  return undefined;
}

/** Request identifiers recorded in an event's metadata, for log lookups. */
export function findRequestIds(event: AgentEvent): string[] {
  const ids: string[] = [];
  const consider = (value: JsonValue | undefined) => {
    if (typeof value === 'string' && value.trim() !== '') ids.push(value);
  };
  const metadata = event.metadata;
  consider(metadata.request_id);
  consider(metadata.requestId);
  consider(metadata['x-request-id']);
  const headers = metadata.request_headers;
  if (isJsonObject(headers)) consider(headers['x-request-id']);
  return ids;
}

/** A timeout setting recorded in call metadata, e.g. `timeout_ms: null`. */
export function findTimeoutSetting(
  event: AgentEvent,
): { key: string; value: JsonValue } | undefined {
  for (const key of ['timeout_ms', 'timeoutMs', 'timeout_s', 'timeout']) {
    if (Object.hasOwn(event.metadata, key)) {
      return { key, value: event.metadata[key] ?? null };
    }
  }
  return undefined;
}

export function stringMetadata(event: AgentEvent, key: string): string | undefined {
  const value = event.metadata[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Boundary validation for run data.
 *
 * Everything that enters the app (bundled examples or user imports) is treated
 * as `unknown` and checked here. A run is rejected only when its envelope is
 * invalid; individual malformed events are skipped and reported so the rest of
 * the trace can still be investigated. Messages are written in plain language
 * to follow the field name, e.g. "timestamp should be a full date and time…".
 */
import { truncate } from '../domain/format';
import {
  EVENT_KINDS,
  EVENT_STATUSES,
  MESSAGE_ROLES,
  PERMISSION_DECIDERS,
  PERMISSION_DECISIONS,
  RUN_STATUSES,
  TOOL_OUTCOMES,
} from '../domain/types';
import type { AgentEvent, AgentRun, JsonObject, JsonValue } from '../domain/types';
import type { SkippedRecord, ValidationIssue } from './types';

/** Larger runs are rejected rather than freezing the browser. */
export const MAX_EVENTS_PER_RUN = 20_000;

export type RunParseResult =
  | { ok: true; run: AgentRun; skipped: SkippedRecord[]; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

type EventParseResult = { ok: true; event: AgentEvent } | { ok: false; issues: ValidationIssue[] };

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_JSON_DEPTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Describes a value for error messages, e.g. `a number (7)` or `text ("22:19:44")`. */
function describe(value: unknown): string {
  if (value === null) return 'empty (null)';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return `text ("${truncate(value, 40)}")`;
  if (typeof value === 'number') return `a number (${value})`;
  if (typeof value === 'boolean') return `${value}`;
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

function listChoices(choices: readonly string[]): string {
  return choices.join(', ');
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (isRecord(value)) return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  return false;
}

interface NumberRules {
  integer?: boolean;
  min?: number;
}

/**
 * Reads typed fields from an untrusted record, recording an issue for each
 * invalid field. Invalid required fields return a placeholder value, so
 * callers must discard the result whenever any issue was recorded.
 */
function createReader(record: Record<string, unknown>, path: string, issues: ValidationIssue[]) {
  const at = (key: string) => (path ? `${path}.${key}` : key);
  const report = (key: string, message: string) => issues.push({ path: at(key), message });
  const isAbsent = (value: unknown) => value === undefined || value === null;

  function optionalString(key: string): string | undefined {
    const value = record[key];
    if (isAbsent(value)) return undefined;
    if (typeof value !== 'string') {
      report(key, `should be text, but it is ${describe(value)}`);
      return undefined;
    }
    return value;
  }

  function string(key: string): string {
    if (isAbsent(record[key])) {
      report(key, 'is missing');
      return '';
    }
    const value = optionalString(key) ?? '';
    if (typeof record[key] === 'string' && value.trim() === '') report(key, 'is empty');
    return value;
  }

  function optionalNumber(key: string, rules: NumberRules = {}): number | undefined {
    const value = record[key];
    if (isAbsent(value)) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      report(key, `should be a number, but it is ${describe(value)}`);
      return undefined;
    }
    if (rules.integer && !Number.isInteger(value)) {
      report(key, `should be a whole number (got ${value})`);
    }
    if (rules.min !== undefined && value < rules.min) {
      report(
        key,
        rules.min === 0
          ? `can't be negative (got ${value})`
          : `should be at least ${rules.min} (got ${value})`,
      );
    }
    return value;
  }

  function number(key: string, rules: NumberRules = {}): number {
    if (isAbsent(record[key])) {
      report(key, 'is missing');
      return 0;
    }
    return optionalNumber(key, rules) ?? 0;
  }

  function boolean(key: string): boolean {
    const value = record[key];
    if (typeof value !== 'boolean') {
      report(
        key,
        isAbsent(value)
          ? 'is missing (expected true or false)'
          : `should be true or false, but it is ${describe(value)}`,
      );
      return false;
    }
    return value;
  }

  function oneOf<T extends string>(key: string, allowed: readonly T[]): T {
    const value = record[key];
    const match = allowed.find((option) => option === value);
    if (match === undefined) {
      report(
        key,
        isAbsent(value)
          ? `is missing (expected one of: ${listChoices(allowed)})`
          : `should be one of: ${listChoices(allowed)}, but it is ${describe(value)}`,
      );
      return allowed[0] as T;
    }
    return match;
  }

  function timestamp(key: string): string {
    const value = record[key];
    if (
      typeof value === 'string' &&
      ISO_TIMESTAMP.test(value) &&
      !Number.isNaN(Date.parse(value))
    ) {
      return value;
    }
    report(
      key,
      isAbsent(value)
        ? 'is missing'
        : `should be a full date and time with a timezone, such as 2026-10-24T14:02:11Z, but it is ${describe(value)}`,
    );
    return '';
  }

  function optionalJson(key: string): JsonValue | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    if (!isJsonValue(value)) {
      report(key, 'contains values that are not plain JSON');
      return undefined;
    }
    return value;
  }

  function jsonObject(key: string): JsonObject {
    const value = record[key];
    if (isAbsent(value)) return {};
    if (!isRecord(value) || !isJsonValue(value)) {
      report(key, `should be an object of key-value pairs, but it is ${describe(value)}`);
      return {};
    }
    return value as JsonObject;
  }

  return {
    string,
    optionalString,
    number,
    optionalNumber,
    boolean,
    oneOf,
    timestamp,
    optionalJson,
    jsonObject,
  };
}

function parseEvent(raw: unknown, path: string): EventParseResult {
  if (!isRecord(raw)) {
    return {
      ok: false,
      issues: [{ path, message: `should be an event object, but it is ${describe(raw)}` }],
    };
  }
  const issues: ValidationIssue[] = [];
  const read = createReader(raw, path, issues);
  const base = {
    id: read.string('id'),
    sequence: read.number('sequence', { integer: true, min: 0 }),
    timestamp: read.timestamp('timestamp'),
    status: read.oneOf('status', EVENT_STATUSES),
    name: read.optionalString('name'),
    durationMs: read.optionalNumber('durationMs', { min: 0 }),
    input: read.optionalJson('input'),
    output: read.optionalJson('output'),
    metadata: read.jsonObject('metadata'),
  };

  // Kind-specific fields are meaningless for an unknown kind, so stop here
  // rather than reporting a cascade of misleading "is missing" issues.
  const issuesBeforeKind = issues.length;
  const kind = read.oneOf('kind', EVENT_KINDS);
  if (issues.length > issuesBeforeKind) return { ok: false, issues };

  let event: AgentEvent;
  switch (kind) {
    case 'agent_message':
      event = {
        ...base,
        kind,
        role: read.oneOf('role', MESSAGE_ROLES),
        text: read.string('text'),
      };
      break;
    case 'tool_call':
      event = { ...base, kind, toolName: read.string('toolName'), callId: read.string('callId') };
      break;
    case 'tool_result':
      event = {
        ...base,
        kind,
        toolName: read.string('toolName'),
        callId: read.string('callId'),
        outcome: read.oneOf('outcome', TOOL_OUTCOMES),
        errorCode: read.optionalString('errorCode'),
        errorMessage: read.optionalString('errorMessage'),
      };
      break;
    case 'retry':
      event = {
        ...base,
        kind,
        attempt: read.number('attempt', { integer: true, min: 1 }),
        maxAttempts: read.optionalNumber('maxAttempts', { integer: true, min: 1 }),
        reason: read.string('reason'),
        toolName: read.optionalString('toolName'),
        previousCallId: read.optionalString('previousCallId'),
        backoffMs: read.optionalNumber('backoffMs', { min: 0 }),
      };
      break;
    case 'error':
      event = {
        ...base,
        kind,
        errorType: read.string('errorType'),
        message: read.string('message'),
        fatal: read.boolean('fatal'),
        callId: read.optionalString('callId'),
      };
      break;
    case 'permission_decision':
      event = {
        ...base,
        kind,
        toolName: read.string('toolName'),
        action: read.string('action'),
        decision: read.oneOf('decision', PERMISSION_DECISIONS),
        decidedBy: read.oneOf('decidedBy', PERMISSION_DECIDERS),
        policy: read.optionalString('policy'),
        reason: read.optionalString('reason'),
        callId: read.optionalString('callId'),
      };
      break;
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, event: withoutUndefined(event) };
}

/** Drops keys whose value is undefined so parsed events match their source shape. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function readableId(raw: unknown): string | undefined {
  return isRecord(raw) && typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id : undefined;
}

/** Validates one run. `path` prefixes issue locations, e.g. `runs[2]`. */
export function parseRun(raw: unknown, path = ''): RunParseResult {
  const label = path || 'run';
  if (!isRecord(raw)) {
    return {
      ok: false,
      issues: [{ path: label, message: `should be a run object, but it is ${describe(raw)}` }],
    };
  }

  const issues: ValidationIssue[] = [];
  const read = createReader(raw, path, issues);
  const envelope = {
    id: read.string('id'),
    agentName: read.string('agentName'),
    agentVersion: read.optionalString('agentVersion'),
    task: read.string('task'),
    summary: read.optionalString('summary') ?? '',
    status: read.oneOf('status', RUN_STATUSES),
    startedAt: read.timestamp('startedAt'),
    endedAt: read.timestamp('endedAt'),
    metadata: read.jsonObject('metadata'),
  };
  const rawEvents = raw.events;
  const eventsPath = path ? `${path}.events` : 'events';
  if (!Array.isArray(rawEvents)) {
    issues.push({
      path: eventsPath,
      message:
        rawEvents === undefined
          ? 'is missing (expected a list of events)'
          : `should be a list of events, but it is ${describe(rawEvents)}`,
    });
  } else if (rawEvents.length > MAX_EVENTS_PER_RUN) {
    issues.push({
      path: eventsPath,
      message: `has ${rawEvents.length.toLocaleString('en-US')} events; the limit is ${MAX_EVENTS_PER_RUN.toLocaleString('en-US')} per run`,
    });
  }
  if (issues.length > 0 || !Array.isArray(rawEvents)) return { ok: false, issues };

  const events: AgentEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const seenIds = new Set<string>();
  rawEvents.forEach((rawEvent: unknown, index) => {
    const eventPath = `${eventsPath}[${index}]`;
    const result = parseEvent(rawEvent, eventPath);
    const id = readableId(rawEvent);
    if (!result.ok) {
      skipped.push({ index, id, issues: result.issues, raw: rawEvent });
    } else if (seenIds.has(result.event.id)) {
      skipped.push({
        index,
        id,
        issues: [
          {
            path: `${eventPath}.id`,
            message: `reuses the event ID "${id}", which an earlier event already has`,
          },
        ],
        raw: rawEvent,
      });
    } else {
      seenIds.add(result.event.id);
      events.push(result.event);
    }
  });

  events.sort(
    (a, b) => a.sequence - b.sequence || Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  const run = withoutUndefined({ ...envelope, events });
  return { ok: true, run, skipped, warnings: collectWarnings(run) };
}

/** Consistency problems that are worth showing but do not make the data unusable. */
function collectWarnings(run: AgentRun): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.endedAt);
  if (end < start) {
    warnings.push({
      path: 'endedAt',
      message: 'is earlier than startedAt, so the run duration is unknown',
    });
  }
  const seenSequences = new Set<number>();
  for (const event of run.events) {
    const time = Date.parse(event.timestamp);
    if (time < start || (end >= start && time > end)) {
      warnings.push({
        path: `event ${event.id}`,
        message: 'has a timestamp outside the run start and end times',
      });
    }
    if (seenSequences.has(event.sequence)) {
      warnings.push({
        path: `event ${event.id}`,
        message: `repeats sequence number ${event.sequence}, so event order may be ambiguous`,
      });
    }
    seenSequences.add(event.sequence);
  }
  return warnings;
}

export interface RunCollectionResult {
  runs: Array<{ run: AgentRun; skipped: SkippedRecord[]; warnings: ValidationIssue[] }>;
  rejected: Array<{ label: string; issues: ValidationIssue[] }>;
}

/**
 * Accepts a single run, an array of runs, or `{ "runs": [...] }`.
 * Each run is validated independently.
 */
export function parseRunCollection(raw: unknown): RunCollectionResult {
  const result: RunCollectionResult = { runs: [], rejected: [] };
  let items: unknown[];
  let prefix: string;
  if (Array.isArray(raw)) {
    items = raw;
    prefix = '';
  } else if (isRecord(raw) && Array.isArray(raw.runs)) {
    items = raw.runs;
    prefix = 'runs';
  } else if (isRecord(raw) && 'events' in raw) {
    items = [raw];
    prefix = '';
  } else {
    result.rejected.push({
      label: 'file',
      issues: [
        {
          path: '(file)',
          message:
            'does not look like a run. Expected a run object, a list of runs, or an object with a "runs" list.',
        },
      ],
    });
    return result;
  }

  items.forEach((item, index) => {
    const path = items.length === 1 && prefix === '' ? '' : `${prefix}[${index}]`;
    const parsed = parseRun(item, path);
    if (parsed.ok) {
      result.runs.push({ run: parsed.run, skipped: parsed.skipped, warnings: parsed.warnings });
    } else {
      result.rejected.push({
        label: readableId(item) ?? `run ${index + 1}`,
        issues: parsed.issues,
      });
    }
  });
  return result;
}

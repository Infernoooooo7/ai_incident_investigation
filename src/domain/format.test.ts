import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatOffset,
  formatShortDateTime,
  formatUtcDateTime,
  formatUtcTime,
  msBetween,
  pluralize,
  truncate,
} from './format';

describe('formatDuration', () => {
  it.each([
    [0, '0 ms'],
    [640, '640 ms'],
    [30012, '30.0 s'],
    [59_949, '59.9 s'],
    [59_960, '1m 00s'],
    [605_208, '10m 05s'],
    [3_723_000, '1h 02m'],
  ])('formats %d ms as %s', (ms, expected) => expect(formatDuration(ms)).toBe(expected));

  it('shows a dash for unknown or negative durations', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('time formatting', () => {
  it('formats offsets from the run start', () => {
    expect(formatOffset(0)).toBe('+00:00.0');
    expect(formatOffset(31_850)).toBe('+00:31.8');
    expect(formatOffset(3_723_400)).toBe('+1:02:03.4');
    expect(formatOffset(-1500)).toBe('−00:01.5');
  });

  it('formats UTC timestamps deterministically', () => {
    const iso = '2026-10-24T14:02:11.204Z';
    expect(formatUtcDateTime(iso)).toBe('2026-10-24 14:02:11 UTC');
    expect(formatUtcTime(iso)).toBe('14:02:11.204');
    expect(formatShortDateTime(iso)).toBe('Oct 24, 14:02 UTC');
    expect(formatUtcDateTime('not a date')).toBe('not a date');
  });

  it('measures time between timestamps', () => {
    expect(msBetween('2026-10-24T14:02:11.204Z', '2026-10-24T14:03:17.512Z')).toBe(66_308);
    expect(msBetween('bad', '2026-10-24T14:03:17.512Z')).toBeUndefined();
  });
});

describe('text helpers', () => {
  it('pluralizes and truncates', () => {
    expect(pluralize(1, 'event')).toBe('1 event');
    expect(pluralize(3, 'event')).toBe('3 events');
    expect(truncate('a  b\nc', 10)).toBe('a b c');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});

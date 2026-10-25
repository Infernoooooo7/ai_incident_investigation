import { describe, expect, it } from 'vitest';
import { splitHighlights } from './highlight';

describe('splitHighlights', () => {
  it('marks case-insensitive matches', () => {
    expect(splitHighlights('Tickets timed out', ['timed'])).toEqual([
      { text: 'Tickets ', match: false },
      { text: 'timed', match: true },
      { text: ' out', match: false },
    ]);
  });

  it('merges overlapping and adjacent matches', () => {
    expect(splitHighlights('timeout', ['time', 'meout'])).toEqual([
      { text: 'timeout', match: true },
    ]);
  });

  it('returns the text unchanged with no terms', () => {
    expect(splitHighlights('abc', [])).toEqual([{ text: 'abc', match: false }]);
    expect(splitHighlights('', ['a'])).toEqual([{ text: '', match: false }]);
  });
});

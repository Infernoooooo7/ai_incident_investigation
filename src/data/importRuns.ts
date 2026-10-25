import type { ImportOrigin, LoadedRun, ValidationIssue } from './types';
import { parseRunCollection } from './validate';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface ImportProblem {
  /** The run ID, or "file" for problems with the file as a whole. */
  label: string;
  issues: ValidationIssue[];
}

export interface ImportOutcome {
  runs: LoadedRun[];
  problems: ImportProblem[];
}

function fileProblem(message: string): ImportOutcome {
  return { runs: [], problems: [{ label: 'file', issues: [{ path: '(file)', message }] }] };
}

/**
 * Parses the text of an imported JSON file (or pasted JSON). Everything stays
 * in the browser. Runs whose IDs are already loaded are reported rather than
 * silently replacing existing data.
 */
export function parseImportText(
  text: string,
  existingIds: ReadonlySet<string>,
  origin: ImportOrigin,
): ImportOutcome {
  if (text.trim() === '') return fileProblem('is empty');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fileProblem(`is not valid JSON (${detail})`);
  }

  const collection = parseRunCollection(raw);
  if (collection.runs.length === 0 && collection.rejected.length === 0) {
    return fileProblem('contains no runs');
  }
  const problems: ImportProblem[] = collection.rejected.map(({ label, issues }) => ({
    label,
    issues,
  }));
  const runs: LoadedRun[] = [];
  const seenIds = new Set(existingIds);
  for (const parsed of collection.runs) {
    if (seenIds.has(parsed.run.id)) {
      problems.push({
        label: parsed.run.id,
        issues: [
          {
            path: 'id',
            message: 'is already imported. Give the run a different ID to import it again.',
          },
        ],
      });
      continue;
    }
    seenIds.add(parsed.run.id);
    runs.push({ ...parsed, source: 'import', origin });
  }
  return { runs, problems };
}

/** Reads a user-selected file, enforcing the size limit before reading it into memory. */
export async function readImportFile(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`"${file.name}" is ${sizeMb} MB; the import limit is 5 MB.`);
  }
  return file.text();
}

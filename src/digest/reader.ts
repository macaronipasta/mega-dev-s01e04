import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest } from './types.js';

type Run = {
  at: string;
  job: string;
  status: DigestRow['lastStatus'];
  owner: string | null;
  error?: string;
};

function parseRun(line: string): Run | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.at !== 'string' || !Number.isFinite(Date.parse(record.at)) ||
    typeof record.job !== 'string' || record.job.length === 0 ||
    (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') ||
    (typeof record.owner !== 'string' && record.owner !== null) ||
    (record.error !== undefined && typeof record.error !== 'string')
  ) return null;
  return {
    at: record.at,
    job: record.job,
    status: record.status,
    owner: record.owner,
    ...(record.error === undefined ? {} : { error: record.error }),
  };
}

export function readNight(runsDir: string, night: string): NightDigest | null {
  // Match the same filename format as nightsOnDisk; never let a name escape runsDir.
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const rows = new Map<string, DigestRow>();
  const times = new Map<string, { first: number; last: number; error: number }>();
  let badLines = 0;
  const lines = contents.split('\n');
  // A terminating newline is a delimiter, not an additional invalid record.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const run = parseRun(line);
    if (!run) {
      badLines++;
      continue;
    }
    const timestamp = Date.parse(run.at);
    const row = rows.get(run.job);
    if (!row) {
      rows.set(run.job, {
        job: run.job,
        owner: run.owner,
        runs: 1,
        retries: run.status === 'retry' ? 1 : 0,
        lastStatus: run.status,
        lastError: run.error ?? null,
        firstAt: run.at,
        lastAt: run.at,
      });
      times.set(run.job, { first: timestamp, last: timestamp, error: run.error === undefined ? -Infinity : timestamp });
      continue;
    }
    const time = times.get(run.job)!;
    row.runs++;
    if (run.status === 'retry') row.retries++;
    if (timestamp < time.first) {
      row.firstAt = run.at;
      time.first = timestamp;
    }
    if (timestamp >= time.last) {
      row.lastAt = run.at;
      row.lastStatus = run.status;
      row.owner = run.owner;
      time.last = timestamp;
    }
    if (run.error !== undefined && timestamp >= time.error) {
      row.lastError = run.error;
      time.error = timestamp;
    }
  }
  return { rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0), badLines };
}

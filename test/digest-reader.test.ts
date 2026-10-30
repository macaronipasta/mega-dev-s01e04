import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const fixtureDir = fileURLToPath(new URL('../runs/', import.meta.url));
const tempDirs: string[] = [];

function tempRuns(contents: string): string {
  const dir = mkdtempSync(join(process.cwd(), '.digest-reader-test-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), contents);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('summarizes the plan fixture without dropping the null owner or bad line', () => {
    expect(readNight(fixtureDir, '2026-10-28')).toEqual({
      badLines: 1,
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('returns null for missing or unsafe names, without reading outside runsDir', () => {
    const dir = tempRuns('');
    writeFileSync(join(dir, '2026-10-28\n.jsonl'), '');
    for (const night of ['2026-10-29', '../2026-10-28', '2026-10-28/../2026-10-28', '2026-10-28.jsonl', '', '/2026-10-28', '2026-10-28\n']) {
      expect(readNight(dir, night)).toBeNull();
    }
  });

  it('returns an empty digest for an empty file and counts malformed records', () => {
    expect(readNight(tempRuns(''), '2026-10-28')).toEqual({ rows: [], badLines: 0 });
    const dir = tempRuns('{bad json\nnull\n{"at":"bad","job":"x","status":"ok","owner":null}\n{"at":"2026-10-28T10:00:00+01:00","job":"x","status":"unknown","owner":null}\n\n');
    expect(readNight(dir, '2026-10-28')).toEqual({ rows: [], badLines: 5 });
  });

  it('orders times by instant, preserves offsets, and keeps the latest error across recovery', () => {
    const dir = tempRuns([
      JSON.stringify({ at: '2026-10-28T11:00:00+02:00', job: 'job', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T08:30:00+01:00', job: 'job', status: 'retry', owner: 'old', error: 'earlier' }),
      JSON.stringify({ at: '2026-10-28T10:00:00+02:00', job: 'job', status: 'fail', owner: 'old', error: 'later' }),
    ].join('\n') + '\n');
    expect(readNight(dir, '2026-10-28')).toEqual({
      badLines: 0,
      rows: [{ job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'later', firstAt: '2026-10-28T08:30:00+01:00', lastAt: '2026-10-28T11:00:00+02:00' }],
    });
  });
});

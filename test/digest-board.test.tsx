import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readStatus } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest links on the status board', () => {
  it('links each night and counts each job by its last status', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    dirs.push(runsDir);
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      '{"at":"2026-10-28T01:00:00+01:00","job":"alpha","status":"retry","owner":"A"}',
      '{"at":"2026-10-28T02:00:00+01:00","job":"alpha","status":"ok","owner":"A"}',
      '{"at":"2026-10-28T03:00:00+01:00","job":"beta","status":"retry","owner":null}',
      '{"at":"2026-10-28T04:00:00+01:00","job":"gamma","status":"fail","owner":"C"}',
      'not json',
    ].join('\n'));
    writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
    const config = { adapter: 'shim', installed: 'today', beatEverySeconds: 60, runsDir };

    const status = readStatus(config);
    expect(status.nights).toEqual(['2026-10-29', '2026-10-28']);
    expect(status.nightCounts).toEqual({
      '2026-10-29': { ok: 0, retry: 0, fail: 0 },
      '2026-10-28': { ok: 1, retry: 1, fail: 1 },
    });

    const response = await createApp(config).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-29"');
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('ok 0 · retry 0 · fail 0');
    expect(html).toContain('ok 1 · retry 1 · fail 1');
  });

  it('keeps the link and shows unknown counts when a digest disappears', async () => {
    const html = await StatusBoard({
      status: {
        adapter: 'shim',
        installed: 'today',
        lastBeat: null,
        nights: ['2026-10-28'],
        nightCounts: { '2026-10-28': null },
      },
    }).toString();
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('ok — · retry — · fail —');
  });
});

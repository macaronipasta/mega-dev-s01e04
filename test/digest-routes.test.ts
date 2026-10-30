import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow, NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
let runsDir: string;

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

function writeNight(contents: string) {
  writeFileSync(join(runsDir, `${night}.jsonl`), contents);
}

function rowsFromJson(body: DigestRow[] | NightDigest): DigestRow[] {
  return Array.isArray(body) ? body : body.rows;
}

// Extract the fixture's job names from table cells without fixing a column order.
function jobsFromPage(html: string, jobs: string[]): string[] {
  const table = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  expect(table).not.toBeNull();
  return Array.from(table?.[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi) ?? [],
    (match) => match[1].replace(/<[^>]*>/g, '').trim()).filter((cell) => jobs.includes(cell));
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('returns 404 from both routes when the night is missing', async () => {
    const server = app();
    expect((await server.request(`/digest/${night}`)).status).toBe(404);
    expect((await server.request(`/api/digest/${night}`)).status).toBe(404);
  });

  it('renders an empty night and returns no JSON rows', async () => {
    writeNight('');
    const server = app();
    const page = await server.request(`/digest/${night}`);
    const json = await server.request(`/api/digest/${night}`);

    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/nothing ran/i);
    expect(json.status).toBe(200);
    expect(rowsFromJson(await json.json() as DigestRow[] | NightDigest)).toEqual([]);
  });

  it('keeps valid jobs around a malformed line and agrees on their sorted order', async () => {
    writeNight([
      JSON.stringify({ at: '2026-10-28T22:00:00+01:00', job: 'zebra', status: 'retry', owner: null }),
      '{ malformed json',
      JSON.stringify({ at: '2026-10-28T22:01:00+01:00', job: 'alpha', status: 'ok', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T22:02:00+01:00', job: 'zebra', status: 'fail', owner: null, error: 'failed' }),
      '',
    ].join('\n'));
    const server = app();
    const page = await server.request(`/digest/${night}`);
    const json = await server.request(`/api/digest/${night}`);

    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    const body = await json.json() as DigestRow[] | NightDigest;
    const rows = rowsFromJson(body);
    expect(rows.map((row) => row.job)).toEqual(['alpha', 'zebra']);
    expect(jobsFromPage(html, ['alpha', 'zebra'])).toEqual(rows.map((row) => row.job));
    expect(rows.find((row) => row.job === 'zebra')).toMatchObject({
      owner: null, runs: 2, retries: 1, lastStatus: 'fail',
    });
    expect(html).toContain('—');
    if (!Array.isArray(body)) expect(body.badLines).toBe(1);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/(?:href|src)\s*=\s*["']\s*javascript:/i);
  });
});

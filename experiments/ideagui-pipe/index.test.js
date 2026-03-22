import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRoster, readFactoryStatus, generateSnapshot, parseTmuxSession } from './index.js';

// === Roster tests ===

test('readRoster parses valid ideagui.json', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ideagui-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'ideagui.json');
  writeFileSync(path, JSON.stringify({
    meta: { total_sessions: 2 },
    summary: { by_project: { demo: 2 } },
    sessions: [
      { session: 'demo/main', project: 'demo', terminal: 'warp', agent: 'claude', domain: 'general', sync: 'bidirectional', pane: 'left' },
      { session: 'demo/sub', project: 'demo', terminal: 'rio', agent: 'codex', domain: 'aiml', sync: 'server-only', pane: 'right' },
    ],
  }));
  const result = readRoster(path);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.meta.total_sessions, 2);
  assert.equal(result.sessions[0].project, 'demo');
});

test('readRoster throws on missing file', () => {
  assert.throws(() => readRoster('/tmp/nonexistent-ideagui-' + Date.now() + '.json'), /ENOENT/);
});

test('readRoster throws on malformed JSON', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ideagui-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'ideagui.json');
  writeFileSync(path, 'not json');
  assert.throws(() => readRoster(path));
});

test('readRoster caches result by mtime', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ideagui-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'ideagui.json');
  const data = { meta: { total_sessions: 1 }, summary: {}, sessions: [{ session: 'a', project: 'a', terminal: 'x', agent: 'claude', domain: 'g', sync: 'o', pane: null }] };
  writeFileSync(path, JSON.stringify(data));
  const r1 = readRoster(path);
  const r2 = readRoster(path);
  assert.equal(r1, r2, 'should return cached reference');
});

// === Tmux session parser tests ===

test('parseTmuxSession: standard terminal-project-agent pattern', () => {
  const r = parseTmuxSession('warp-demarch-claude');
  assert.deepEqual(r, { terminal: 'warp', project: 'demarch', agent: 'claude' });
});

test('parseTmuxSession: hyphenated project name', () => {
  const r = parseTmuxSession('iterm-elf-revel-sim-claude');
  assert.deepEqual(r, { terminal: 'iterm', project: 'elf-revel-sim', agent: 'claude' });
});

test('parseTmuxSession: codex agent', () => {
  const r = parseTmuxSession('rio-intercom-codex');
  assert.deepEqual(r, { terminal: 'rio', project: 'intercom', agent: 'codex' });
});

test('parseTmuxSession: Warp path-separator pattern', () => {
  const r = parseTmuxSession('/warp//demarch///sprint@claude');
  assert.deepEqual(r, { terminal: 'warp', project: 'demarch', agent: 'claude' });
});

test('parseTmuxSession: freeform name returns null', () => {
  assert.equal(parseTmuxSession('admin'), null);
  assert.equal(parseTmuxSession('devops'), null);
  assert.equal(parseTmuxSession('claude-work'), null);
  assert.equal(parseTmuxSession('beads-migrate-dolt'), null);
});

test('parseTmuxSession: unknown terminal returns null', () => {
  assert.equal(parseTmuxSession('unknown-demarch-claude'), null);
});

// === Factory-status tests (require clavain-cli) ===

const hasClavainCli = (() => {
  try { execFileSync('clavain-cli', ['help'], { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

test('readFactoryStatus returns parsed output with project field', { skip: !hasClavainCli }, () => {
  const result = readFactoryStatus();
  assert.ok(result.timestamp, 'has timestamp');
  assert.ok(result.fleet, 'has fleet');
  assert.ok(typeof result.fleet.total_agents === 'number');
  assert.ok(Array.isArray(result.wip) || result.wip === null);
  for (const w of (result.wip || [])) {
    assert.ok(typeof w.project === 'string', `WIP ${w.bead_id} has project field`);
  }
});

// === Integration test (require both sources) ===

test('generateSnapshot returns both layers with join metadata', { skip: !hasClavainCli }, () => {
  const snap = generateSnapshot();
  assert.ok(snap.roster.length > 0, 'has roster');
  assert.ok(snap.fleet.total_agents >= 0, 'has fleet');
  assert.ok(snap.timestamp, 'has timestamp');
  assert.ok(Object.keys(snap.by_project).length > 0, 'has by_project');
  assert.ok(typeof snap.meta.roster_total === 'number');
  assert.ok(typeof snap.meta.join_coverage === 'number');
  for (const s of snap.roster) {
    assert.ok(Array.isArray(s.active_beads), `${s.session} has active_beads`);
  }
});

test('generateSnapshot with factoryOnly skips roster', { skip: !hasClavainCli }, () => {
  const snap = generateSnapshot({ factoryOnly: true });
  assert.equal(snap.roster.length, 0, 'roster empty in factory-only');
  assert.equal(snap.meta.roster_total, 0);
  assert.ok(snap.fleet, 'still has fleet');
});

test('generateSnapshot includes live field and liveness meta', { skip: !hasClavainCli }, () => {
  const snap = generateSnapshot();
  assert.ok(typeof snap.meta.live_sessions === 'number', 'has live_sessions count');
  assert.ok(typeof snap.meta.fleet_total === 'number', 'has fleet_total');
  assert.ok(typeof snap.meta.fleet_matched === 'number', 'has fleet_matched');
  assert.ok(snap.meta.live_sessions > 0, 'at least some sessions are live');
  for (const s of snap.roster) {
    assert.ok(typeof s.live === 'boolean', `${s.session} has boolean live field`);
  }
});

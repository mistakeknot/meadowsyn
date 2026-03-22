import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const IDEAGUI_PATH = process.env.IDEAGUI_PATH
  || '/home/mk/projects/transfer/ideagui/ideagui.json';

let _rosterCache = null;
let _rosterMtime = 0;
let _rosterPath = '';

/**
 * Read IdeaGUI roster. Caches by file mtime.
 * @param {string} [path]
 * @returns {{ meta: object, summary: object, sessions: object[] }}
 */
export function readRoster(path = IDEAGUI_PATH) {
  const mtime = statSync(path).mtimeMs;
  if (_rosterCache && mtime === _rosterMtime && path === _rosterPath) {
    return _rosterCache;
  }
  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.sessions || !Array.isArray(data.sessions)) {
    throw new Error('Invalid ideagui.json: missing sessions array');
  }
  _rosterCache = data;
  _rosterMtime = mtime;
  _rosterPath = path;
  return data;
}

/**
 * Read live factory status from clavain-cli.
 * Uses execFileSync (no shell) to avoid command injection.
 */
export function readFactoryStatus() {
  const raw = execFileSync('clavain-cli', ['factory-status', '--json'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const data = JSON.parse(raw);
  if (!data.timestamp || !data.fleet) {
    throw new Error('Invalid factory-status: missing timestamp or fleet');
  }
  return data;
}

/**
 * Generate a snapshot with both layers and project-level join.
 * @param {object} [options]
 * @param {string} [options.ideaguiPath] - Path to ideagui.json
 * @param {boolean} [options.factoryOnly] - Skip roster, emit ops only
 */
export function generateSnapshot({ ideaguiPath, factoryOnly = false } = {}) {
  const ops = readFactoryStatus();

  if (factoryOnly) {
    return {
      timestamp: ops.timestamp,
      fleet: ops.fleet,
      queue: ops.queue,
      wip: ops.wip || [],
      dispatches: ops.recent_dispatches || [],
      watchdog: ops.watchdog,
      factory_paused: ops.factory_paused,
      roster: [],
      by_project: {},
      meta: { roster_total: 0, join_coverage: 0 },
    };
  }

  const roster = readRoster(ideaguiPath);

  // Index WIP by project (using factory-status project field)
  const wipByProject = new Map();
  for (const w of (ops.wip || [])) {
    const proj = (w.project || '').toLowerCase();
    if (!wipByProject.has(proj)) wipByProject.set(proj, []);
    wipByProject.get(proj).push(w);
  }

  // Enrich roster with active_beads (project-level, shared per project)
  const projectBeadArrays = new Map();
  const enrichedRoster = roster.sessions.map(s => {
    const key = (s.project || '').toLowerCase();
    if (!projectBeadArrays.has(key)) {
      projectBeadArrays.set(key, wipByProject.get(key) || []);
    }
    return { ...s, active_beads: projectBeadArrays.get(key) };
  });

  // by_project rollup
  const byProject = {};
  for (const s of enrichedRoster) {
    const key = (s.project || '').toLowerCase();
    if (!byProject[key]) {
      byProject[key] = {
        sessions: 0,
        active_beads: projectBeadArrays.get(key) || [],
        terminals: new Set(),
        agent_types: new Set(),
      };
    }
    byProject[key].sessions++;
    if (s.terminal) byProject[key].terminals.add(s.terminal);
    if (s.agent) byProject[key].agent_types.add(s.agent);
  }
  for (const v of Object.values(byProject)) {
    v.terminals = [...v.terminals];
    v.agent_types = [...v.agent_types];
  }

  // Join coverage: % of WIP beads that matched a roster project
  const wipEntries = ops.wip || [];
  const rosterProjects = new Set(roster.sessions.map(s => (s.project || '').toLowerCase()));
  const matchedCount = wipEntries.filter(w => rosterProjects.has((w.project || '').toLowerCase())).length;
  const joinCoverage = wipEntries.length > 0 ? matchedCount / wipEntries.length : 1;

  return {
    timestamp: ops.timestamp,
    fleet: ops.fleet,
    queue: ops.queue,
    wip: wipEntries,
    dispatches: ops.recent_dispatches || [],
    watchdog: ops.watchdog,
    factory_paused: ops.factory_paused,
    roster: enrichedRoster,
    by_project: byProject,
    meta: {
      roster_total: roster.sessions.length,
      join_coverage: Math.round(joinCoverage * 100),
    },
  };
}

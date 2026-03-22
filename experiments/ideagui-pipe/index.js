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

const KNOWN_TERMINALS = new Set([
  'warp', 'alacritty', 'iterm', 'ghostty', 'kitty', 'rio', 'wezterm', 'zed', 'termius', 'local',
]);
const KNOWN_AGENTS = new Set(['claude', 'codex', 'gemini']);

/**
 * Parse a tmux session name into (terminal, project, agent) components.
 * Returns null if the name doesn't match any known pattern.
 * @param {string} name
 * @returns {{ terminal: string, project: string, agent: string } | null}
 */
export function parseTmuxSession(name) {
  // Pattern 1: /terminal//project///role@agent (Warp path-separator)
  const warpMatch = name.match(/^\/?(\w+)\/\/([^/]+)\/\/\/[^@]*@(\w+)$/);
  if (warpMatch) {
    const [, terminal, project, agent] = warpMatch;
    if (KNOWN_TERMINALS.has(terminal) && KNOWN_AGENTS.has(agent)) {
      return { terminal, project: project.toLowerCase(), agent };
    }
  }

  // Pattern 2: terminal-project-agent or terminal-project-domain-agent
  // Split from ends: first segment = terminal, last segment = agent, middle = project
  const parts = name.split('-');
  if (parts.length >= 3) {
    const terminal = parts[0].toLowerCase();
    const agent = parts[parts.length - 1].toLowerCase();
    if (KNOWN_TERMINALS.has(terminal) && KNOWN_AGENTS.has(agent)) {
      const project = parts.slice(1, -1).join('-').toLowerCase();
      return { terminal, project, agent };
    }
  }

  return null;
}

/**
 * Match fleet agents (tmux sessions) to roster entries.
 * Returns a Set of matched roster keys ("project|terminal|agent").
 * @param {object[]} fleetAgents - From factory-status fleet.agents
 * @param {object[]} rosterSessions - From ideagui.json sessions
 * @returns {Set<string>}
 */
function matchFleetToRoster(fleetAgents, rosterSessions) {
  const liveKeys = new Set();
  for (const fa of fleetAgents) {
    const parsed = parseTmuxSession(fa.session_name);
    if (parsed) {
      liveKeys.add(`${parsed.project}|${parsed.terminal}|${parsed.agent}`);
    }
  }
  return liveKeys;
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

  // Match tmux sessions to roster for per-agent liveness
  const fleetAgents = ops.fleet.agents || [];
  const liveKeys = matchFleetToRoster(fleetAgents, roster.sessions);

  // Enrich roster with active_beads (project-level) and live (per-agent)
  const projectBeadArrays = new Map();
  const enrichedRoster = roster.sessions.map(s => {
    const key = (s.project || '').toLowerCase();
    if (!projectBeadArrays.has(key)) {
      projectBeadArrays.set(key, wipByProject.get(key) || []);
    }
    const rosterKey = `${(s.project || '').toLowerCase()}|${(s.terminal || '').toLowerCase()}|${(s.agent || '').toLowerCase()}`;
    return { ...s, active_beads: projectBeadArrays.get(key), live: liveKeys.has(rosterKey) };
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
      live_sessions: enrichedRoster.filter(s => s.live).length,
      fleet_total: fleetAgents.length,
      fleet_matched: fleetAgents.filter(fa => parseTmuxSession(fa.session_name) !== null).length,
    },
  };
}

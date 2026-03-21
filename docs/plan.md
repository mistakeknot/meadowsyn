---
artifact_type: plan
bead: Demarch-jpum
prd: docs/prds/2026-03-21-meadowsyn-experiments.md
stage: planned
---

# Plan: Meadowsyn Experiment Suite

## Dependency Graph

```
F1 (Mock Data) ← F2 (Split-Flap)
               ← F3 (Hydra Ambient)
               ← F4 (Cytoscape Graph)
               ← F5 (Raster Heatmap)
               ← F6 (Loopy Signals)
               ← F7 (Process Replay)
               ← F8 (Static JSON Pipe)

F8 (Static JSON) ← F9 (SSE Pipe) [same interface, different transport]

F1 + F8 ← F10 (Composition Shell) [needs at least one visual + one data pipe]
```

F1 (mock data) is the critical path — everything depends on it. F2-F7 and F8 are independent and parallelizable. F9 extends F8's interface. F10 composes everything.

## Execution Sequence

### Batch 1: Foundation (sequential, ~1 hour)

**F1: Mock Data Generator** (Demarch-ef08)

Location: `apps/Meadowsyn/experiments/mock-data/`

```
mock-data/
  index.js          # Node.js script
  package.json
```

Implementation:
1. Single Node.js script that outputs factory-status JSON to stdout
2. Agent name pool: 20 Culture ship names (Mistake Not..., Grey Area, etc.)
3. Bead ID pool: mock Demarch-xxxx IDs with realistic titles
4. `--agents N` flag (default 20)
5. `--stream` flag: emit one JSON line per second with evolving state
6. State machine per agent: idle -> dispatching -> executing -> (gated -> shipped | reworked -> idle)
7. Realistic distributions: 60% idle, 15% dispatching, 20% executing, 5% blocked
8. Queue depth fluctuates sinusoidally with noise (simulates work arrival)
9. Export as ES module too: `import { generateSnapshot, createStream } from './index.js'`

**F8: Static JSON Data Pipe** (Demarch-lavt)

Location: `apps/Meadowsyn/experiments/data-static/`

```
data-static/
  data-pipe.js      # ES module: DataPipe class
  index.html        # Test harness
```

Implementation:
1. `DataPipe` class: `new DataPipe({ url, interval, bufferSize })`
2. `subscribe(callback)` / `unsubscribe(callback)` pattern
3. Ring buffer: `getHistory()` returns last N snapshots
4. `getLatest()` returns current snapshot
5. Fetch with retry (exponential backoff, max 30s)
6. Stale indicator: `isStale()` true if last successful fetch > 3x interval
7. Works with `file://` (via imported mock data) and `https://` (via fetch)
8. Test harness: raw JSON display + stale indicator + snapshot counter

### Batch 2: Visual Experiments (parallel, ~2 hours each)

All six can run in parallel. Each is a standalone `index.html` that imports mock data and data-pipe from Batch 1.

**F2: Split-Flap Board** (Demarch-r24y)

Location: `apps/Meadowsyn/experiments/split-flap/`

Implementation:
1. CSS-only split-flap animation (no canvas/WebGL)
   - Each character is a `<span>` with `::before`/`::after` for top/bottom halves
   - `@keyframes flip` rotates top half up, reveals new character
   - Stagger delay per character for cascade effect
2. Row per agent: `[STATUS] [AGENT NAME........] [BEAD ID....] [TASK TITLE..............] [DURATION]`
3. Status column: `IDLE` (gray), `EXEC` (green), `DISP` (blue), `FAIL` (red), `GATE` (amber)
4. Dark background (#0a0a0a), Roboto Mono or JetBrains Mono
5. Color only on anomaly (FAIL, GATE) — everything else is white/gray per ASM "going gray" principle
6. Sort: executing first, then dispatching, then idle
7. Header row: `MEADOWSYN FACTORY STATUS` + timestamp + agent count + queue depth
8. Auto-refresh every 5s via data-pipe

**F3: Hydra Ambient Field** (Demarch-agi0)

Location: `apps/Meadowsyn/experiments/hydra-ambient/`

Implementation:
1. Import `hydra-synth` from CDN/npm
2. Initialize Hydra on a full-screen `<canvas>`
3. Bridge layer maps factory metrics to Hydra uniforms:
   - `throughput` (dispatches/min) -> oscillator frequency (`osc(freq)`)
   - `errorRate` (blocked/total) -> color temperature shift (`color(r,g,b)`)
   - `queuePressure` (queue depth / agent count) -> turbulence/noise (`noise(scale)`)
   - `utilization` (active/total) -> brightness/saturation
4. Smooth interpolation: lerp current->target over 2s
5. Four distinct visual states:
   - Healthy: slow blue-green oscillation, calm
   - Busy: faster oscillation, warmer tones, more contrast
   - Degraded: amber tones, visible noise patterns
   - Critical/Paused: red pulse, high turbulence
6. Overlay: semi-transparent text showing key metrics on top of generative field
7. Data updates every 5s from data-pipe

**F4: Cytoscape Agent Graph** (Demarch-cjgj)

Location: `apps/Meadowsyn/experiments/cytoscape-graph/`

Implementation:
1. Import Cytoscape.js + cytoscape-fcose from CDN
2. Two node types: agents (circles) and beads (rounded rectangles)
3. Edges: agent -> bead (working-on), bead -> bead (dependency)
4. fCoSE layout with constraints: agent nodes in outer ring, bead nodes center
5. Node styling:
   - Agent size: proportional to session age
   - Agent color: idle (gray), executing (green), blocked (red)
   - Bead size: proportional to priority (P0 largest)
   - Bead color: open (blue), in-progress (green), blocked (red)
6. Interactions:
   - Click agent -> highlight its bead chain, dim others
   - Click bead -> highlight assigned agent + dependency path
   - Double-click -> reset highlight
   - Mouse wheel zoom, pan
7. Live update: diff graph on each data-pipe update (add/remove/update nodes, animate transitions)
8. Dark background, minimal labels (show on hover)

**F5: Raster Heatmap** (Demarch-wwo9)

Location: `apps/Meadowsyn/experiments/raster-heatmap/`

Implementation:
1. HTML `<canvas>` for rendering (performance over DOM)
2. Grid: columns = 5-min time buckets (last 2 hours = 24 columns), rows = agents
3. Cell color encoding:
   - Idle: #1a1a1a (near-black)
   - Dispatching: #1e3a5f (dark blue)
   - Executing: #1a4a2a (dark green)
   - Blocked: #5f1a1a (dark red)
   - Quality gate: #4a3a1a (dark amber)
4. Live tail: new column appears on right, oldest scrolls off left
5. Sort rows by total activity (most active at top) — re-sort every 30s
6. Hover: tooltip with agent name, bead, exact timestamp, status
7. Click row: highlight agent, show detail panel
8. Y-axis labels: agent names (truncated to 12 chars)
9. X-axis labels: time (HH:MM)
10. Accumulate history from data-pipe ring buffer

**F6: Loopy Signal Propagation** (Demarch-no1e)

Location: `apps/Meadowsyn/experiments/loopy-signals/`

Implementation:
1. SVG-based causal loop diagram (D3 or vanilla SVG)
2. Fixed topology — the factory feedback loop:
   ```
   Backlog -> Dispatch -> Execution -> Quality Gates
      ^                                    |
      +---- Rework <------------- FAIL ----+
                                    |
                                  Ship -> Done
   ```
3. Each node shows current count (e.g., Backlog: 33, Executing: 6)
4. Animated particles on edges: small circles flowing along paths
5. Particle rate proportional to throughput on that edge
6. Particle color: green (success path), red (rework path)
7. Perturbation mode: click any node -> inject a pulse -> watch propagation
   - Pulse: bright flash that travels along all outgoing edges
   - Shows delay: each edge has a transit time (faster = higher throughput)
8. Reinforcing loop indicator (R): dispatch->execute->ship->reduced-backlog->less-dispatch-pressure
9. Balancing loop indicator (B): quality-gates->rework->backlog-increase->more-dispatch-pressure
10. Data-driven: node counts from factory-status, edge rates from dispatch history

**F7: Process Replay** (Demarch-xhxp)

Location: `apps/Meadowsyn/experiments/process-replay/`

Implementation:
1. Process diagram: horizontal swim-lane layout
   - Lanes: Backlog | Claimed | Dispatched | Executing | Gated | Shipped/Reworked
2. Each bead is a token (colored dot) that moves through lanes over time
3. Playback controls: play/pause, 1x/2x/5x/10x speed, scrub bar
4. Token enters left (created/opened), exits right (shipped) or loops back (reworked)
5. Token color: by priority (P0=red, P1=amber, P2=blue)
6. Token size: by age (older = larger, shows stuck items)
7. Current time indicator: vertical line on scrub bar
8. Event log: scrolling sidebar showing dispatch events at current playback time
9. Data source: accumulate factory-status snapshots into event log
   - Detect state transitions: if bead was in-progress last snapshot, now closed -> shipped
10. SVG/Canvas hybrid: SVG for lanes/labels, Canvas for token animation (performance)

### Batch 3: Infrastructure (after Batch 1, parallel with Batch 2)

**F9: SSE Data Pipe** (Demarch-p83z)

Location: `apps/Meadowsyn/experiments/data-sse/`

Implementation:
1. Node.js server (Express or bare http), < 200 lines
2. Polls `clavain-cli factory-status --json` every 5s (use execFile, not exec, to avoid injection)
3. `GET /events` — SSE endpoint (`text/event-stream`)
   - On connect: send full snapshot as `event: snapshot`
   - On poll: compute diff, send `event: update` with changed fields only
   - Heartbeat: `event: heartbeat` every 15s (keeps connection alive through proxies)
4. `GET /api/snapshot` — current full state as JSON
5. `GET /api/history` — last 720 snapshots (1 hour) as JSON array
6. Serves static files from `../` (so any experiment can be served)
7. Client library: same `DataPipe` interface as F8
   - `new DataPipe({ url: '/events', mode: 'sse' })`
   - Same `subscribe()`, `getHistory()`, `getLatest()`, `isStale()` API
   - Auto-reconnect with exponential backoff
   - Falls back to polling if SSE fails

### Batch 4: Composition (after at least 2 visuals + 1 data pipe work)

**F10: Composition Shell** (Demarch-tr69)

Location: `apps/Meadowsyn/experiments/shell/`

Implementation:
1. Hash-based router: `/#/split-flap`, `/#/hydra`, `/#/graph`, `/#/raster`, `/#/loopy`, `/#/replay`
2. Data source selector (dropdown): mock | static-json | sse
3. Visual plugin interface:
   ```js
   { name: 'split-flap', mount(container, dataPipe), unmount(), thumbnail: '...' }
   ```
4. Shared header bar:
   - Factory status summary: agents active/total, queue depth by priority, uptime
   - Visual selector: thumbnail strip of all experiments
   - Data source toggle
5. URL state: `/#/split-flap?data=sse&agents=20&speed=5` (shareable)
6. Lazy loading: each visual is a separate JS file, loaded on route change
7. Transition animation between visuals (fade)
8. Keyboard shortcuts: 1-6 for visuals, D for data toggle, F for fullscreen

## Verification

Each experiment has its own acceptance criteria in the PRD. Verification per batch:

- **Batch 1:** Mock data generates valid JSON; data-pipe subscribes and delivers updates
- **Batch 2:** Each visual renders with mock data, handles 20+ agents, updates live
- **Batch 3:** SSE server streams to browser, reconnects on disconnect
- **Batch 4:** Shell mounts/unmounts visuals, URL state persists, all combos work

## Commit Strategy

One commit per experiment (10 commits). Each experiment is self-contained and independently runnable. Push to `mistakeknot/meadowsyn` after each batch.

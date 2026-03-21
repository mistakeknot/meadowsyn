# Meadowsyn

Web visualization frontend for the Demarch AI factory. A Cybersyn-style ops room for monitoring autonomous agent dispatch.

**Name origin:** Donella Meadows (*Thinking in Systems*) + Cybersyn (Allende-era real-time economic ops room).

**Domain:** meadowsyn.com (available as of 2026-03-21, not yet registered).

**Bead:** Demarch-jpum (child of Demarch-jlp0, factory validation epic).

## Status

Research phase complete. 8 parallel research agents surveyed the frontier across control room UX, systems thinking, swarm visualization, esoteric math viz, biological dashboards, competitive landscape, temporal visualization, and ambient/calm technology. See `docs/research/synthesis.md` for the consolidated findings.

## Architecture (Proposed)

Three-layer display: ambient generative field (L1) + FIDS-style information ribbon (L2) + interactive detail panels (L3). See synthesis doc for full stack recommendation.

## Data Sources

- `clavain-cli factory-status --json` — fleet utilization, queue by priority, WIP, dispatches, watchdog, factory pause
- `bd list --format=json` — beads data (issues, deps, status, priority)
- `cass` — session history, token analytics, agent activity
- `tmux` — live agent sessions

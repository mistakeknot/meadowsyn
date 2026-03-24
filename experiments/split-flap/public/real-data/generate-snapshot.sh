#!/usr/bin/env bash
# Generate a unified Meadowsyn snapshot from live data sources.
# Run this on a cron or via `watch -n 5` to keep the snapshot fresh.
# Output: real-data/snapshot.json (polled by the experiment's DataPipe)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$SCRIPT_DIR/snapshot.json"
DEMARCH_ROOT="${DEMARCH_ROOT:-/home/mk/projects/Demarch}"

# 1. Factory status from clavain-cli
FACTORY_JSON=$(clavain-cli factory-status --json 2>/dev/null || echo '{}')

# 2. Beads from bd list (JSON format)
BEADS_JSON=$(cd "$DEMARCH_ROOT" && bd list --format=json --status=open,in_progress 2>/dev/null | head -500 || echo '[]')

# 3. Parse and merge into unified snapshot
python3 -c "
import json, sys, re, os

factory = json.loads('''$FACTORY_JSON''') if '''$FACTORY_JSON'''.strip() else {}
# bd list outputs a tree, not JSON array — parse from env
beads_raw = os.environ.get('BEADS_JSON', '[]')

timestamp = factory.get('timestamp', '$(date -u +%Y-%m-%dT%H:%M:%SZ)')
fleet = factory.get('fleet', {})
queue = factory.get('queue', {})
wip = factory.get('wip', {})

# Parse agents: extract project and type from session_name
# Format: /warp//demarch///core@claude or [alacritty[[agmodb@claude
agents = []
for a in fleet.get('agents', []):
    name = a.get('session_name', '')
    status = 'executing' if a.get('active') else 'idle'
    # Extract project hint from session name
    project = 'clavain'  # default
    agent_type = 'claude'
    parts = re.split(r'[/\[\]@]+', name)
    parts = [p for p in parts if p]
    if len(parts) >= 2:
        agent_type = parts[-1] if parts[-1] in ('claude', 'codex', 'gemini') else 'claude'
        # Try to find a project name in the path
        for p in parts:
            p_lower = p.lower()
            if p_lower in ('intercore','intermute','interweave','clavain','skaffen','ockham',
                          'autarch','meadowsyn','intercom','zaka','alwe','khouri'):
                project = p_lower
                break
            if p_lower.startswith('inter') and len(p_lower) > 5:
                project = p_lower
                break

    agents.append({
        'agent': name[:30],
        'status': status,
        'project': project,
        'agentType': agent_type,
        'beads': [],
    })

# Build snapshot
snapshot = {
    'timestamp': timestamp,
    'fleet': {
        'total': len(agents),
        'active': sum(1 for a in agents if a['status'] != 'idle'),
        'agents': agents,
    },
    'queue': {'total': queue.get('total', 0)},
    'beads': [],  # TODO: parse bd list output
    'bead_deps': [],
    'bead_projects': {},
    'metrics': {
        'utilization': sum(1 for a in agents if a['status'] != 'idle') / max(len(agents), 1),
        'errorRate': 0,
    },
    'source': 'live',
}

json.dump(snapshot, sys.stdout, indent=2)
" > "$OUT"

echo "Snapshot written to $OUT ($(wc -c < "$OUT") bytes, $(date))"

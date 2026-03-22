#!/usr/bin/env node
import { generateSnapshot } from './index.js';

const args = process.argv.slice(2);
const streamMode = args.includes('--stream');
const factoryOnly = args.includes('--factory-only');
const intervalIdx = args.indexOf('--interval');
const rawInterval = intervalIdx !== -1 ? parseInt(args[intervalIdx + 1], 10) : 5;
const interval = Number.isFinite(rawInterval) ? Math.max(1, rawInterval) : 5;
const pathIdx = args.indexOf('--ideagui-path');
const ideaguiPath = pathIdx !== -1 ? args[pathIdx + 1] : undefined;

function emit() {
  try {
    const snapshot = generateSnapshot({ ideaguiPath, factoryOnly });
    process.stdout.write(JSON.stringify(snapshot) + '\n');
  } catch (err) {
    if (!streamMode) throw err;
    process.stderr.write(`[ideagui-pipe] ${err.message}\n`);
  }
}

if (streamMode) {
  emit();
  const timer = setInterval(emit, interval * 1000);
  const shutdown = () => { clearInterval(timer); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  emit();
}

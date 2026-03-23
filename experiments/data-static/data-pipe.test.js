import { strict as assert } from 'node:assert';
import { DataPipe } from './data-pipe.js';

let tick = 0;
function mockGen() {
  return { tick: ++tick, timestamp: new Date().toISOString() };
}

// Test 1: subscribe/unsubscribe
{
  const pipe = new DataPipe({ generator: mockGen, interval: 50, bufferSize: 5 });
  const received = [];
  const unsub = pipe.subscribe(s => received.push(s));
  pipe.start();
  await new Promise(r => setTimeout(r, 180));
  pipe.stop();
  assert(received.length >= 2, `Expected >=2 snapshots, got ${received.length}`);
  const countBefore = received.length;
  unsub();
  // Push one more manually via internals to verify unsub
  pipe._pushSnapshot(mockGen());
  assert.equal(received.length, countBefore, 'Should not receive after unsub');
  console.log('PASS: subscribe/unsubscribe');
}

// Test 2: ring buffer wraps correctly
{
  const pipe = new DataPipe({ generator: mockGen, interval: 100000, bufferSize: 3 });
  for (let i = 1; i <= 5; i++) {
    pipe._pushSnapshot({ n: i });
  }
  const hist = pipe.getHistory();
  assert.equal(hist.length, 3);
  assert.deepEqual(hist.map(h => h.n), [3, 4, 5], 'Should have last 3 items');
  assert.deepEqual(pipe.getLatest(), { n: 5 });
  assert.equal(pipe.snapshotCount, 5);
  console.log('PASS: ring buffer');
}

// Test 3: isStale
{
  const pipe = new DataPipe({ interval: 100, bufferSize: 5 });
  assert.equal(pipe.isStale(), false, 'Not stale before first fetch');
  pipe._lastOk = Date.now() - 500;  // 5x interval
  assert.equal(pipe.isStale(), true, 'Stale when last fetch > 3x interval');
  pipe._lastOk = Date.now();
  assert.equal(pipe.isStale(), false, 'Not stale with recent fetch');
  console.log('PASS: isStale');
}

// Test 4: getHistory empty
{
  const pipe = new DataPipe({ interval: 100, bufferSize: 5 });
  assert.deepEqual(pipe.getHistory(), []);
  assert.equal(pipe.getLatest(), null);
  console.log('PASS: empty state');
}

// Test 5: stop prevents further polling
{
  const pipe = new DataPipe({ generator: mockGen, interval: 30, bufferSize: 100 });
  pipe.start();
  await new Promise(r => setTimeout(r, 100));
  pipe.stop();
  const countAtStop = pipe.snapshotCount;
  await new Promise(r => setTimeout(r, 100));
  assert.equal(pipe.snapshotCount, countAtStop, 'No new snapshots after stop');
  console.log('PASS: stop');
}

console.log('\nAll tests passed.');

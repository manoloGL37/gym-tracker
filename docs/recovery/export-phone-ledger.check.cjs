// Synthetic IDB contract check. No browser/user database, network or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(`${__dirname}/export-phone-ledger.js`, 'utf8');

async function check({ missing = false, upgrade = false, absent = false } = {}) {
  const data = { workoutHistory: [{ id: 'synthetic-workout' }], routines: [], migrationLedgers: [{ accountId: 'synthetic-account', workouts: {} }], unrelatedAuth: [{ forbidden: 'synthetic-secret' }] };
  let reads = 0, writes = 0, opened = 0, closed = 0, aborted = 0, download;
  const database = {
    version: 90, // Dexie v9 maps to native version 90; exporter never requests a version.
    objectStoreNames: { contains: name => name in data && !(missing && name === 'migrationLedgers') },
    close: () => closed++,
    transaction(names, mode) {
      assert.equal(mode, 'readonly');
      assert.deepEqual(Array.from(names), ['workoutHistory', 'routines', 'migrationLedgers']);
      const tx = { objectStore(name) {
        const read = {};
        return { getAll() {
          reads++;
          queueMicrotask(() => { read.result = data[name]; read.onsuccess(); });
          return read;
        }, put() { writes++; throw Error('write forbidden'); }, clear() { writes++; throw Error('clear forbidden'); } };
      } };
      setTimeout(() => tx.oncomplete(), 0);
      return tx;
    },
  };
  const errors = [];
  const context = {
    indexedDB: {
      databases: async () => absent ? [] : [{ name: 'GymTrackerDB' }],
      open(...args) {
        assert.deepEqual(Array.from(args), ['GymTrackerDB']); opened++;
        const request = { result: database, transaction: { abort: () => aborted++ } };
        queueMicrotask(() => upgrade ? request.onupgradeneeded() : request.onsuccess());
        return request;
      },
    },
    location: { origin: 'https://synthetic.invalid' },
    URL: { createObjectURL: blob => { download = blob; return 'blob:synthetic'; }, revokeObjectURL() {} },
    Blob, document: { createElement: () => ({ click() {} }) },
    setTimeout: () => 0, console: { log() {}, error: (...args) => errors.push(args) },
  };
  const snapshot = await vm.runInNewContext(script, context);
  assert.equal(writes, 0);
  if (absent || missing || upgrade) {
    assert.equal(reads, 0); assert.equal(download, undefined); assert.equal(errors.length, 1);
    if (absent) assert.equal(opened, 0);
    if (upgrade) assert.equal(aborted, 1);
  } else {
    assert.equal(reads, 3); assert.equal(closed, 1);
    assert.deepEqual(JSON.parse(await download.text()).stores, JSON.parse(JSON.stringify(snapshot.stores)));
    assert.equal(JSON.stringify(snapshot).includes('synthetic-secret'), false);
    assert.equal(JSON.stringify(data.workoutHistory), '[{"id":"synthetic-workout"}]');
  }
}
(async () => {
  await check(); await check({ absent: true }); await check({ missing: true }); await check({ upgrade: true });
  console.log('4/4 export checks passed: readonly, missing DB/store, upgrade abort, auth excluded.');
})().catch(error => { console.error(error); process.exitCode = 1; });

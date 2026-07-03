const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempHome } = require('./helpers/temp-home');

function withTempHome(fn) {
  return async (t) => {
    const { homeDir, cleanup } = createTempHome();
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    t.after(() => {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      cleanup();
    });

    delete require.cache[require.resolve('../lib/storage')];
    const storage = require('../lib/storage');
    await fn(t, { homeDir, storage });
  };
}

test('loadSnapshot treats missing tags as an empty array', withTempHome(async (t, { storage }) => {
  const fixturePath = path.join(__dirname, 'fixtures', 'old-format.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  storage.saveSnapshot('legacy', fixture);
  const loaded = storage.loadSnapshot('legacy');

  assert.deepEqual(loaded.tags, []);
}));

test('listSnapshots includes empty tags for old-format snapshots', withTempHome(async (t, { storage }) => {
  const fixturePath = path.join(__dirname, 'fixtures', 'old-format.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  storage.saveSnapshot('legacy', fixture);
  const listed = storage.listSnapshots();

  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].tags, []);
}));

test('deleteSnapshot removes existing files and reports missing ones', withTempHome(async (t, { storage }) => {
  storage.saveSnapshot('temp', {
    cwd: '/tmp',
    env: {},
    gitBranch: null,
    recentCommands: [],
    tags: [],
    timestamp: new Date().toISOString(),
  });

  assert.equal(storage.deleteSnapshot('temp'), true);
  assert.equal(storage.loadSnapshot('temp'), null);
  assert.equal(storage.deleteSnapshot('temp'), false);
}));

test('searchSnapshots matches query and tag filters', withTempHome(async (t, { storage }) => {
  const base = {
    env: {},
    recentCommands: [],
    timestamp: new Date().toISOString(),
  };

  storage.saveSnapshot('backend-work', {
    ...base,
    cwd: '/projects/api',
    gitBranch: 'feature/auth',
    tags: ['backend', 'urgent'],
  });
  storage.saveSnapshot('frontend-work', {
    ...base,
    cwd: '/projects/ui',
    gitBranch: 'feature/ui',
    tags: ['frontend'],
  });

  const byTag = storage.searchSnapshots({ tag: 'backend' });
  assert.equal(byTag.length, 1);
  assert.equal(byTag[0].name, 'backend-work');

  const byQuery = storage.searchSnapshots({ query: 'feature/ui' });
  assert.equal(byQuery.length, 1);
  assert.equal(byQuery[0].name, 'frontend-work');
}));

test('validateSnapshot accepts valid snapshots and rejects malformed ones', withTempHome(async (t, { storage }) => {
  const valid = storage.validateSnapshot({
    cwd: '/tmp',
    timestamp: new Date().toISOString(),
    env: {},
    gitBranch: null,
    recentCommands: [],
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.missing, []);

  const invalid = storage.validateSnapshot({ cwd: '/tmp' });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.missing.includes('timestamp'));
}));

test('deriveImportName strips export suffixes', withTempHome(async (t, { storage }) => {
  assert.equal(storage.deriveImportName('/tmp/mywork.snapctx.json'), 'mywork');
  assert.equal(storage.deriveImportName('/tmp/mywork.json'), 'mywork');
}));

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

test('storage: redactEnvironment uses default denylist', withTempHome(async (t, { storage }) => {
  const env = {
    AWS_SECRET_ACCESS_KEY: 'secret123',
    DB_PASSWORD: 'password123',
    NODE_ENV: 'production',
    PORT: '8080',
  };
  const { env: redacted, redactedCount } = storage.redactEnvironment(env);

  assert.equal(redacted.AWS_SECRET_ACCESS_KEY, '[REDACTED]');
  assert.equal(redacted.DB_PASSWORD, '[REDACTED]');
  assert.equal(redacted.NODE_ENV, 'production');
  assert.equal(redacted.PORT, '8080');
  assert.equal(redactedCount, 2);
}));

test('storage: project-level .snapctxignore is respected', withTempHome(async (t, { storage }) => {
  const tempProjectDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapctx-proj-'));
  t.after(() => {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(tempProjectDir, '.snapctxignore'), 'MY_CUSTOM_SECRET_*\n# comment line\n\nOTHER_VAR', 'utf8');

  const env = {
    MY_CUSTOM_SECRET_KEY: 'abc',
    OTHER_VAR: 'def',
    NORMAL_VAR: 'ghi',
  };

  const { env: redacted, redactedCount } = storage.redactEnvironment(env, {
    cwd: tempProjectDir,
  });

  assert.equal(redacted.MY_CUSTOM_SECRET_KEY, '[REDACTED]');
  assert.equal(redacted.OTHER_VAR, '[REDACTED]');
  assert.equal(redacted.NORMAL_VAR, 'ghi');
  assert.equal(redactedCount, 2);
}));

test('storage: global and project .snapctxignore are merged', withTempHome(async (t, { storage, homeDir }) => {
  // Create global ignore file
  const snapDir = path.join(homeDir, '.snapctx');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, '.snapctxignore'), 'GLOBAL_SECRET\n', 'utf8');

  // Create project ignore file
  const tempProjectDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapctx-proj-'));
  t.after(() => {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(tempProjectDir, '.snapctxignore'), 'PROJECT_SECRET\n', 'utf8');

  const env = {
    GLOBAL_SECRET: 'global',
    PROJECT_SECRET: 'project',
    AWS_SECRET_ACCESS_KEY: 'aws',
    SAFE_VAR: 'safe',
  };

  const { env: redacted, redactedCount } = storage.redactEnvironment(env, {
    cwd: tempProjectDir,
  });

  assert.equal(redacted.GLOBAL_SECRET, '[REDACTED]');
  assert.equal(redacted.PROJECT_SECRET, '[REDACTED]');
  assert.equal(redacted.AWS_SECRET_ACCESS_KEY, '[REDACTED]');
  assert.equal(redacted.SAFE_VAR, 'safe');
  assert.equal(redactedCount, 3);
}));

test('storage: missing .snapctxignore does not crash and defaults work', withTempHome(async (t, { storage }) => {
  const env = {
    AWS_SECRET_ACCESS_KEY: 'abc',
    SAFE_VAR: 'safe',
  };
  const { env: redacted, redactedCount } = storage.redactEnvironment(env, {
    cwd: '/nonexistent/path',
  });
  assert.equal(redacted.AWS_SECRET_ACCESS_KEY, '[REDACTED]');
  assert.equal(redacted.SAFE_VAR, 'safe');
  assert.equal(redactedCount, 1);
}));

test('storage: malformed .snapctxignore (is directory) degrades gracefully with warning', withTempHome(async (t, { storage }) => {
  const tempProjectDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapctx-proj-'));
  t.after(() => {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  });

  // Create a directory named .snapctxignore instead of a file
  fs.mkdirSync(path.join(tempProjectDir, '.snapctxignore'));

  const env = {
    AWS_SECRET_ACCESS_KEY: 'abc',
    SAFE_VAR: 'safe',
  };

  let warned = false;
  const originalWarn = console.warn;
  console.warn = (msg) => {
    if (msg.includes('Cannot read project .snapctxignore')) {
      warned = true;
    }
  };

  t.after(() => {
    console.warn = originalWarn;
  });

  const { env: redacted, redactedCount } = storage.redactEnvironment(env, {
    cwd: tempProjectDir,
  });

  assert.equal(warned, true);
  assert.equal(redacted.AWS_SECRET_ACCESS_KEY, '[REDACTED]');
  assert.equal(redacted.SAFE_VAR, 'safe');
  assert.equal(redactedCount, 1);
}));

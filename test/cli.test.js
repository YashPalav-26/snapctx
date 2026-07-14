const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempHome } = require('./helpers/temp-home');
const { runCli } = require('./helpers/run-cli');

function withTempHome(fn) {
  return async (t) => {
    const { homeDir, cleanup } = createTempHome();
    t.after(cleanup);
    await fn(t, { homeDir });
  };
}

test('save, load, and list still work', withTempHome(async (t, { homeDir }) => {
  const save = runCli(['save', 'baseline'], { homeDir });
  assert.equal(save.status, 0);
  assert.match(save.stdout, /Snapshot 'baseline' saved\./);

  const list = runCli(['list'], { homeDir });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /baseline — saved/);

  const load = runCli(['load', 'baseline'], { homeDir });
  assert.equal(load.status, 0);
  assert.match(load.stdout, /Snapshot: baseline/);
}));

test('delete removes an existing snapshot and fails for missing names', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'to-delete'], { homeDir });

  const deleted = runCli(['delete', 'to-delete'], { homeDir });
  assert.equal(deleted.status, 0);
  assert.match(deleted.stdout, /deleted\./);

  const missing = runCli(['delete', 'missing'], { homeDir });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No snapshot named 'missing'/);
}));

test('save tags are searchable and filterable via list --tag', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'mywork', '-t', 'backend', '-t', 'urgent'], { homeDir });
  runCli(['save', 'other', '-t', 'frontend'], { homeDir });

  const taggedList = runCli(['list', '--tag', 'backend'], { homeDir });
  assert.equal(taggedList.status, 0);
  assert.match(taggedList.stdout, /mywork \[backend, urgent\]/);
  assert.doesNotMatch(taggedList.stdout, /other/);

  const search = runCli(['search', 'urgent'], { homeDir });
  assert.equal(search.status, 0);
  assert.match(search.stdout, /mywork \[backend, urgent\]/);
}));

test('diff reports key names but never env values', withTempHome(async (t, { homeDir }) => {
  delete require.cache[require.resolve('../lib/storage')];
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  const storage = require('../lib/storage');

  const base = {
    cwd: '/project/a',
    env: { PATH: '/usr/bin', SECRET: 'supersecret' },
    gitBranch: 'main',
    recentCommands: ['npm test'],
    tags: [],
    timestamp: '2024-01-01T00:00:00.000Z',
  };

  storage.saveSnapshot('left', base);
  storage.saveSnapshot('right', {
    ...base,
    cwd: '/project/b',
    gitBranch: 'dev',
    env: { PATH: '/usr/bin', SECRET: 'different-secret', DEBUG: '1' },
    recentCommands: ['npm test', 'npm run lint'],
  });

  const diff = runCli(['diff', 'left', 'right'], { homeDir });
  assert.equal(diff.status, 0);
  assert.match(diff.stdout, /cwd: \/project\/a -> \/project\/b/);
  assert.match(diff.stdout, /git branch: main -> dev/);
  assert.match(diff.stdout, /DEBUG/);
  assert.match(diff.stdout, /changed: SECRET/);
  assert.doesNotMatch(diff.stdout, /supersecret/);
  assert.doesNotMatch(diff.stdout, /different-secret/);
  assert.match(diff.stdout, /recent commands: differ/);
}));

test('export and import round-trip with validation and force behavior', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'portable'], { homeDir });

  const exportDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapctx-export-'));
  t.after(() => {
    fs.rmSync(exportDir, { recursive: true, force: true });
  });

  const exportPath = path.join(exportDir, 'portable.snapctx.json');
  const exported = runCli(['export', 'portable', '-o', exportPath], { homeDir, cwd: exportDir });
  assert.equal(exported.status, 0);
  assert.ok(fs.existsSync(exportPath));

  const imported = runCli(['import', exportPath, '--as', 'imported-copy'], { homeDir, cwd: exportDir });
  assert.equal(imported.status, 0);
  assert.match(imported.stdout, /imported as 'imported-copy'/);

  const duplicate = runCli(['import', exportPath, '--as', 'imported-copy'], { homeDir, cwd: exportDir });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists/);

  const forced = runCli(['import', exportPath, '--as', 'imported-copy', '--force'], { homeDir, cwd: exportDir });
  assert.equal(forced.status, 0);

  const malformedPath = path.join(exportDir, 'bad.snapctx.json');
  fs.writeFileSync(malformedPath, JSON.stringify({ cwd: '/tmp' }), 'utf8');
  const malformed = runCli(['import', malformedPath], { homeDir, cwd: exportDir });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Missing fields/);
}));

test('old-format fixture loads and lists without errors', withTempHome(async (t, { homeDir }) => {
  const fixturePath = path.join(__dirname, 'fixtures', 'old-format.json');
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  const snapDir = path.join(homeDir, '.snapctx');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'legacy.json'), fixture, 'utf8');

  const list = runCli(['list'], { homeDir });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /legacy — saved/);

  const load = runCli(['load', 'legacy'], { homeDir });
  assert.equal(load.status, 0);
  assert.match(load.stdout, /Snapshot: legacy/);
  assert.match(load.stdout, /Environment variables: 1 saved \(unknown\/legacy\)/);
  assert.doesNotMatch(load.stdout, /Tags:/);
}));

test('search reports when nothing matches', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'alpha'], { homeDir });
  const search = runCli(['search', 'does-not-exist'], { homeDir });
  assert.equal(search.status, 0);
  assert.match(search.stdout, /No snapshots match 'does-not-exist'/);
}));

test('diff fails clearly when a snapshot is missing', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'only-one'], { homeDir });
  const diff = runCli(['diff', 'only-one', 'missing'], { homeDir });
  assert.equal(diff.status, 1);
  assert.match(diff.stderr, /No snapshot named 'missing'/);
}));

test('export to a directory writes the file inside with the default name', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'mysnap'], { homeDir });

  const exportDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapctx-dir-export-'));
  t.after(() => {
    fs.rmSync(exportDir, { recursive: true, force: true });
  });

  const result = runCli(['export', 'mysnap', '-o', exportDir], { homeDir, cwd: exportDir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /exported to/);

  // File should exist inside the directory with the default name.
  const expectedFile = path.join(exportDir, 'mysnap.snapctx.json');
  assert.ok(fs.existsSync(expectedFile));
}));

test('export with missing parent directory fails with clear message', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'mysnap'], { homeDir });

  const exportDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapctx-missing-parent-'));
  t.after(() => {
    fs.rmSync(exportDir, { recursive: true, force: true });
  });

  const missingParentPath = path.join(exportDir, 'nonexistent', 'subdir', 'output.snapctx.json');
  const result = runCli(['export', 'mysnap', '-o', missingParentPath], { homeDir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Parent directory does not exist/);
  assert.doesNotMatch(result.stderr, /Error:/);
  assert.doesNotMatch(result.stderr, /at /);
}));

test('import fails clearly when given a directory instead of a file', withTempHome(async (t, { homeDir }) => {
  const importDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapctx-import-dir-'));
  t.after(() => {
    fs.rmSync(importDir, { recursive: true, force: true });
  });

  const result = runCli(['import', importDir], { homeDir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is a directory, not a snapshot file/);
  assert.doesNotMatch(result.stderr, /Error:/);
  assert.doesNotMatch(result.stderr, /at /);
}));

test('import fails clearly when file does not exist', withTempHome(async (t, { homeDir }) => {
  const result = runCli(['import', '/nonexistent/path/file.snapctx.json'], { homeDir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not found/);
  assert.doesNotMatch(result.stderr, /Error:/);
  assert.doesNotMatch(result.stderr, /at /);
}));

test('PowerShell history: saves and loads recent commands from PSReadLine file', withTempHome(async (t, { homeDir }) => {
  // Create a fake PSReadLine history file with some commands.
  const psReadLineDir = path.join(homeDir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine');
  fs.mkdirSync(psReadLineDir, { recursive: true });
  const historyFile = path.join(psReadLineDir, 'ConsoleHost_history.txt');
  const commands = ['Get-ChildItem', 'Set-Location Desktop', 'Write-Host Hello', 'npm test'];
  fs.writeFileSync(historyFile, commands.join('\n'), 'utf8');

  // Simulate Windows environment: APPDATA points to the fake home, SHELL is empty to trigger PowerShell detection.
  const customEnv = {
    APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
    SHELL: '', // Empty SHELL signals "not a POSIX shell" to CLI detection logic
  };

  const save = runCli(['save', 'ps-test'], { homeDir, env: customEnv });
  assert.equal(save.status, 0);
  assert.match(save.stdout, /Snapshot 'ps-test' saved/);

  // Load and verify the commands are captured.
  const load = runCli(['load', 'ps-test'], { homeDir, env: customEnv });
  assert.equal(load.status, 0);
  assert.match(load.stdout, /Get-ChildItem/);
  assert.match(load.stdout, /npm test/);
}));

test('PowerShell history: missing PSReadLine file falls back gracefully with explanatory message', withTempHome(async (t, { homeDir }) => {
  // Set up Windows environment but with no PSReadLine history file.
  const customEnv = {
    APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
    SHELL: '', // Empty SHELL signals "not a POSIX shell" to CLI detection logic
  };

  const save = runCli(['save', 'no-history'], { homeDir, env: customEnv });
  assert.equal(save.status, 0);

  // Load and verify the explanatory message is shown instead of bare "(none)".
  const load = runCli(['load', 'no-history'], { homeDir, env: customEnv });
  assert.equal(load.status, 0);
  assert.match(load.stdout, /\(none — could not read shell history\)/);
}));

test('PowerShell history: APPDATA unset falls back gracefully', withTempHome(async (t, { homeDir }) => {
  // Windows environment but APPDATA is unset (edge case).
  const customEnv = {
    SHELL: '',
  };
  // APPDATA is intentionally not set in customEnv

  const save = runCli(['save', 'no-appdata'], { homeDir, env: customEnv });
  assert.equal(save.status, 0);
  assert.match(save.stdout, /Snapshot 'no-appdata' saved/);

  // Load and verify it doesn't crash.
  const load = runCli(['load', 'no-appdata'], { homeDir, env: customEnv });
  assert.equal(load.status, 0);
  assert.match(load.stdout, /Recent commands:/);
}));

test('bash/zsh history capture unchanged: still works with SHELL env var', withTempHome(async (t, { homeDir }) => {
  // Ensure bash history capture still works when SHELL is properly set.
  const bashHistoryPath = path.join(homeDir, '.bash_history');
  fs.writeFileSync(bashHistoryPath, 'echo hello\nls -la\ncd /tmp\n', 'utf8');

  const customEnv = {
    SHELL: '/bin/bash',
  };

  const save = runCli(['save', 'bash-test'], { homeDir, env: customEnv });
  assert.equal(save.status, 0);

  const load = runCli(['load', 'bash-test'], { homeDir, env: customEnv });
  assert.equal(load.status, 0);
  assert.match(load.stdout, /echo hello/);
  assert.match(load.stdout, /ls -la/);
}));

test('cli: default redaction is on and prints redacted count', withTempHome(async (t, { homeDir }) => {
  const env = {
    AWS_SECRET_ACCESS_KEY: 'secret',
    SAFE_ENV_VAR: 'safe',
  };
  const result = runCli(['save', 'test-redacted'], { homeDir, env });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Redacted \d+ environment variables/);

  // Check load output:
  const loadResult = runCli(['load', 'test-redacted'], { homeDir, env });
  assert.equal(loadResult.status, 0);
  assert.match(loadResult.stdout, /Environment variables: \d+ saved \(redacted\)/);
}));

test('cli: --no-redact disables redaction and warns', withTempHome(async (t, { homeDir }) => {
  const env = {
    AWS_SECRET_ACCESS_KEY: 'secret',
    SAFE_ENV_VAR: 'safe',
  };
  const result = runCli(['save', 'test-unredacted', '--no-redact'], { homeDir, env });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /saving environment variables without redaction/);
  assert.doesNotMatch(result.stdout, /Redacted/);

  // Check load output:
  const loadResult = runCli(['load', 'test-unredacted'], { homeDir, env });
  assert.equal(loadResult.status, 0);
  assert.match(loadResult.stdout, /Environment variables: \d+ saved \(unredacted\)/);
}));

test('cli: --exclude adds a one-off exclusion pattern', withTempHome(async (t, { homeDir }) => {
  const env = {
    MY_CUSTOM_VAR: 'secret',
    SAFE_ENV_VAR: 'safe',
  };
  // Standard save shouldn't redact MY_CUSTOM_VAR
  const res1 = runCli(['save', 'normal-save'], { homeDir, env });
  assert.equal(res1.status, 0);
  const match1 = res1.stdout.match(/Redacted (\d+) environment variables/);
  const normalCount = match1 ? parseInt(match1[1], 10) : 0;

  // Save with --exclude should redact it
  const res2 = runCli(['save', 'excluded-save', '--exclude', 'MY_CUSTOM_VAR'], { homeDir, env });
  assert.equal(res2.status, 0);
  const match2 = res2.stdout.match(/Redacted (\d+) environment variables/);
  const excludeCount = match2 ? parseInt(match2[1], 10) : 0;

  assert.equal(excludeCount, normalCount + 1);
}));

// ── restore command tests ─────────────────────────────────────────────────────

test('restore: outputs valid POSIX shell syntax for bash target', withTempHome(async (t, { homeDir }) => {
  const env = {
    NODE_ENV: 'production',
    PORT: '3000',
    SAFE_VAR: 'hello',
  };
  runCli(['save', 'posix-snap'], { homeDir, env });

  const result = runCli(['restore', 'posix-snap', '--shell', 'bash'], { homeDir, env });
  assert.equal(result.status, 0);
  // stdout must contain a cd line for the POSIX shell
  assert.match(result.stdout, /^cd '/m);
  // stdout must contain export lines
  assert.match(result.stdout, /^export NODE_ENV=/m);
  assert.match(result.stdout, /^export PORT=/m);
  assert.match(result.stdout, /^export SAFE_VAR=/m);
  // No human-facing messages in stdout
  assert.doesNotMatch(result.stdout, /Snapshot:/);
  assert.doesNotMatch(result.stdout, /Saved:/);
}));

test('restore: outputs valid PowerShell syntax for powershell target', withTempHome(async (t, { homeDir }) => {
  const env = {
    NODE_ENV: 'production',
    PORT: '3000',
  };
  runCli(['save', 'ps-snap'], { homeDir, env });

  const result = runCli(['restore', 'ps-snap', '--shell', 'powershell'], { homeDir, env });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Set-Location -LiteralPath '/m);
  assert.match(result.stdout, /^\$env:NODE_ENV = '/m);
  assert.match(result.stdout, /^\$env:PORT = '/m);
  // No human-facing messages in stdout
  assert.doesNotMatch(result.stdout, /Snapshot:/);
}));

test('restore: values with spaces, double-quotes, $, and backticks are safely escaped in POSIX', withTempHome(async (t, { homeDir }) => {
  delete require.cache[require.resolve('../lib/storage')];
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  const storage = require('../lib/storage');

  // Craft a snapshot manually so we can put special characters directly in env values
  // without them going through the real redaction rules (these key names are safe).
  const specialSnapshot = {
    cwd: '/tmp/path with spaces',
    env: {
      SPACED: 'hello world',
      QUOTED: 'say "hello"',
      DOLLAR: 'price is $5.00',
      BACKTICK: 'use `backticks`',
      SINGLE_Q: "it's a test",
    },
    gitBranch: null,
    recentCommands: [],
    tags: [],
    timestamp: new Date().toISOString(),
    redactActive: true,
  };
  storage.saveSnapshot('special-chars', specialSnapshot);

  const result = runCli(['restore', 'special-chars', '--shell', 'bash'], { homeDir });
  assert.equal(result.status, 0);

  // cd line — path with spaces must be single-quoted
  assert.match(result.stdout, /^cd '\/tmp\/path with spaces'$/m);

  // SPACED: spaces are safe inside single quotes, no escaping needed
  assert.match(result.stdout, /^export SPACED='hello world'$/m);

  // QUOTED: double-quotes are safe inside single quotes
  assert.match(result.stdout, /^export QUOTED='say "hello"'$/m);

  // DOLLAR: $ is safe inside single quotes — cannot trigger variable expansion
  assert.match(result.stdout, /^export DOLLAR='price is \$5\.00'$/m);

  // BACKTICK: backticks are safe inside single quotes — cannot trigger command substitution
  assert.match(result.stdout, /^export BACKTICK='use `backticks`'$/m);

  // SINGLE_Q: the internal single quote must be escaped as '\'' (close-quote, backslash-quote, re-open)
  // The actual output line is: export SINGLE_Q='it'\''s a test'
  // In the raw string: 'it' then \' then 's a test'
  // We use a RegExp constructor here because the '\'' sequence in a regex literal is tricky
  // to reason about — this makes the expected pattern explicit.
  assert.ok(
    /^export SINGLE_Q='it'\\''s a test'$/m.test(result.stdout),
    `Expected SINGLE_Q to be escaped as 'it'\\''s a test', got: ${result.stdout}`,
  );
}));

test("restore: values with single quotes are escaped correctly for PowerShell (doubled '')", withTempHome(async (t, { homeDir }) => {
  delete require.cache[require.resolve('../lib/storage')];
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  const storage = require('../lib/storage');

  const specialSnapshot = {
    cwd: "C:\\Users\\O'Brien",
    env: {
      SINGLE_Q: "it's here",
      DOLLAR: 'price is $5.00',
    },
    gitBranch: null,
    recentCommands: [],
    tags: [],
    timestamp: new Date().toISOString(),
    redactActive: true,
  };
  storage.saveSnapshot('ps-special', specialSnapshot);

  const result = runCli(['restore', 'ps-special', '--shell', 'powershell'], { homeDir });
  assert.equal(result.status, 0);

  // Path with single quote — must double the single quote
  assert.match(result.stdout, /^Set-Location -LiteralPath 'C:\\Users\\O''Brien'$/m);

  // Single quote in value — must be doubled
  assert.match(result.stdout, /^\$env:SINGLE_Q = 'it''s here'$/m);

  // Dollar sign — must NOT trigger PowerShell variable expansion (safe inside single quotes)
  assert.match(result.stdout, /^\$env:DOLLAR = 'price is \$5\.00'$/m);
}));

test('restore: --cwd-only outputs only the cd line, not env vars', withTempHome(async (t, { homeDir }) => {
  const env = { NODE_ENV: 'development', SAFE_VAR: 'yes' };
  runCli(['save', 'partial-snap'], { homeDir, env });

  const result = runCli(['restore', 'partial-snap', '--shell', 'bash', '--cwd-only'], { homeDir, env });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^cd '/m);
  assert.doesNotMatch(result.stdout, /^export /m);
}));

test('restore: --env-only outputs only env var lines, not cd', withTempHome(async (t, { homeDir }) => {
  const env = { NODE_ENV: 'development', SAFE_VAR: 'yes' };
  runCli(['save', 'env-only-snap'], { homeDir, env });

  const result = runCli(['restore', 'env-only-snap', '--shell', 'bash', '--env-only'], { homeDir, env });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /^cd /m);
  assert.match(result.stdout, /^export /m);
}));

test('restore: passing both --cwd-only and --env-only fails clearly', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'conflict-snap'], { homeDir });

  const result = runCli(['restore', 'conflict-snap', '--cwd-only', '--env-only'], { homeDir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mutually exclusive/);
  // stdout must remain empty — don't emit anything eval-able on failure
  assert.equal(result.stdout.trim(), '');
}));

test('restore: redaction-saved snapshot does not output [REDACTED] values', withTempHome(async (t, { homeDir }) => {
  const env = {
    AWS_SECRET_ACCESS_KEY: 'supersecret',
    SAFE_VAR: 'safe_value',
  };
  // Default save applies redaction: AWS_SECRET_ACCESS_KEY gets stored as [REDACTED]
  runCli(['save', 'redacted-snap'], { homeDir, env });

  const result = runCli(['restore', 'redacted-snap', '--shell', 'bash'], { homeDir, env });
  assert.equal(result.status, 0);

  // The value '[REDACTED]' must NOT appear literally in the output
  assert.doesNotMatch(result.stdout, /\[REDACTED\]/);
  // The key itself must NOT appear as an export (its value would be [REDACTED])
  assert.doesNotMatch(result.stdout, /export AWS_SECRET_ACCESS_KEY=/);

  // Safe vars should still be exported
  assert.match(result.stdout, /export SAFE_VAR=/);
}));

test('restore: --no-redact snapshot prints warning to stderr, never to stdout', withTempHome(async (t, { homeDir }) => {
  const env = {
    AWS_SECRET_ACCESS_KEY: 'supersecret',
    SAFE_VAR: 'safe_value',
  };
  // Save without redaction
  runCli(['save', 'raw-snap', '--no-redact'], { homeDir, env });

  const result = runCli(['restore', 'raw-snap', '--shell', 'bash'], { homeDir, env });
  assert.equal(result.status, 0);

  // Warning must appear on stderr
  assert.match(result.stderr, /saved without redaction/);
  assert.match(result.stderr, /may contain secrets/);

  // Warning must NOT appear on stdout — stdout must stay eval-safe
  assert.doesNotMatch(result.stdout, /saved without redaction/);
  assert.doesNotMatch(result.stdout, /may contain secrets/);

  // Unredacted snapshot exports everything, including the secret key
  assert.match(result.stdout, /export AWS_SECRET_ACCESS_KEY=/);
}));

test('restore: nonexistent snapshot fails clearly with non-zero exit and empty stdout', withTempHome(async (t, { homeDir }) => {
  const result = runCli(['restore', 'does-not-exist'], { homeDir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No snapshot named 'does-not-exist'/);
  // stdout must be empty — nothing eval-able must be emitted on failure
  assert.equal(result.stdout.trim(), '');
}));

test('restore: cmd.exe target is rejected with a clear stderr message', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'cmd-snap'], { homeDir });

  const result = runCli(['restore', 'cmd-snap', '--shell', 'cmd'], { homeDir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cmd\.exe is not supported/);
  assert.match(result.stderr, /PowerShell/);
  assert.equal(result.stdout.trim(), '');
}));

test('load: includes tip hint pointing to restore command', withTempHome(async (t, { homeDir }) => {
  runCli(['save', 'tip-snap'], { homeDir });
  const result = runCli(['load', 'tip-snap'], { homeDir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /snapctx restore tip-snap/);
  assert.match(result.stdout, /eval/);
}));

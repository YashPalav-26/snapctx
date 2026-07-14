const { Command } = require('commander');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('../lib/storage');
const colors = require('../lib/colors');

function getGitBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function resolveHistoryPath() {
  const shell = process.env.SHELL || '';
  const zshHistory = path.join(os.homedir(), '.zsh_history');
  const bashHistory = path.join(os.homedir(), '.bash_history');

  if (shell.includes('zsh')) {
    return zshHistory;
  }
  if (shell.includes('bash')) {
    return bashHistory;
  }
  if (fs.existsSync(zshHistory)) {
    return zshHistory;
  }
  if (fs.existsSync(bashHistory)) {
    return bashHistory;
  }

  const appdata = process.env.APPDATA;
  if (appdata) {
    const psReadLineHistory = path.join(
      appdata,
      'Microsoft',
      'Windows',
      'PowerShell',
      'PSReadLine',
      'ConsoleHost_history.txt',
    );
    if (fs.existsSync(psReadLineHistory)) {
      return psReadLineHistory;
    }
  }

  return null;
}

function getRecentCommands() {
  try {
    const historyPath = resolveHistoryPath();
    if (!historyPath) {
      return [];
    }

    const content = fs.readFileSync(historyPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    return lines.slice(-10);
  } catch {
    return [];
  }
}

function collectTags(value, previous) {
  return previous.concat([value]);
}

function buildSnapshot(options = {}) {
  const tags = options.tag || [];
  const exclude = options.exclude || [];
  const redact = options.redact !== false;

  const { env, redactedCount } = storage.redactEnvironment(process.env, {
    cwd: process.cwd(),
    exclude,
    redact,
  });

  const snapshot = {
    cwd: process.cwd(),
    env,
    gitBranch: getGitBranch(process.cwd()),
    recentCommands: getRecentCommands(),
    tags,
    timestamp: new Date().toISOString(),
    redactActive: redact,
  };

  return { snapshot, redactedCount };
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffDays < 7) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }
  return formatDate(iso);
}

function formatSnapshotLine({ name, savedAt, tags }) {
  const tagPart = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
  const when = savedAt ? formatRelativeTime(savedAt) : 'unknown time';
  return `${name}${tagPart} — saved ${when}`;
}

function printSnapshotList(snapshots) {
  for (const snapshot of snapshots) {
    console.log(formatSnapshotLine(snapshot));
  }
}

function printLoadSummary(name, snapshot, currentBranch) {
  console.log(`Snapshot: ${name}`);
  console.log(`Saved: ${formatDate(snapshot.timestamp)}`);
  console.log(`Directory: ${snapshot.cwd}`);
  console.log(`Git branch: ${snapshot.gitBranch ?? '(none)'}`);

  const envCount = snapshot.env ? Object.keys(snapshot.env).length : 0;
  let redactSuffix = ' (unknown/legacy)';
  if (snapshot.redactActive === true) {
    redactSuffix = ' (redacted)';
  } else if (snapshot.redactActive === false) {
    redactSuffix = ' (unredacted)';
  }
  console.log(`Environment variables: ${envCount} saved${redactSuffix}`);

  if (snapshot.tags && snapshot.tags.length > 0) {
    console.log(`Tags: ${snapshot.tags.join(', ')}`);
  }

  console.log('Recent commands:');
  if (snapshot.recentCommands && snapshot.recentCommands.length > 0) {
    for (const command of snapshot.recentCommands) {
      console.log(`  ${command}`);
    }
  } else {
    console.log('  (none — could not read shell history)');
  }

  const savedBranch = snapshot.gitBranch;
  if (savedBranch !== null && currentBranch !== null && savedBranch !== currentBranch) {
    console.log(colors.yellow(
      `⚠ Branch mismatch: snapshot was on '${savedBranch}', currently on '${currentBranch}'`,
    ));
  }

  console.log(`Tip: run \`eval "$(snapctx restore ${name})"\` to apply this snapshot's cwd and env to your current shell.`);
}

function compareEnvKeys(left, right) {
  const leftKeys = new Set(Object.keys(left || {}));
  const rightKeys = new Set(Object.keys(right || {}));

  const added = [...rightKeys].filter((key) => !leftKeys.has(key));
  const removed = [...leftKeys].filter((key) => !rightKeys.has(key));
  const changed = [...leftKeys].filter((key) => {
    if (!rightKeys.has(key)) {
      return false;
    }
    return left[key] !== right[key];
  });

  return { added, removed, changed };
}

function printDiffSummary(name1, snapshot1, name2, snapshot2) {
  console.log(`Comparing '${name1}' vs '${name2}'`);
  console.log('');

  if (snapshot1.cwd === snapshot2.cwd) {
    console.log('cwd: unchanged');
  } else {
    console.log(`cwd: ${snapshot1.cwd} -> ${snapshot2.cwd}`);
  }

  if (snapshot1.gitBranch === snapshot2.gitBranch) {
    console.log('git branch: unchanged');
  } else {
    console.log(`git branch: ${snapshot1.gitBranch ?? '(none)'} -> ${snapshot2.gitBranch ?? '(none)'}`);
  }

  const envDiff = compareEnvKeys(snapshot1.env, snapshot2.env);
  if (envDiff.added.length === 0 && envDiff.removed.length === 0 && envDiff.changed.length === 0) {
    console.log('env vars: unchanged');
  } else {
    if (envDiff.added.length > 0) {
      const label = `${envDiff.added.length} env var${envDiff.added.length === 1 ? '' : 's'} added`;
      console.log(colors.green(`${label}: ${envDiff.added.join(', ')}`));
    }
    if (envDiff.removed.length > 0) {
      const label = `${envDiff.removed.length} env var${envDiff.removed.length === 1 ? '' : 's'} removed`;
      console.log(colors.red(`${label}: ${envDiff.removed.join(', ')}`));
    }
    if (envDiff.changed.length > 0) {
      const label = `${envDiff.changed.length} env var${envDiff.changed.length === 1 ? '' : 's'} changed`;
      console.log(`${label}: ${envDiff.changed.join(', ')}`);
    }
  }

  const leftCommands = snapshot1.recentCommands || [];
  const rightCommands = snapshot2.recentCommands || [];
  const commandsEqual = leftCommands.length === rightCommands.length
    && leftCommands.every((command, index) => command === rightCommands[index]);

  if (commandsEqual) {
    console.log('recent commands: unchanged');
  } else {
    console.log(
      `recent commands: differ (${leftCommands.length} vs ${rightCommands.length} entries)`,
    );
  }
}

function saveAction(name, options) {
  if (options.redact === false) {
    console.log(colors.yellow('⚠ saving environment variables without redaction — this snapshot may contain secrets'));
  }

  const { snapshot, redactedCount } = buildSnapshot(options);
  try {
    storage.saveSnapshot(name, snapshot);
  } catch (err) {
    console.error(`Failed to save snapshot: ${err.message}`);
    process.exit(1);
  }
  console.log(colors.green(`Snapshot '${name}' saved.`));
  if (options.redact !== false) {
    console.log(`Redacted ${redactedCount} environment variables (use --no-redact to disable).`);
  }
}

function loadAction(name) {
  const snapshot = storage.loadSnapshot(name);
  if (!snapshot) {
    console.error(`No snapshot named '${name}'.`);
    process.exit(1);
  }

  const currentBranch = getGitBranch(process.cwd());
  printLoadSummary(name, snapshot, currentBranch);
}

/**
 * Escapes a value to prevent command injection when evaluated in POSIX shells (bash, zsh).
 *
 * Security Design:
 * - We wrap the entire string in single quotes: 'VALUE'.
 * - POSIX shells treat everything inside single quotes literally (no variable expansion,
 *   no backtick execution, no command substitution).
 * - The only character that cannot appear inside a single-quoted string is the single quote itself.
 * - To represent a single quote inside single quotes, we must close the current single-quoted string ('),
 *   provide an escaped single quote (\'), and then open a new single-quoted string (').
 *   Thus, any literal ' in the value is replaced by '\''.
 * - For example, if value is: hello'world; $(evil)
 *   It becomes: 'hello'\''world; $(evil)'
 *   This evaluates to the literal string: hello'world; $(evil)
 * - This prevents all command injection attacks, as any shell-meaningful characters ($, `, ;, |, etc.)
 *   remain strictly bound inside the outer single quotes.
 */
function escapePosix(val) {
  return "'" + val.replace(/'/g, "'\\''") + "'";
}

/**
 * Escapes a value to prevent command injection when evaluated in PowerShell (Invoke-Expression).
 *
 * Security Design:
 * - We wrap the entire string in single quotes: 'VALUE'.
 * - PowerShell treats single-quoted strings as literal/verbatim (no variable expansion like $var,
 *   no command substitution like $(...), and no escape characters like `).
 * - The only character that has special meaning inside a PowerShell single-quoted string is the
 *   single quote itself.
 * - To represent a single quote inside a PowerShell single-quoted string, it must be doubled: ''.
 * - For example, if value is: hello'world; $(evil)
 *   It becomes: 'hello''world; $(evil)'
 *   This evaluates to the literal string: hello'world; $(evil)
 * - This ensures that command execution or variable interpolation cannot be triggered during evaluation.
 */
function escapePowerShell(val) {
  return "'" + val.replace(/'/g, "''") + "'";
}

function getShell(options) {
  if (options.shell) {
    return options.shell.toLowerCase();
  }

  const envShell = process.env.SHELL || '';
  if (envShell.includes('zsh')) {
    return 'zsh';
  }
  if (envShell.includes('bash')) {
    return 'bash';
  }

  // Match the history-based shell detection logic
  const zshHistory = path.join(os.homedir(), '.zsh_history');
  const bashHistory = path.join(os.homedir(), '.bash_history');
  if (fs.existsSync(zshHistory)) {
    return 'zsh';
  }
  if (fs.existsSync(bashHistory)) {
    return 'bash';
  }

  const appdata = process.env.APPDATA;
  if (appdata) {
    const psReadLineHistory = path.join(
      appdata,
      'Microsoft',
      'Windows',
      'PowerShell',
      'PSReadLine',
      'ConsoleHost_history.txt',
    );
    if (fs.existsSync(psReadLineHistory)) {
      return 'powershell';
    }
  }

  if (os.platform() === 'win32') {
    return 'powershell';
  }
  return 'bash';
}

function restoreAction(name, options) {
  if (options.cwdOnly && options.envOnly) {
    console.error('Error: --cwd-only and --env-only are mutually exclusive.');
    process.exit(1);
  }

  const snapshot = storage.loadSnapshot(name);
  if (!snapshot) {
    console.error(`No snapshot named '${name}'.`);
    process.exit(1);
  }

  const targetShell = getShell(options);

  if (targetShell === 'cmd') {
    // cmd.exe is explicitly rejected because:
    // 1. It lacks a direct native equivalent to `eval` / `Invoke-Expression` for piping stdout directly into the parent process environment.
    // 2. Its quoting and escaping rules are extremely complex and brittle (e.g. handling characters like %, ^, &, <, >, |), which makes it highly prone to command injection vulnerabilities when evaluating generated scripts.
    // 3. PowerShell is widely available on Windows and provides a much safer and cleaner alternative.
    console.error('Error: cmd.exe is not supported for restoring snapshots. Please use PowerShell instead.');
    process.exit(1);
  }

  if (targetShell !== 'bash' && targetShell !== 'zsh' && targetShell !== 'powershell') {
    console.error(`Error: Unsupported shell '${targetShell}'. Valid shells are bash, zsh, powershell.`);
    process.exit(1);
  }

  // Print warning to stderr if snapshot was saved without redaction
  if (snapshot.redactActive === false) {
    console.error('⚠ this snapshot was saved without redaction and may contain secrets');
  }

  const outputLines = [];

  const doCwd = !options.envOnly;
  const doEnv = !options.cwdOnly;

  if (doCwd && snapshot.cwd) {
    if (targetShell === 'powershell') {
      // Set-Location -LiteralPath is used to prevent PowerShell from interpreting square brackets/wildcards
      outputLines.push(`Set-Location -LiteralPath ${escapePowerShell(snapshot.cwd)}`);
    } else {
      outputLines.push(`cd ${escapePosix(snapshot.cwd)}`);
    }
  }

  if (doEnv && snapshot.env) {
    for (const [key, value] of Object.entries(snapshot.env)) {
      if (value === '[REDACTED]') {
        continue;
      }
      if (targetShell === 'powershell') {
        outputLines.push(`$env:${key} = ${escapePowerShell(value)}`);
      } else {
        outputLines.push(`export ${key}=${escapePosix(value)}`);
      }
    }
  }

  if (outputLines.length > 0) {
    console.log(outputLines.join('\n'));
  }
}

function listAction(options) {
  const snapshots = options.tag
    ? storage.searchSnapshots({ tag: options.tag })
    : storage.listSnapshots();

  if (snapshots.length === 0) {
    console.log(options.tag ? `No snapshots with tag '${options.tag}'.` : 'No snapshots saved yet.');
    return;
  }

  printSnapshotList(snapshots);
}

function deleteAction(name) {
  const deleted = storage.deleteSnapshot(name);
  if (!deleted) {
    console.error(`No snapshot named '${name}'.`);
    process.exit(1);
  }

  console.log(colors.green(`Snapshot '${name}' deleted.`));
}

function searchAction(query) {
  const snapshots = storage.searchSnapshots({ query });
  if (snapshots.length === 0) {
    console.log(`No snapshots match '${query}'.`);
    return;
  }

  printSnapshotList(snapshots);
}

function diffAction(name1, name2) {
  const snapshot1 = storage.loadSnapshot(name1);
  if (!snapshot1) {
    console.error(`No snapshot named '${name1}'.`);
    process.exit(1);
  }

  const snapshot2 = storage.loadSnapshot(name2);
  if (!snapshot2) {
    console.error(`No snapshot named '${name2}'.`);
    process.exit(1);
  }

  printDiffSummary(name1, snapshot1, name2, snapshot2);
}

function exportAction(name, options) {
  const snapshot = storage.loadSnapshot(name);
  if (!snapshot) {
    console.error(`No snapshot named '${name}'.`);
    process.exit(1);
  }

  let outPath = options.out || path.join(process.cwd(), `${name}.snapctx.json`);
  outPath = path.resolve(outPath);

  try {
    const stats = fs.statSync(outPath);
    if (stats.isDirectory()) {
      outPath = path.join(outPath, `${name}.snapctx.json`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Cannot write to '${outPath}': ${err.message}`);
      process.exit(1);
    }
    const parentDir = path.dirname(outPath);
    if (!fs.existsSync(parentDir)) {
      console.error(`Parent directory does not exist: ${parentDir}`);
      process.exit(1);
    }
  }

  try {
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (err) {
    console.error(`Failed to write snapshot: ${err.message}`);
    process.exit(1);
  }
  console.log(colors.green(`Snapshot '${name}' exported to ${outPath}.`));
}

function importAction(file, options) {
  let parsed;
  try {
    const resolved = path.resolve(file);
    let stats;
    try {
      stats = fs.statSync(resolved);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.error(`Snapshot file not found: ${file}`);
        process.exit(1);
      }
      console.error(`Cannot access '${file}': ${err.message}`);
      process.exit(1);
    }
    if (stats.isDirectory()) {
      console.error(`'${file}' is a directory, not a snapshot file.`);
      process.exit(1);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Snapshot file not found: ${file}`);
    } else if (err instanceof SyntaxError) {
      console.error(`Could not parse '${file}': invalid JSON.`);
    } else {
      console.error(`Could not read or parse '${file}'.`);
    }
    process.exit(1);
  }

  const validation = storage.validateSnapshot(parsed);
  if (!validation.valid) {
    console.error(`Invalid snapshot file. Missing fields: ${validation.missing.join(', ')}.`);
    process.exit(1);
  }

  parsed.tags = storage.normalizeTags(parsed.tags);

  const name = options.as || storage.deriveImportName(file);
  if (!name) {
    console.error('Could not determine a snapshot name. Use --as <name>.');
    process.exit(1);
  }

  const existing = storage.loadSnapshot(name);
  if (existing && !options.force) {
    console.error(`Snapshot '${name}' already exists. Use --force to overwrite.`);
    process.exit(1);
  }

  storage.saveSnapshot(name, parsed);
  console.log(colors.green(`Snapshot imported as '${name}'.`));
}

const program = new Command();

program
  .name('snapctx')
  .description('Save and restore developer environment snapshots');

program
  .command('save')
  .argument('<name>', 'snapshot name')
  .description('Save the current working context')
  .option('-t, --tag <tag>', 'tag to attach (repeatable)', collectTags, [])
  .option('--exclude <pattern>', 'environment variable key pattern to exclude (repeatable)', collectTags, [])
  .option('--no-redact', 'disable environment variable redaction')
  .action(saveAction);

program
  .command('load')
  .argument('<name>', 'snapshot name')
  .description('Load and display a saved snapshot')
  .action(loadAction);

program
  .command('restore')
  .argument('<name>', 'snapshot name')
  .description('Restore a saved snapshot into the shell')
  .option('--shell <shell>', 'explicit shell override (bash, zsh, powershell, cmd)')
  .option('--cwd-only', 'output only the cwd restore command')
  .option('--env-only', 'output only the env restore commands')
  .action(restoreAction);

program
  .command('list')
  .description('List all saved snapshots')
  .option('--tag <tag>', 'filter by tag')
  .action(listAction);

program
  .command('delete')
  .alias('rm')
  .argument('<name>', 'snapshot name')
  .description('Delete a saved snapshot')
  .action(deleteAction);

program
  .command('search')
  .argument('<query>', 'search query')
  .description('Search snapshots by name, tag, cwd, or branch')
  .action(searchAction);

program
  .command('diff')
  .argument('<name1>', 'first snapshot name')
  .argument('<name2>', 'second snapshot name')
  .description('Compare two snapshots')
  .action(diffAction);

program
  .command('export')
  .argument('<name>', 'snapshot name')
  .description('Export a snapshot to a portable JSON file')
  .option('-o, --out <path>', 'output file path')
  .action(exportAction);

program
  .command('import')
  .argument('<file>', 'snapshot file to import')
  .description('Import a snapshot file into ~/.snapctx')
  .option('--as <name>', 'save under a different name')
  .option('--force', 'overwrite an existing snapshot with the same name')
  .action(importAction);

program.parse();

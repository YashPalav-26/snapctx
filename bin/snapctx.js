#!/usr/bin/env node

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

  // Detect POSIX shells (bash, zsh) explicitly via SHELL env var or file existence.
  // SHELL is a POSIX convention and should be reliable when set, but on Windows it's typically absent.
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

  // On Windows without a POSIX shell environment, check for PowerShell PSReadLine history.
  // PSReadLine (used by both Windows PowerShell 5.x and PowerShell 7+/pwsh) stores command history here.
  if (process.platform === 'win32') {
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
  }

  // No shell history file found. This is normal for cmd.exe (which has no persistent history file)
  // and for any shell environment where history capture is disabled or hasn't been used yet.
  return null;
}

function getRecentCommands() {
  try {
    const historyPath = resolveHistoryPath();
    if (!historyPath) {
      return [];
    }

    const content = fs.readFileSync(historyPath, 'utf8');
    // zsh extended history can prefix lines with timestamps; we take raw lines as-is for v1.
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    return lines.slice(-10);
  } catch {
    return [];
  }
}

function collectTags(value, previous) {
  return previous.concat([value]);
}

function buildSnapshot(tags = []) {
  return {
    cwd: process.cwd(),
    env: { ...process.env },
    gitBranch: getGitBranch(process.cwd()),
    recentCommands: getRecentCommands(),
    tags,
    timestamp: new Date().toISOString(),
  };
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

  // Full env is preserved in the JSON file; avoid dumping it to the terminal.
  const envCount = snapshot.env ? Object.keys(snapshot.env).length : 0;
  console.log(`Environment variables: ${envCount} saved`);

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

  // Deliberately compare env keys only — values may contain secrets.
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
  const snapshot = buildSnapshot(options.tag || []);
  try {
    storage.saveSnapshot(name, snapshot);
  } catch (err) {
    console.error(`Failed to save snapshot: ${err.message}`);
    process.exit(1);
  }
  console.log(colors.green(`Snapshot '${name}' saved.`));
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

  // Check if the resolved path is a directory; if so, use default filename inside it.
  try {
    const stats = fs.statSync(outPath);
    if (stats.isDirectory()) {
      outPath = path.join(outPath, `${name}.snapctx.json`);
    }
  } catch (err) {
    // Path doesn't exist yet, which is fine. Check if parent directory exists.
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
    // Check if path is a directory before attempting to read it as a file.
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
  .action(saveAction);

program
  .command('load')
  .argument('<name>', 'snapshot name')
  .description('Load and display a saved snapshot')
  .action(loadAction);

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

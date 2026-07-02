
const { Command } = require('commander');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('../lib/storage');

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

function buildSnapshot() {
  return {
    cwd: process.cwd(),
    env: { ...process.env },
    gitBranch: getGitBranch(process.cwd()),
    recentCommands: getRecentCommands(),
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

function printLoadSummary(name, snapshot, currentBranch) {
  console.log(`Snapshot: ${name}`);
  console.log(`Saved: ${formatDate(snapshot.timestamp)}`);
  console.log(`Directory: ${snapshot.cwd}`);
  console.log(`Git branch: ${snapshot.gitBranch ?? '(none)'}`);

  // Full env is preserved in the JSON file; avoid dumping it to the terminal.
  const envCount = snapshot.env ? Object.keys(snapshot.env).length : 0;
  console.log(`Environment variables: ${envCount} saved`);

  console.log('Recent commands:');
  if (snapshot.recentCommands && snapshot.recentCommands.length > 0) {
    for (const command of snapshot.recentCommands) {
      console.log(`  ${command}`);
    }
  } else {
    console.log('  (none)');
  }

  const savedBranch = snapshot.gitBranch;
  if (savedBranch !== null && currentBranch !== null && savedBranch !== currentBranch) {
    console.log(`⚠ Branch mismatch: snapshot was on '${savedBranch}', currently on '${currentBranch}'`);
  }
}

function saveAction(name) {
  const snapshot = buildSnapshot();
  storage.saveSnapshot(name, snapshot);
  console.log(`Snapshot '${name}' saved.`);
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

function listAction() {
  const snapshots = storage.listSnapshots();
  if (snapshots.length === 0) {
    console.log('No snapshots saved yet.');
    return;
  }

  for (const { name, savedAt } of snapshots) {
    const when = savedAt ? formatRelativeTime(savedAt) : 'unknown time';
    console.log(`${name}    ${when}`);
  }
}

const program = new Command();

program
  .name('snapctx')
  .description('Save and restore developer environment snapshots');

program
  .command('save')
  .argument('<name>', 'snapshot name')
  .description('Save the current working context')
  .action(saveAction);

program
  .command('load')
  .argument('<name>', 'snapshot name')
  .description('Load and display a saved snapshot')
  .action(loadAction);

program
  .command('list')
  .description('List all saved snapshots')
  .action(listAction);

program.parse();

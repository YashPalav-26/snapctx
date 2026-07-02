const fs = require('fs');
const path = require('path');
const os = require('os');

function getStorageDir() {
  return path.join(os.homedir(), '.snapctx');
}

function ensureStorageDir() {
  fs.mkdirSync(getStorageDir(), { recursive: true });
}

function snapshotPath(name) {
  return path.join(getStorageDir(), `${name}.json`);
}

function saveSnapshot(name, snapshot) {
  ensureStorageDir();
  fs.writeFileSync(snapshotPath(name), JSON.stringify(snapshot, null, 2), 'utf8');
}

function loadSnapshot(name) {
  try {
    const raw = fs.readFileSync(snapshotPath(name), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function listSnapshots() {
  ensureStorageDir();
  const dir = getStorageDir();
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const snapshots = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const name = file.slice(0, -'.json'.length);
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const snapshot = JSON.parse(raw);
      snapshots.push({ name, savedAt: snapshot.timestamp });
    } catch {
      // Skip unreadable or corrupt snapshot files.
    }
  }
  return snapshots;
}

module.exports = {
  getStorageDir,
  ensureStorageDir,
  saveSnapshot,
  loadSnapshot,
  listSnapshots,
};

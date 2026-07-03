const fs = require('fs');
const path = require('path');
const os = require('os');

const REQUIRED_SNAPSHOT_FIELDS = ['cwd', 'timestamp', 'env', 'gitBranch', 'recentCommands'];

function getStorageDir() {
  return path.join(os.homedir(), '.snapctx');
}

function ensureStorageDir() {
  const storageDir = getStorageDir();
  try {
    // Check if path already exists as a file (not a directory).
    const stats = fs.statSync(storageDir);
    if (!stats.isDirectory()) {
      throw new Error(`${storageDir} exists but is not a directory.`);
    }
  } catch (err) {
    // If ENOENT, directory doesn't exist; mkdirSync will create it.
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
  fs.mkdirSync(storageDir, { recursive: true });
}

function snapshotPath(name) {
  return path.join(getStorageDir(), `${name}.json`);
}

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags : [];
}

function normalizeSnapshot(snapshot) {
  snapshot.tags = normalizeTags(snapshot.tags);
  return snapshot;
}

function readSnapshotFile(filePath, name) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const snapshot = normalizeSnapshot(JSON.parse(raw));
    return {
      name,
      savedAt: snapshot.timestamp,
      tags: snapshot.tags,
      cwd: snapshot.cwd,
      gitBranch: snapshot.gitBranch,
      snapshot,
    };
  } catch {
    return null;
  }
}

function readAllSnapshotRecords() {
  ensureStorageDir();
  const dir = getStorageDir();
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const records = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const name = file.slice(0, -'.json'.length);
    const record = readSnapshotFile(path.join(dir, file), name);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

function saveSnapshot(name, snapshot) {
  try {
    ensureStorageDir();
  } catch (err) {
    throw new Error(`Cannot access snapshot storage: ${err.message}`);
  }
  fs.writeFileSync(snapshotPath(name), JSON.stringify(snapshot, null, 2), 'utf8');
}

function loadSnapshot(name) {
  try {
    const raw = fs.readFileSync(snapshotPath(name), 'utf8');
    return normalizeSnapshot(JSON.parse(raw));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function deleteSnapshot(name) {
  try {
    fs.unlinkSync(snapshotPath(name));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

function listSnapshots() {
  return readAllSnapshotRecords().map(({ name, savedAt, tags, cwd, gitBranch }) => ({
    name,
    savedAt,
    tags,
    cwd,
    gitBranch,
  }));
}

function matchesQuery(record, query) {
  if (!query) {
    return true;
  }

  const needle = query.toLowerCase();
  const haystacks = [
    record.name,
    record.cwd,
    record.gitBranch ?? '',
    ...record.tags,
  ];

  return haystacks.some((value) => String(value).toLowerCase().includes(needle));
}

function matchesTag(record, tag) {
  if (!tag) {
    return true;
  }

  const needle = tag.toLowerCase();
  return record.tags.some((value) => String(value).toLowerCase() === needle);
}

function searchSnapshots({ query, tag } = {}) {
  return readAllSnapshotRecords()
    .filter((record) => matchesTag(record, tag) && matchesQuery(record, query))
    .map(({ name, savedAt, tags, cwd, gitBranch }) => ({
      name,
      savedAt,
      tags,
      cwd,
      gitBranch,
    }));
}

function validateSnapshot(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, missing: REQUIRED_SNAPSHOT_FIELDS.slice() };
  }

  const missing = REQUIRED_SNAPSHOT_FIELDS.filter((field) => !(field in data));
  return { valid: missing.length === 0, missing };
}

function deriveImportName(filePath) {
  let base = path.basename(filePath);
  if (base.endsWith('.snapctx.json')) {
    base = base.slice(0, -'.snapctx.json'.length);
  } else if (base.endsWith('.json')) {
    base = base.slice(0, -'.json'.length);
  }
  return base;
}

module.exports = {
  getStorageDir,
  ensureStorageDir,
  saveSnapshot,
  loadSnapshot,
  deleteSnapshot,
  listSnapshots,
  searchSnapshots,
  validateSnapshot,
  deriveImportName,
  normalizeTags,
};

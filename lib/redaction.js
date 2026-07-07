const fs = require('fs');
const path = require('path');

const DEFAULT_DENYLIST = [
  '*_SECRET*',
  '*_KEY*',
  '*_TOKEN*',
  '*PASSWORD*',
  '*_PASS*',
  'AWS_*',
  '*_CREDENTIALS*',
  '*API_KEY*',
  '*PRIVATE_KEY*',
  '*ACCESS_KEY*',
];

function matchPattern(key, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(key);
}

function parseIgnoreFile(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function loadIgnorePatterns(cwd, storageDir) {
  const patterns = [];

  if (storageDir) {
    const globalPath = path.join(storageDir, '.snapctxignore');
    try {
      if (fs.existsSync(globalPath)) {
        const content = fs.readFileSync(globalPath, 'utf8');
        patterns.push(...parseIgnoreFile(content));
      }
    } catch (err) {
      console.warn(`Warning: Cannot read global .snapctxignore: ${err.message}`);
    }
  }

  if (cwd) {
    const projectPath = path.join(cwd, '.snapctxignore');
    try {
      if (fs.existsSync(projectPath)) {
        const content = fs.readFileSync(projectPath, 'utf8');
        patterns.push(...parseIgnoreFile(content));
      }
    } catch (err) {
      console.warn(`Warning: Cannot read project .snapctxignore: ${err.message}`);
    }
  }

  return patterns;
}

function redactEnvironment(env, options = {}) {
  const { cwd = process.cwd(), storageDir, exclude = [], redact = true } = options;

  if (!redact) {
    return { env: { ...env }, redactedCount: 0 };
  }

  const ignorePatterns = loadIgnorePatterns(cwd, storageDir);
  const allPatterns = [
    ...DEFAULT_DENYLIST,
    ...ignorePatterns,
    ...exclude,
  ];

  const redacted = {};
  let redactedCount = 0;

  for (const key of Object.keys(env)) {
    const matched = allPatterns.some((pattern) => matchPattern(key, pattern));
    if (matched) {
      redacted[key] = '[REDACTED]';
      redactedCount++;
    } else {
      redacted[key] = env[key];
    }
  }

  return { env: redacted, redactedCount };
}

module.exports = {
  DEFAULT_DENYLIST,
  matchPattern,
  parseIgnoreFile,
  loadIgnorePatterns,
  redactEnvironment,
};

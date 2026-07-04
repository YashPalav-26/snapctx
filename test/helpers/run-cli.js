const { spawnSync } = require('child_process');
const path = require('path');

const CLI_PATH = path.join(__dirname, '..', '..', 'bin', 'snapctx.js');

function runCli(args, { homeDir, cwd, env: customEnv } = {}) {
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    NO_COLOR: '1',
    ...customEnv,
  };

  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: cwd || process.cwd(),
    env,
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

module.exports = {
  runCli,
};

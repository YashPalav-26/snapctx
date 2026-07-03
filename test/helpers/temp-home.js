const fs = require('fs');
const os = require('os');
const path = require('path');

function createTempHome() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapctx-test-home-'));

  function cleanup() {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }

  return { homeDir, cleanup };
}

module.exports = {
  createTempHome,
};

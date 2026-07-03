const enabled = !process.env.NO_COLOR && process.stdout.isTTY;

function wrap(code, text) {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

module.exports = {
  enabled,
  green: (text) => wrap(32, text),
  yellow: (text) => wrap(33, text),
  red: (text) => wrap(31, text),
};

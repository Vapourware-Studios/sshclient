const fs = require('node:fs');
const os = require('node:os');

function defaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  let loginShell;
  try { loginShell = os.userInfo().shell; } catch {}
  const candidates = [process.env.SHELL, loginShell, process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash', '/bin/sh'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error('No usable login shell found. Choose a shell in the connection settings.');
}

module.exports = { defaultShell };

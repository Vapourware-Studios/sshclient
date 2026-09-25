const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Arch, getArtifactArchName } = require('builder-util');
const { version } = require('../package.json');

async function main() {
  const arch = process.argv[2] || process.arch;
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Linux architecture: ${arch}`);
  const lines = [];
  for (const format of ['AppImage', 'deb', 'rpm', 'pacman']) {
    const extension = format === 'pacman' ? 'pkg.tar.zst' : format;
    const suffix = `linux-${getArtifactArchName(Arch[arch], format)}.${extension}`;
    const name = `sshclient-${version}-${suffix}`;
    const stableName = `sshclient-${suffix}`;
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join('release', name))) hash.update(chunk);
    const digest = hash.digest('hex');
    // Stable release URLs let native package-manager commands survive upgrades.
    fs.copyFileSync(path.join('release', name), path.join('release', stableName));
    lines.push(`${digest}  ${name}`, `${digest}  ${stableName}`);
  }
  fs.writeFileSync(path.join('release', `SHA256SUMS-linux-${arch}`), `${lines.join('\n')}\n`);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });

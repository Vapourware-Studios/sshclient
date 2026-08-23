'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

/**
 * macOS decides whether an app may speak to the network it is plugged into by
 * looking up the bundle that opened the socket and reading its usage string.
 * For an Electron app that lookup lands on the helper bundles, not the app —
 * and electron-builder's `extendInfo` only writes the outer Info.plist. With
 * nothing to find, the system has no permission to ask about, so it never
 * prompts, never lists the app under Local Network, and quietly refuses every
 * connection to a LAN address with EHOSTUNREACH.
 *
 * So copy the declaration into each helper. This has to happen here, before
 * electron-builder signs: editing a plist inside a signed bundle invalidates
 * the signature and the app will not launch.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const frameworks = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Frameworks');
  if (!fs.existsSync(frameworks)) return;

  const description = context.packager.config?.mac?.extendInfo?.NSLocalNetworkUsageDescription;
  if (!description) return;

  for (const entry of fs.readdirSync(frameworks)) {
    if (!entry.endsWith('.app')) continue;
    const plist = path.join(frameworks, entry, 'Contents', 'Info.plist');
    if (!fs.existsSync(plist)) continue;

    // PlistBuddy has no upsert: Add fails when the key is already there and
    // Set fails when it is not. A rebuild over a tree that still holds the last
    // run's output hits the first case, and an aborted package build is a poor
    // reward for not having cleaned first — so try both.
    const write = (verb) =>
      execFileSync('/usr/libexec/PlistBuddy', [
        '-c',
        `${verb} :NSLocalNetworkUsageDescription${verb === 'Add' ? ' string' : ''} ${description}`,
        plist,
      ], { stdio: 'ignore' });

    try {
      write('Add');
    } catch {
      write('Set');
    }
  }
};

# Linux packages

SSH Client produces native packages for Arch/Manjaro (`.pkg.tar.zst`),
Ubuntu/Debian (`.deb`), and Fedora/openSUSE (`.rpm`), plus a portable AppImage.
The release workflow builds x86-64 and ARM64 packages separately, using Ubuntu
22.04 for both so native modules do not inherit the build machine's newer glibc.
These are glibc builds; Alpine's musl runtime needs its own build and testing.

Native packages install the application icon, `sshclient` command, and the
`sshclient://` protocol handler used by sign-in and terminal sharing. Dependencies
include the desktop libraries, `udevadm` for serial discovery, and `secret-tool`
for Termius import. Import also requires an unlocked Secret Service keyring
containing the Termius credentials.

## Installation and updates

Download the matching CPU/package from GitHub Releases and install it with the
commands in the main README. No Node.js, compiler, or shell installer is needed.
The release workflow also creates stable `sshclient-linux-*` asset names for
package distribution and `SHA256SUMS-linux-x64` / `SHA256SUMS-linux-arm64` manifests.
These new names become available when a release containing this workflow ships.

Until a package repository is published, packages downloaded from GitHub update
through **Settings → Updates**, or by downloading the next package. Installing
a local package alone does not add a repository to `apt`, `pacman` or `dnf`.
The in-app updater checks SHA-256 before handing the file to a package manager;
AppImages use electron-updater's verification and replacement flow.

## Serial devices

The app uses normal device permissions. When access is denied, it identifies
the device's group and explains how to grant access. Typical desktop setups use:

```bash
# Arch/Manjaro
sudo usermod -aG uucp "$(id -un)"
# Ubuntu/Debian/Fedora
sudo usermod -aG dialout "$(id -un)"
```

Use the group reported for the device, then log out of the desktop and log in
again. Do not run the app as root or make serial devices world-writable.

## Building and checking

Use Node.js 24 LTS and install your distro's C/C++ build toolchain and
Python 3 for the native modules. Arch requires `base-devel` and `python`;
Ubuntu/Debian requires `build-essential` and `python3`. Building all package
formats also requires RPM build tools, libarchive/bsdtar and zstd.

```bash
npm ci
npm test
npm run build
npm run dist:linux:arch
npm run test:linux:smoke -- release/linux-unpacked/resources/app.asar
```

Use `npm run dist:linux` to produce every format. The smoke check needs an active
desktop or Xvfb and Python 3. It creates a temporary vault/profile, generates
temporary SSH keys, and runs a local SSH/SFTP server and a virtual serial device.
It tests the renderer and preload bridge, encrypted vault persistence, all three
key types, local PTY I/O, serial PTY I/O, SSH channels, SFTP upload/download, and
local forwarding. Run it on X11 and Wayland to check both desktop paths. Its
optional argument loads the modules and renderer from the packaged ASAR.

The Linux CI workflow runs the unit suite, builds all four formats, and runs
the packaged-resource smoke check before uploading artifacts. The release
workflow waits for both CPUs to pass before publishing Linux packages.

Arch x86-64 has been checked locally. CI coverage is defined for x86-64 and ARM64;
a successful local Arch run does not establish compatibility with every distro.
Physical serial hardware, actual browser-to-app sign-in, cross-device cloud
sync/sharing, and package installation on each target distro still require
their own end-to-end checks. Native macOS Liquid Glass is a macOS visual effect;
Linux uses the normal theme and window controls.

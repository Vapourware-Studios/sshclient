# SSH Client

A Termius-style SSH and SFTP client for macOS, Windows, and Linux — built from
scratch with Electron, React, and xterm.js, mostly as an excuse to actually
*learn* JavaScript instead of just copy-pasting it into working shape.

It ended up doing the boring-but-essential stuff properly: real SSH terminals,
a dual-pane SFTP browser with drag-and-drop, an encrypted vault for your hosts
and keys, port forwarding, and optional end-to-end encrypted sync across
machines.

[![License](https://img.shields.io/github/license/Vapourware-Studios/sshclient?color=blue)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Vapourware-Studios/sshclient?label=release&color=brightgreen)](https://github.com/Vapourware-Studios/sshclient/releases/latest)
[![Release build](https://img.shields.io/github/actions/workflow/status/Vapourware-Studios/sshclient/release.yml?label=build)](.github/workflows/release.yml)
[![Homebrew Tap](https://img.shields.io/badge/homebrew-tap-fbb040?logo=homebrew&logoColor=white)](https://github.com/Vapourware-Studios/homebrew-tap)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-informational)

> **Alpha.** It's daily-drivable, but expect rough edges — see [what's not
> done yet](#-not-there-yet) before you trust it with something critical.

---

## Features

### ✅ Done

**Terminal**
- SSH with password, private-key file, or keychain-stored key auth
- Multi-tab — open as many sessions as you want at once
- xterm.js terminal: full color, resizing, scrollback
- Local shell tab, backed by a real PTY (not a fake one)
- Serial port terminal, for routers and embedded boards
- Session recording with scrubbable playback — a black box for your terminal

**SFTP**
- Dual-pane browser: local ↔ remote, or remote ↔ remote between two open sessions
- Drag-and-drop transfers, including straight from Finder/Explorer into a remote pane
- New folder, rename, and delete from a right-click menu — no dropping to a shell just to `mkdir`
- Per-transfer progress with a safety lock against accidental drops

**Vault**
- SQLite storage encrypted with scrypt + AES-256-GCM, unlocked by one master password
- Save, edit, duplicate, and delete hosts; color-tag them so prod doesn't look like staging
- Known-host fingerprint tracking, with a warning if a host key ever changes

**Keys**
- Generate RSA (2048/3072/4096), ECDSA (256/384/521), or Ed25519 keys in-app
- Import existing keys, passphrase and all
- SHA-256 fingerprints, color tags

**Port forwarding**
- Local port forwards (the `ssh -L` kind), with a start/stop UI and live list of active tunnels

**Import**
- One-click import of hosts and keys from Termius

**Sync** *(optional)*
- Cross-device vault sync via a small companion service
- Encrypted client-side before anything leaves the machine — the server only ever stores ciphertext

**Customisation**
- Several built-in terminal color themes, plus custom CSS theme support
- Font-size controls, saved command snippets

### 🚧 Not there yet

- Remote / dynamic (`-R` / SOCKS) port forwarding — only local forwards exist right now
- Importing `~/.ssh/known_hosts` — the button's already in the UI, just disabled ("coming soon")
- Code-signed builds — macOS is ad-hoc signed, Windows is unsigned (see [Releases & auto-update](#releases--auto-update) for why)
- Intel Mac builds — releases currently ship Apple Silicon (arm64) only
- Hand-tested Windows/Linux builds — CI produces them, but they haven't been run on real hardware yet

---

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 43 |
| UI | React 19, Vite 8, Tailwind CSS 4 |
| Components | shadcn/ui (New York), Radix UI, Lucide |
| Terminal | xterm.js 6 + addon-fit |
| SSH / SFTP | ssh2 1.17 |
| Local PTY | node-pty |
| Serial | SerialPort 13 |
| Storage | Node built-in SQLite + AES-256-GCM |

---

## Getting started

### macOS, via Homebrew

```bash
brew install --cask vapourware-studios/tap/sshclient
```

Updates ship the same way — the app checks GitHub Releases and, when there's
something newer, prompts you to `brew upgrade` instead of silently patching
itself.

### Windows / Linux

Grab the installer or AppImage from the
[latest release](https://github.com/Vapourware-Studios/sshclient/releases/latest).
Windows/Linux auto-update through `electron-updater` once installed.

### From source (any platform)

```bash
# 1. Clone
git clone https://github.com/Vapourware-Studios/sshclient.git
cd sshclient

# 2. Install dependencies (first time only)
npm install

# 3a. Run the production build
npm start

# 3b. Development mode (hot-reload UI)
npm run dev
```

### Build a distributable

```bash
npm run dist:mac    # .dmg (ad-hoc signed, not notarized — see below)
npm run dist:win    # NSIS installer, unsigned
npm run dist:linux  # AppImage
```

**Requirements:** Node 20+. Developed primarily on macOS; Windows and Linux
builds are produced by CI and haven't been hand-tested on real hardware.

---

## Releases & auto-update

Pushing a commit to `main` that bumps the `version` field in `package.json`
triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds installers for macOS, Windows, and Linux, publishes them as a
public GitHub Release tagged `v<version>`, and pushes the new version to the
[Homebrew tap](https://github.com/Vapourware-Studios/homebrew-tap). Ordinary
commits without a version bump never trigger a build.

None of these builds are code-signed — there's no Authenticode certificate or
Apple Developer ID behind this project yet. The Windows build applies
legitimate false-positive mitigations (NSIS installer rather than a raw
portable exe, normal/non-aggressive compression, consistent publisher
metadata), but Windows Defender/SmartScreen may still warn on an unsigned
installer from a publisher with no reputation — there's no reliable way
around that short of actually signing. If you hit a false positive, the
durable fix is a certificate (or Microsoft's Trusted Signing service); in the
meantime you can report it at
https://www.microsoft.com/wdsi/filesubmission.

In-app update checks (`src/main/updater.js`) only run in packaged builds:

- **Windows / Linux** — [`electron-updater`](https://www.electron.build/auto-update)
  checks GitHub Releases directly and installs updates automatically.
- **macOS** — updates come through Homebrew. The app checks the latest GitHub
  release, and if it's newer, opens a Terminal window with
  `brew upgrade --cask sshclient` typed in (not auto-run — you review and
  press Enter yourself, since `brew` can prompt for sudo). Once the installed
  cask version catches up, the app prompts you to restart. If Homebrew isn't
  found, it falls back to a "download page" prompt instead.

---

## Project layout

```
sshclient/
├── .github/workflows/
│   └── release.yml        ← Version-bump-gated build → GitHub Release → Homebrew tap
├── src/
│   ├── main/              ← Node.js / main process
│   │   ├── main.js        ←   Electron bootstrap, all IPC handlers
│   │   ├── ssh.js         ←   SSH2 wrapper: terminal, SFTP, port forwards, recordings
│   │   ├── vault.js       ←   Encrypted host + key storage
│   │   ├── sync.js        ←   Optional end-to-end encrypted cloud sync
│   │   ├── termiusImport.js ←  Import hosts/keys from an installed Termius
│   │   ├── leveldbReader.js ←  Reads Termius's local LevelDB for the importer
│   │   ├── localTerm.js   ←   PTY-backed local shell
│   │   ├── serial.js      ←   Serial port adapter
│   │   └── updater.js     ←   Auto-update: electron-updater (Win/Linux), brew flow (mac)
│   ├── preload/
│   │   └── preload.js     ← Bridge: exposes window.api to the renderer
│   └── renderer/          ← React UI (sandboxed Chrome page)
│       ├── App.jsx        ←   Tab/session management, top-level state
│       ├── index.css      ←   Tailwind + theme tokens (ONE stylesheet)
│       └── components/    ←   Feature panels + shadcn/ui building blocks
├── ROADMAP.md             ← Phase plan, lessons, and ssh2 deep-dive
├── LICENSE                ← GPL-3.0-only
└── package.json
```

---

## Docs & learning notes

`ROADMAP.md` is the heart of this project: a phase-by-phase JavaScript
curriculum tied directly to the features being built. It includes official
documentation links (Electron, xterm.js, ssh2, React, MDN) and **Appendix A**
— the ssh2 library explained protocol-level, line by line.

shadcn/ui components are not a hidden library — every component is a
readable `.jsx` file in `src/renderer/components/ui/`. Add more with:

```bash
npx shadcn@latest add <component-name>
```

---

## Status

| Phase | Description | Status |
|---|---|---|
| 0 | Electron backbone + IPC + React/Vite/Tailwind | ✅ Done |
| 1 | JavaScript fundamentals | ✅ Done |
| 2 | SSH terminal | ✅ Done |
| 3 | Vault (encrypted storage) | ✅ Done |
| 4 | SFTP browser | ✅ Done |
| 5 | Key management | ✅ Done |
| 6 | Serial port + local terminal | ✅ Done |
| 7 | React (pulled forward to Phase 0) | ✅ Done |
| 8 | Polish and ship | 🚧 Ongoing — see [Not there yet](#-not-there-yet) |

Active work: SFTP UI polish (new folder/rename/delete, context menus),
Windows/Linux hardening, and slowly working toward signed builds.

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

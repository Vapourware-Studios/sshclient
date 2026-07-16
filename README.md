# SSH Client

A modern, Termius-like SSH and SFTP desktop client for macOS, Windows, and Linux, built from scratch with Electron, React, and xterm.js — as a project to genuinely learn JavaScript.

> **v0.1.0 · alpha · GPL-3.0**

---

## Features

### Terminal
- SSH connections with password, private-key file, or keychain-based auth
- Multi-tab interface — open as many sessions as you need
- xterm.js terminal with full colour, resize, and scroll support
- Local shell tab (PTY-backed)
- Serial port terminal
- Session recording and scrubbable playback

### SFTP File Browser
- Dual-pane manager: local filesystem on one side, remote on the other
- Drag-and-drop transfers (and safety lock to prevent accidental drops)
- Remote-to-remote transfers between open sessions
- Progress tracking per transfer

### Vault (encrypted host & key storage)
- SQLite database encrypted with scrypt + AES-256-GCM
- Master-password protection
- Save, edit, duplicate, and delete SSH hosts
- Colour labels for organisation
- Known-host fingerprint tracking and change detection

### SSH Key Manager
- Generate RSA (2048 / 3072 / 4096), ECDSA (256 / 384 / 521), and Ed25519 keys
- Import existing keys with optional passphrase
- SHA-256 fingerprint display
- Colour tagging

### Customisation
- Multiple built-in terminal colour themes
- Custom CSS theme support
- Font-size controls
- Saved command snippets

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

```bash
# 1. Clone
git clone https://github.com/Vapourware-Studios/sshclient.git
cd sshclient

# 2. Install dependencies (first time only)
npm install

# 3a. Open the app (production build)
npm start

# 3b. Development mode (hot-reload UI)
npm run dev
```

### Build a distributable

```bash
npm run dist:mac    # .dmg (ad-hoc signed, not notarized — see Releases below)
npm run dist:win    # NSIS installer, unsigned
npm run dist:linux  # AppImage
```

**Requirements:** Node 20+. Developed primarily on macOS; Windows and Linux builds are produced by CI (see below) and haven't been hand-tested on real hardware.

---

## Releases & auto-update

Pushing a commit to `main` that changes the `version` field in `package.json`
triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds installers for macOS, Windows, and Linux and publishes them as a
public GitHub Release tagged `v<version>`. Ordinary commits (no version bump)
never trigger a build.

None of these builds are code-signed — there's no Authenticode certificate or
Apple Developer ID behind this project. The Windows build applies legitimate
false-positive mitigations (NSIS installer rather than a raw portable exe,
normal/non-aggressive compression, consistent publisher metadata), but
Windows Defender/SmartScreen may still warn on an unsigned installer from a
publisher with no reputation yet — there's no reliable way around that short
of actually signing. If you hit a false positive, the durable fix is a
certificate (or Microsoft's Trusted Signing service); in the meantime you can
report it at https://www.microsoft.com/wdsi/filesubmission.

In-app update checks (`src/main/updater.js`) only run in packaged builds:

- **Windows / Linux** — [`electron-updater`](https://www.electron.build/auto-update)
  checks GitHub Releases directly and installs updates automatically.
- **macOS** — updates are expected to come through Homebrew. The app checks
  the latest GitHub release, and if it's newer, opens a Terminal window with
  `brew upgrade --cask sshclient` typed in (not auto-run — you review and
  press Enter yourself, since `brew` can prompt for sudo). Once the installed
  cask version catches up, the app prompts you to restart. If Homebrew isn't
  found, it falls back to a "download page" prompt instead.

---

## Project layout

```
sshclient/
├── .github/workflows/
│   └── release.yml        ← Version-bump-gated build → GitHub Release
├── src/
│   ├── main/              ← Node.js / main process
│   │   ├── main.js        ←   Electron bootstrap, all IPC handlers
│   │   ├── ssh.js         ←   SSH2 wrapper: terminal, SFTP, recordings
│   │   ├── vault.js       ←   Encrypted host + key storage
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

`ROADMAP.md` is the heart of this project: a phase-by-phase JavaScript curriculum tied directly to the features being built. It includes official documentation links (Electron, xterm.js, ssh2, React, MDN) and **Appendix A** — the ssh2 library explained protocol-level, line by line.

shadcn/ui components are not a hidden library — every component is a readable `.jsx` file in `src/renderer/components/ui/`. Add more with:

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

Active work: UI polish, session playback improvements, theme system.

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

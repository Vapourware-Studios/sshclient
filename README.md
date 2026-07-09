# sshclient

A Termius-like SSH + SFTP client for macOS, built from scratch with Electron,
React, and shadcn/ui — as a project to genuinely learn JavaScript.

## Run it

```bash
npm install   # first time only — downloads all dependencies
npm start     # builds the UI, then opens the app window
npm run dev   # development mode: edits to the UI appear instantly (hot reload)
```

## Where everything lives

```
sshclient/
├── ROADMAP.md             ← THE PLAN. Start here. Phases, lessons, checkpoints.
├── package.json           ← project ID card: name, scripts, dependencies
├── vite.config.mjs        ← build-tool settings (Vite turns JSX/Tailwind into plain JS/CSS)
├── components.json        ← shadcn/ui settings (style, where components go)
└── src/
    ├── main/              ← MAIN PROCESS (Node.js — full power)
    │   └── main.js        ←   creates the window; SSH/SFTP will live here
    ├── preload/           ← THE BRIDGE between UI and main
    │   └── preload.js     ←   exposes window.api to the UI
    └── renderer/          ← THE UI (React — a Chrome page, sandboxed)
        ├── index.html     ←   shell page; React mounts into <div id="root">
        ├── main.jsx       ←   hands the page over to React
        ├── App.jsx        ←   the app's structure + behavior, as components
        ├── index.css      ←   Tailwind + the shadcn/ui theme (the look)
        ├── lib/utils.js   ←   cn() class-merging helper the components use
        └── components/ui/ ←   shadcn/ui building blocks (Button, Card, ...)
```

## Docs

Everything lives in `ROADMAP.md`: the phase plan, links to all official
documentation (Electron, xterm.js, ssh2, MDN, React), and Appendix A —
the ssh2 basics explained line by line.

UI components come from [shadcn/ui](https://ui.shadcn.com) — they're not a
hidden library; each one is a readable file in `src/renderer/components/ui/`.
Add more with `npx shadcn@latest add <name>`.

## Current status

**Phase 0 complete** — secure Electron backbone with a working IPC roundtrip.
The renderer now runs React + Vite + Tailwind + shadcn/ui (Phase 7 pulled
forward). Next: Phase 1 (JavaScript bootcamp). See `ROADMAP.md`.

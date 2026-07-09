# ROADMAP — Building an SSH + SFTP Client (Termius-style)

This is the master plan for the project and also the curriculum. The goal is
twofold: end up with a real SSH/SFTP client you actually use, and genuinely
learn JavaScript (and eventually React) along the way — not by copying code,
but by understanding every line that goes into the app.

Ground rule for the whole project: libraries are only allowed for the three
jobs that are unreasonable to hand-write (the app shell, the terminal renderer,
the SSH protocol). Everything else — UI, state, tabs, host storage, file
browser, transfer queue — gets written by hand, in plain JS. That's where the
learning happens.

---

## How to work through this

- One phase at a time, in order. Each phase builds on the previous one.
- Every phase has the same sections:
  - **Goal** — what exists when the phase is done
  - **What you'll learn** — the language/runtime concepts tied to this phase
  - **Steps** — the work, in order
  - **Done when** — a concrete checkpoint, so "finished" isn't a feeling
  - **Traps** — the standard mistakes people make here
  - **Docs** — the official documentation relevant to the phase
- Type the code yourself instead of pasting it. Typing forces you to read
  every character, and that's most of the learning.
- When a snippet or doc page doesn't make sense, bring it to the chat and ask
  for a line-by-line breakdown. Appendix A at the bottom of this file is an
  example of what that looks like — the ssh2 basics taken apart piece by piece.

A note on official docs: most of them are written as *reference* material for
people who already know the basics, not as tutorials. The workflow that works:
read the explanation here first, get a small example running, and only then
read the official page — at that point it will actually make sense. Reading
docs cold, before touching the thing, is how you ended up frustrated with
libraries in the first place.

---

## The big picture

A Termius-like app is three systems talking to each other:

```text
┌─────────────────────────────────────────────────────────┐
│                      YOUR APP (Electron)                 │
│                                                          │
│  ┌────────────────┐         ┌──────────────────────┐    │
│  │  UI (renderer)  │  IPC   │  Backend (main proc)  │    │        ┌──────────┐
│  │                 │ <====> │                       │    │  TCP   │  Remote  │
│  │ • terminal view │        │ • SSH connections     │ <=========> │  Server  │
│  │ • file browser  │        │ • SFTP transfers      │    │ (ssh2) │ (Linux)  │
│  │ • host list     │        │ • saved-hosts storage │    │        └──────────┘
│  └────────────────┘         └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

Three libraries do the heavy lifting. Here's what each one actually is,
stripped of mystique:

- **Electron** — a copy of Chrome and a copy of Node.js glued together, so a
  web page can be a desktop app. You could not write this yourself; it's
  millions of lines of C++. Docs: <https://www.electronjs.org/docs/latest>
- **xterm.js** — a canvas that draws a grid of characters and understands
  terminal escape codes. You could write a toy version of this (and in Phase 2
  we build enough of one to understand it). Docs: <https://xtermjs.org>
- **ssh2** — an implementation of the SSH network protocol: the encryption
  handshake, authentication, and channels. You should not write this yourself —
  it's cryptography, and hand-rolled crypto is how security holes are born.
  Docs: <https://github.com/mscdex/ssh2> (the README *is* the documentation;
  there is no docs website, which is why searching for one goes nowhere).

---

## Anatomy of an Electron app (worth reading twice)

The number one thing that confuses Electron beginners: an Electron app is not
one program. It is at least two programs running at the same time.

### 1. The main process (`src/main/`)

Plain Node.js, running on your machine like any script. It has full power:
network sockets, the filesystem, window creation. SSH lives here, because SSH
needs raw TCP connections and browser pages aren't allowed to open those.
There is exactly one main process.

### 2. The renderer process (`src/renderer/`)

A Chrome tab. It displays your HTML/CSS/JS — it *is* the UI. It's sandboxed:
it cannot read files or open network sockets directly. That's a feature: a bug
in UI code can't touch the disk. One renderer per window.

### 3. The preload script (`src/preload/`)

A small bridge that runs inside the renderer but with one extra power: it can
talk to the main process. It exposes a short, hand-picked list of functions to
the UI (in our app: `window.api`). The UI can call those functions and nothing
else.

### How they talk: IPC (inter-process communication)

```text
renderer                 preload                    main
--------                 -------                    ----
window.api.ping()  --->  ipcRenderer.invoke  --->  ipcMain.handle('ping', ...)
     ^                                                    |
     └------------------ Promise resolves <---------------┘
```

A useful mental model: the renderer is a restaurant customer (orders off the
menu only), the preload is the waiter, main is the kitchen (knives and fire).
The customer never walks into the kitchen.

Every feature in this project follows this exact pattern. Terminal keystrokes,
SFTP transfers, saved hosts — each is just a new item on the menu.

Docs for this section:

- Process model: <https://www.electronjs.org/docs/latest/tutorial/process-model>
- IPC: <https://www.electronjs.org/docs/latest/tutorial/ipc>
- contextBridge: <https://www.electronjs.org/docs/latest/api/context-bridge>

---

## Phase 0 — The backbone (built; your job is to understand it)

**Goal:** a running Electron window with a working IPC round-trip, in a folder
structure that scales to the finished app. This phase was built for you so the
foundation is correct and secure. Your job is to read every file until nothing
in it is mysterious.

**What you'll learn:** the main/preload/renderer split, IPC, where
`console.log` output goes depending on which process you're in, DevTools.

**Steps:**

1. Run `npm start`. Click "Test the bridge (ping)" and watch the reply appear.
2. Read the files in this order — the comments in them explain every line:
   1. `package.json` — project name, the `start` script, dependency list
   2. `src/main/main.js` — creates the window, answers the ping
   3. `src/preload/preload.js` — exposes `window.api` to the UI
   4. `src/renderer/index.html` — UI structure
   5. `src/renderer/styles.css` — UI appearance
   6. `src/renderer/renderer.js` — UI behavior (the button click)
3. Open DevTools inside the app window (Cmd+Option+I). Find the log line from
   `renderer.js` in the Console tab. Then look at the terminal where you ran
   `npm start` and find the log line from `main.js`. Two different places —
   because two different programs printed them.
4. Break it on purpose (the fastest way to learn how something fits together):
   - In `main.js`, rename the channel `'ping'` to `'pong'` and click the
     button. Watch what fails and where the error appears. Explain why. Undo.
   - In `preload.js`, comment out the `contextBridge.exposeInMainWorld` call.
     What is `window.api` now? Undo.
   - In `index.html`, move the `<script>` tag from the bottom into `<head>`.
     Why does the button stop working? Undo.

**Done when:** you can draw the main/preload/renderer diagram from memory and
narrate, out loud, the full journey of one button click.

**Traps:**

- "Why not just `require('ssh2')` in the renderer and skip all this?" Because
  the renderer is a browser tab and we deliberately locked it down
  (`nodeIntegration: false`). Plenty of older tutorials flip that switch on.
  Those tutorials teach you to build insecure apps; ours does it the way
  Electron's own security guidelines say to.

**Docs:**

- Electron tutorial: <https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites>
- Security checklist (why our webPreferences look like they do):
  <https://www.electronjs.org/docs/latest/tutorial/security>

---

## Phase 1 — JavaScript bootcamp (inside the project, not in the abstract)

**Goal:** the JS foundation that makes every later phase readable. No SSH yet;
the practice happens on the app itself, so nothing is throwaway.

**What you'll learn:** this phase *is* the learning. It's split into seven
mini-missions. For each one, say "let's do mission 1.X" in the chat and it
gets set up as an exercise — you write the code, the chat guides and reviews.

| #   | Mission | Concepts unlocked |
|-----|---------|-------------------|
| 1.1 | A "connection status" text that changes when you click buttons | `let`/`const`, strings, `querySelector`, `textContent` |
| 1.2 | Render a fake host list into the sidebar from an array | arrays, objects, `for...of`, template literals |
| 1.3 | Add and remove hosts from that list | functions, `push`/`filter`/`map`, re-rendering |
| 1.4 | A fake "connect" that takes two seconds | callbacks, then Promises, then `async`/`await` |
| 1.5 | Show how long a ping round-trip took | `Date.now()`, `async`/`await` over real IPC |
| 1.6 | Split renderer.js into modules | `import`/`export`, why files stay small |
| 1.7 | Persist the host list across restarts | JSON, IPC to main, writing files with `fs` |

Mission 1.4 matters more than the rest combined. Nearly everything in this app
is asynchronous — SSH replies arrive later, transfers finish later. JS
expresses "later" with Promises, and `async`/`await` is a cleaner syntax for
using them. If 1.4 truly lands, Phases 3–6 stop being scary.

**Done when:** all seven missions work and you wrote them yourself.

**Traps:**

- Don't rush this to get to the SSH part. Phase 3 assumes `async`/`await` is
  comfortable. Time saved here is repaid with interest later, at a bad rate.

**Docs:**

- MDN JavaScript guide (the reference you'll use for years):
  <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide>
- The Modern JavaScript Tutorial (best long-form beginner text on the
  internet, free): <https://javascript.info>
- Async specifically: <https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Async_JS>

---

## Phase 2 — The terminal emulator UI (xterm.js)

**Goal:** a real terminal look and feel inside the app — cursor, text,
keystrokes — connected to nothing yet. We fake the other end locally.

**What xterm.js actually is, before touching it:** a terminal is one loop —

1. you press a key, and the key is sent somewhere (normally to a shell);
2. bytes come back, and they get drawn on screen.

The hard part is step 2: the incoming bytes contain invisible escape codes
like `\x1b[31m` ("make the following text red") or `\x1b[2J` ("clear the
screen"). xterm.js is a parser and renderer for those codes. The whole
library is: bytes in, colored character grid out; keys pressed, bytes out.
Two functions cover 95% of usage:

- `term.write(bytes)` — draw this incoming data
- `term.onData(callback)` — call me when the user types

**Steps:**

1. `npm install @xterm/xterm @xterm/addon-fit`. Then actually open
   `node_modules/@xterm/xterm/` and look around — it's JS files someone wrote,
   not magic. (The fit addon resizes the terminal to fill its container;
   you'll need it immediately.)
2. Create `src/renderer/terminal.js`. Make a terminal render in the main pane
   and focus it.
3. Build a local echo loop: in `term.onData`, call `term.write` with whatever
   arrived. Type and watch it appear.
4. Discover why raw echo isn't enough: press Enter (nothing moves down — you
   need to write `\r\n`), press Backspace (a weird character appears — you
   need to handle `\x7f`). Handle both by hand. This pain is the point: you
   are now feeling exactly the problems real terminals solve.
5. In DevTools, run `term.write('\x1b[31mhello\x1b[0m')`. Red text. Escape
   codes are now demystified — they're just in-band formatting commands.

**What you'll learn:** event-driven code in practice, callbacks for real,
character codes, the difference between "a string" and "bytes".

**Done when:** typing works, Enter starts a new line, Backspace erases, and
you can explain to someone what an escape code is.

**Docs:**

- xterm.js: <https://xtermjs.org> (API: <https://xtermjs.org/docs/>)
- The repo, incl. addons: <https://github.com/xtermjs/xterm.js>

---

## Phase 3 — Real SSH (ssh2)

**Goal:** a command typed in your app runs on a real remote server. The
milestone moment of the whole project.

**What ssh2 actually is, before touching it:** SSH is a network protocol —
a precise rulebook for two computers to talk with encryption:

1. **Handshake** — both sides agree on encryption math; the server proves
   it is who it claims to be.
2. **Auth** — you prove you're allowed in (password or key).
3. **Channels** — an encrypted pipe opens. A "shell" channel carries your
   keystrokes one way and terminal output the other.

The ssh2 library implements that rulebook in JS. The shape you'll use:

```js
conn.connect({ host, username, password })   // dial + handshake + auth
conn.shell((err, stream) => { ... })         // open the shell channel
stream.write('ls\n')                         // keystrokes → server
stream.on('data', (bytes) => { ... })        // server output → you
```

If any part of those four lines is unclear — what `conn` is, why there's a
function inside the parentheses, what `{ host, username, password }` means
with no values — **read Appendix A at the bottom of this file first.** It
takes these exact lines apart character by character, assuming zero prior
knowledge. Then the steps below will feel very different.

That `stream` object is a Node.js *stream* — the single most important Node
concept, and this phase is where it clicks: data that arrives in chunks over
time rather than all at once. Files, network sockets, almost everything in
Node is a stream.

**Steps:**

1. Get a server to practice on (any of these works; ask in chat to pick):
   - a small cloud VM (Hetzner/Oracle/AWS free tiers exist),
   - a local Linux VM on the Mac (UTM is free),
   - or enable Remote Login in macOS settings and `ssh localhost` into your
     own machine — zero setup, good enough for all of Phases 3–6.
2. `npm install ssh2`. Note where it's allowed to be used: only in the main
   process. The renderer can't open sockets — this is why the Phase 0
   architecture exists.
3. Create `src/main/ssh.js`. Write a `connect(config)` function. First
   milestone is deliberately unglamorous: connect, run `ls`, and
   `console.log` the output into the npm-start terminal. No UI involved.
4. Add the IPC plumbing: `ssh:connect` and `ssh:write` going renderer → main
   (via `ipcMain.handle`), and `ssh:data` going main → renderer. That last
   one is a new direction — main pushing to the UI without being asked —
   and uses `webContents.send` plus `ipcRenderer.on` in the preload.
5. Handle failure properly from day one: wrong password, unknown host,
   server offline, network drop. Each should surface as a readable message
   in the UI, not a crash or a silent nothing. (Listen for the `'error'` and
   `'close'` events on the connection.)

**What you'll learn:** Node streams, event emitters (`.on`), error-first
callbacks, `try`/`catch` with async code, Buffers (how JS holds raw bytes).

**Done when:** `ls` typed on your side executes on the remote server and the
output prints on yours.

**Traps:**

- Passwords never go in source code, even in a toy, even for a minute. The
  habit starts now; Phase 8 gives them a proper home (the OS keychain).
- The ssh2 README is dense and assumes Node fluency. Use Appendix A, get a
  working example, and only then read the README's "Client examples" section
  — in that order.

**Docs:**

- ssh2 README (the only official docs):
  <https://github.com/mscdex/ssh2#client-examples>
- Node streams: <https://nodejs.org/api/stream.html>
- Node Buffer (raw bytes): <https://nodejs.org/api/buffer.html>
- Electron `webContents.send`:
  <https://www.electronjs.org/docs/latest/api/web-contents#contentssendchannel-args>

---

## Phase 4 — Wiring terminal to SSH

**Goal:** xterm.js and ssh2 connected end to end. A full interactive shell —
`htop`, `vim`, tab-completion, colors — inside your own app.

The entire phase is one idea, two pipes:

```text
term.onData ──(IPC)──▶ stream.write        (your keys → server)
stream.on('data') ──(IPC)──▶ term.write    (server output → your screen)
```

**Steps:**

1. Connect the two pipes through the preload bridge you built in Phase 3.
   First full-circle test: type `ls`, see real output rendered by xterm.
2. Request a proper interactive shell: pass a pseudo-terminal config to
   `conn.shell({ term: 'xterm-256color', cols, rows }, callback)` so the
   server knows it's talking to a real terminal and sends colors.
3. Handle resize. When the window changes size, the server must be told the
   new dimensions or full-screen programs like `vim` render garbage. Chain:
   window resize → fit addon recalculates → `term.onResize` fires →
   IPC → `stream.setWindow(rows, cols)`.
4. Replace the hardcoded connection config with a connect form in the UI
   (host, port, username, password).
5. Handle disconnects: when the server closes the connection, show a clear
   "disconnected" state in the UI instead of a frozen terminal.

**Done when:** you can run `htop` in your app, resize the window, and the
display reflows correctly. Take a screenshot — this is the milestone.

**Docs:**

- ssh2 shell options (search "shell(" in the README):
  <https://github.com/mscdex/ssh2>
- xterm.js fit addon:
  <https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit>

---

## Phase 5 — Sessions, tabs, and saved hosts

**Goal:** several simultaneous connections in tabs, plus a persistent host
list in the sidebar. This is the core of Termius's UX.

**Steps:**

1. Refactor around a `Session` concept: one object per live connection that
   owns its SSH stream and its terminal instance. This is your first real
   exercise in designing an abstraction — deciding what a "thing" is in your
   program and what it's responsible for.
2. Build a tab bar: create, switch, close. Closing a tab must fully clean up
   its session — kill the connection, dispose the terminal, remove listeners.
3. Saved hosts in the sidebar: add, edit, delete, click to connect.
4. Persist hosts to a JSON file. The file lives in Electron's per-app data
   folder (`app.getPath('userData')`), written by the main process, accessed
   from the UI via new IPC endpoints (`hosts:list`, `hosts:save`, ...).
5. Store host, port, and username only — not passwords. Prompt for the
   password on connect. Secure password storage needs the OS keychain and
   that's Phase 8.

**What you'll learn:** classes, `Map`, designing state ("what is the single
source of truth for the list of sessions?"), lifecycle and cleanup — your
first hunt for a leak (close a tab, check the connection actually died).

**Done when:** three tabs connected at once to real servers, and saved hosts
still there after quitting and reopening the app.

**Traps:**

- This is the phase where hand-rolled UI code starts to genuinely hurt:
  every state change (session opened, closed, renamed) must be manually
  reflected in the DOM in several places, and you'll forget one. The pain is
  intentional — it's the precise problem React exists to solve, and feeling
  it firsthand is what will make React obvious instead of confusing in
  Phase 7. When you notice the pain, write down where it hurts.

**Docs:**

- Classes: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes>
- `Map`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map>
- `app.getPath`: <https://www.electronjs.org/docs/latest/api/app#appgetpathname>

---

## Phase 6 — SFTP file browser

**Goal:** browse the remote filesystem in a panel; upload and download with
progress bars.

**Before touching it:** SFTP is not a new library and not a new connection.
It's another channel type on the ssh2 connection you already have. Instead of
`conn.shell()` you call `conn.sftp()` and get back an object with file
methods: `readdir` (list a directory), `fastGet` (download), `fastPut`
(upload), `rename`, `unlink`, and friends.

**Steps:**

1. `sftp.readdir(path)` → render a file panel: names, sizes, modified dates,
   folder-vs-file icons. Write a `formatSize` helper (1536 → "1.5 KB") — a
   classic tiny function you'll keep forever.
2. Navigation: click a folder to enter it, breadcrumbs for the current path,
   a ".." entry to go up. Decide how you represent "current path" in state.
3. Download: pick a file, choose a local destination (Electron's
   `dialog.showSaveDialog`), run `fastGet` with its progress callback wired
   to a progress bar.
4. Upload: drag a file from Finder onto the panel. HTML drag-and-drop events
   (`dragover`, `drop`) give you the local path; `fastPut` sends it.
5. A transfer queue: multiple transfers at once, each row with name, speed,
   progress, and a cancel button.

**What you'll learn:** recursion (directory trees), sorting and formatting
data for display, drag-and-drop events, building a queue.

**Done when:** you can navigate the remote machine, drag a file up, download
one back, and watch both progress bars move.

**Docs:**

- ssh2's SFTP API (a separate file in the same repo — easy to miss):
  <https://github.com/mscdex/ssh2/blob/master/SFTP.md>
- Electron dialogs: <https://www.electronjs.org/docs/latest/api/dialog>
- Drag and drop: <https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API>

---

## Phase 7 — The React migration

> **Update (July 2026):** this migration happened early — the renderer is
> already React + Vite + Tailwind + shadcn/ui (see `src/renderer/`). The
> lessons below still apply; read this phase as "understand what's now in
> place" rather than "build it". Phases 1–6 proceed as written, just writing
> React components instead of hand-rolled DOM updates.

**Goal:** rebuild the renderer in React, now that you've personally hit every
problem React solves.

Why last and not first: React only makes sense as an answer to a question,
and Phases 5–6 force you to ask it — "why am I updating the DOM by hand in
fourteen places every time my state changes?" React's answer: you stop
touching the DOM. You write functions that describe what the UI should look
like for a given state, and React keeps the DOM in sync. `UI = f(state)`.

**Steps:**

1. Learn the core four on a small playground first, away from this codebase:
   components, props, state (`useState`), effects (`useEffect`). One or two
   sessions in chat.
2. Add Vite. This is the project's first build tool, introduced at the first
   moment we actually need one (React's JSX syntax isn't valid JS and must be
   translated). A bundler, demystified, does two jobs: combine many source
   files into few, and translate syntax browsers don't speak into syntax they
   do.
3. Migrate one component at a time, keeping the app working throughout:
   sidebar → tab bar → connect form → file panel. The terminal stays as
   xterm.js wrapped inside one React component (a real-world pattern:
   integrating a non-React library via a ref).
4. Note what does *not* change: main process, preload, all the IPC. React
   replaces only the renderer. This is the payoff of the Phase 0
   architecture — the UI layer was swappable all along.

**Done when:** feature parity with Phase 6, renderer in React, and adding a
new panel no longer involves manual DOM bookkeeping.

**Docs:**

- React (official, excellent, start-to-finish): <https://react.dev/learn>
- Vite: <https://vite.dev/guide/>

---

## Phase 8 — Polish and ship

**Goal:** the distance between "my project" and "an app someone could use."

**Steps** (order by whatever excites you):

1. Secure password storage with Electron's `safeStorage`, which encrypts via
   the macOS Keychain. Saved hosts can now optionally remember passwords,
   done properly.
2. SSH key authentication — connect with `~/.ssh/id_ed25519` instead of a
   password. This is how SSH is actually used day to day; ssh2 takes a
   `privateKey` in the connect config.
3. Settings: font size, color themes (your CSS variables from Phase 0 become
   a theme system), default shell.
4. Quality of life: reconnect button, latency indicator, Cmd+T for a new
   tab, Cmd+K quick-connect search.
5. Package it with electron-builder into a signed `.app` with an icon.
   Install it in /Applications. Send it to a friend.

**Done when:** you use your app instead of Termius for a week without
switching back.

**Docs:**

- `safeStorage`: <https://www.electronjs.org/docs/latest/api/safe-storage>
- electron-builder: <https://www.electron.build>

---

## The library survival guide

The original complaint this project exists to fix: "when you use libraries it
becomes impossible to understand." The system for never feeling that again:

1. **A library is just files.** Open `node_modules/<name>/` and look. It's JS
   someone wrote. You can read it, `console.log` inside it, even edit your
   local copy to see what breaks.
2. **Learn the shape, not the whole thing.** Every decent library has a small
   core API — xterm is `write` + `onData`; ssh2 is `connect` + `shell` + the
   stream. Learn the core; ignore the other 90% until a task needs it.
3. **Ask "what would this look like without the library?"** If you can sketch
   a crappy 20-line version of what it does, it stops being magic. We do this
   exercise for every library before adopting it (each phase's "what it
   actually is" section).
4. **Docs after a working example, not before.** Reference docs are a
   dictionary, not a textbook. Get something running, then read the docs to
   deepen — never the reverse.

---

## Official documentation — the complete list

Bookmark these; they're every external source this project needs.

**The language and platform:**

| What | Where | Notes |
|------|-------|-------|
| JavaScript reference | <https://developer.mozilla.org/en-US/docs/Web/JavaScript> | MDN. The canonical reference for JS, HTML, CSS, DOM |
| JavaScript tutorial | <https://javascript.info> | Best long-form beginner course; free |
| Node.js API | <https://nodejs.org/api/> | For main-process code: `fs`, `path`, streams, Buffer |

**The three core libraries:**

| What | Where | Notes |
|------|-------|-------|
| Electron | <https://www.electronjs.org/docs/latest> | Tutorials + API reference; genuinely good |
| xterm.js | <https://xtermjs.org> | API docs + demo; repo: <https://github.com/xtermjs/xterm.js> |
| ssh2 | <https://github.com/mscdex/ssh2> | README is the docs. SFTP API is separate: <https://github.com/mscdex/ssh2/blob/master/SFTP.md> |

**Later phases:**

| What | Where | Notes |
|------|-------|-------|
| React | <https://react.dev> | Phase 7. The Learn section is a full course |
| Vite | <https://vite.dev> | Phase 7. Build tool |
| electron-builder | <https://www.electron.build> | Phase 8. Packaging |

---

## Glossary

| Term | Meaning |
|------|---------|
| process | a running program; Electron apps run several at once |
| IPC | inter-process communication — how main and renderer talk |
| Promise | a JS object representing a value that will exist later |
| async/await | syntax for writing Promise-based code top to bottom |
| callback | a function you hand over to be called later |
| error-first | Node convention: a callback's first argument is the error (empty if all is well) |
| event / `.on()` | "when X happens, run this function" |
| stream | data arriving in chunks over time (network, files) |
| chunk | one piece of arriving stream data |
| Buffer | Node's container for raw bytes (as opposed to text) |
| escape code | invisible byte sequences controlling terminal color/cursor |
| channel | one pipe inside an SSH connection (shell, sftp, ...) |
| object | a container of named values (`{ key: value }`) |
| method | a function stored inside an object (`conn.connect`) |
| class | a blueprint for building objects (`Client`) |
| `new` | "build one from the blueprint" |
| destructuring | `const { Client } = box` — pulling a named thing out of an object |
| shorthand property | `{ host }` is short for `{ host: host }` |
| DOM | the live tree of HTML elements that JS can read and change |
| bundler | a tool that combines source files and translates new syntax for browsers (Vite) |

---

## Appendix A — ssh2, line by line, assuming nothing

The four lines from Phase 3, taken apart completely. Every concept here is
general JavaScript — you'll reuse all of it far beyond ssh2.

```js
conn.connect({ host, username, password })
conn.shell((err, stream) => { ... })
```

### A.0 Where `conn` comes from

The snippet above starts mid-story. The missing beginning:

```js
const { Client } = require('ssh2');
const conn = new Client();
```

Line 1: `require('ssh2')` tells Node "find the ssh2 library in node_modules,
run it, and hand me the box of things it offers." That box is an object, and
one thing inside it is named `Client`. The curly braces are *destructuring* —
"reach into the box and pull out just the thing named Client." It's identical
to writing:

```js
const ssh2Box = require('ssh2');
const Client = ssh2Box.Client;
```

Line 2: `Client` is a *class* — a blueprint, like a cookie cutter. It isn't a
connection; it's the instructions for building one. The keyword `new` means
"build me one from this blueprint." Out comes an object — a little machine
that knows how to do SSH — and we name it `conn`. (The name is our choice;
`bob` would work the same.)

So `conn` is a machine sitting in memory, connected to nothing. A phone that
hasn't dialed.

### A.1 `conn.connect({ host, username, password })`

Three chunks: `conn.connect`, the parentheses, the thing inside them.

**`conn.connect`** — the dot means "look inside the object on my left for the
thing named on my right." So: inside the conn machine, find the thing called
`connect`. That thing is a function. A function stored inside an object is
called a *method* — same thing, fancier word.

**The parentheses `()`** — after a function's name, parentheses mean "run it,
now." Whatever sits between them is handed to the function as input.

**`{ host, username, password }`** — the part that trips everyone. This is one
single thing being handed over: an object, built on the spot. The honest,
longhand way to build one is key–value pairs, like a filled-out form:

```js
conn.connect({
  host: '192.168.64.3',   // server address
  username: 'demo',       // who is logging in
  password: 'secret123',  // proof
});
```

So what's the version with no colons? A shorthand. JS has a rule: if the
value you're storing lives in a variable with the same name as the key, you
may write the name once instead of twice. These are identical:

```js
const host = '192.168.64.3';
const username = 'demo';
const password = 'secret123';

conn.connect({ host: host, username: username, password: password }); // longhand
conn.connect({ host, username, password });                           // shorthand
```

`{ host }` literally means `{ host: host }`. That's the whole trick.

**What connect does when it runs** — a careful phone call:

1. Dial: open a network connection to the server.
2. Handshake: the two computers agree on encryption math so nobody in between
   can read the traffic, and the server shows ID proving you dialed the real
   one, not an impostor.
3. Auth: prove you're allowed in — "I'm demo, password secret123."

One crucial fact: this line does not finish instantly. It *starts* the call
and returns immediately; the dialing happens in the background. You learn the
outcome by listening for events:

```js
conn.on('ready', () => { /* runs later, the moment login succeeds */ });
conn.on('error', (err) => { /* runs instead, if it fails */ });
```

`conn.on(eventName, fn)` means "when this event happens, run this function."

### A.2 `conn.shell((err, stream) => { ... })`

You can read the first half now: inside conn, find the method named `shell`,
run it. It asks the server: "start a shell for me and give me a pipe to it."
A *shell* is the program on the server that reads typed commands and executes
them — the thing that answers when you type `ls` and press Enter.

The strange part is what we're handing it: `(err, stream) => { ... }` is a
**function**. In JS, functions are values — you can store them in variables,
put them in objects, and pass them into other functions, exactly like numbers
or strings.

Why does `shell` want a function from us? Because opening a shell takes time
(the request crosses the internet), so `shell` can't hand back the result
immediately. The deal is: "here's a function — call me back when you're
done." That's why it's called a *callback*. It is the most common pattern in
all of Node.

Reading the callback itself — the `=>` arrow means "this is a function":

```text
( what I'll be handed )  =>  { what I'll do with it }
```

`(err, stream)` says: when ssh2 calls me back it will hand me two things, and
I'm choosing to name them `err` and `stream`. The names are yours to pick —
`(banana, potato)` works identically. Position is what matters, not names.

What arrives in the two slots:

- **`err`** — did something go wrong? If everything is fine, it's empty
  (`undefined`). If not, it's an object describing the failure. Node
  tradition puts the error in the first slot of every callback ("error-first"),
  and the tradition comes with a duty — the first line inside is almost
  always `if (err) { handle it and stop }`.
- **`stream`** — the prize: the open pipe to the shell. Picture two tubes
  running to the server. One you speak into: `stream.write('ls\n')` sends
  those characters as if you typed them (`\n` is the Enter key written as
  text). One you hold to your ear: `stream.on('data', (chunk) => {...})`
  runs your function every time bytes arrive from the server. Output comes
  in *chunks*, whenever the network delivers them — that's what "stream"
  means: data that trickles in over time.

### A.3 The whole story, glued together

```js
const { Client } = require('ssh2');  // pull the blueprint out of the library
const conn = new Client();           // build one machine; name it conn

// Listeners are set up FIRST but fire LATER:
conn.on('ready', () => {
  console.log('logged in');

  conn.shell((err, stream) => {      // ask for a shell; leave a callback
    if (err) {
      console.log('shell failed:', err.message);
      return;                        // no stream to use — stop here
    }

    stream.on('data', (chunk) => {   // ear tube: print whatever arrives
      console.log('SERVER:', chunk.toString());
    });

    stream.write('ls\n');            // mouth tube: "type" ls and press Enter
  });
});

conn.on('error', (err) => {          // bad password, no route, refused...
  console.log('connection failed:', err.message);
});

// Only now does anything actually happen:
conn.connect({
  host: '192.168.64.3',
  port: 22,                          // SSH's standard port
  username: 'demo',
  password: 'secret123',
});
```

The part that bends everyone's brain at first: the code **runs** bottom-up.
`conn.connect(...)` at the bottom executes first; seconds later the `'ready'`
function near the top fires; then the shell callback; then the `'data'`
function fires again and again, every time output arrives. Reading order is
not running order. The top of the file *installs* "when X happens, do Y"
instructions; the bottom pulls the trigger.

This pattern is called event-driven programming, and you've been using it
since Phase 0: `pingButton.addEventListener('click', ...)` in renderer.js is
the same shape. `conn.on('ready', ...)` is addEventListener for a connection.

---

*Current status: Phase 0 complete (backbone built and running). Next: read
the Phase 0 files, do the break-it experiments, then say "let's start
phase 1".*

// ============================================================================
// main.js — THE MAIN PROCESS
// ============================================================================
// This file is the ENTRY POINT of the whole app. When you run `npm start`,
// Electron starts Node.js and runs THIS file first.
//
// The main process is "the kitchen": it has full power (files, network,
// windows). Later, our SSH and SFTP code will live on this side.
// ============================================================================

// ---------------------------------------------------------------------------
// IMPORTS
// ---------------------------------------------------------------------------
// `require(...)` is how Node.js loads code from other files or libraries.
// Here we load pieces of the 'electron' library.
//
// The curly braces `{ app, BrowserWindow, ipcMain }` are "destructuring":
// the electron module is one big object, and this syntax plucks out just the
// three properties we want and gives each its own variable name. It's the
// same as writing:
//   const electron = require('electron');
//   const app = electron.app;
//   const BrowserWindow = electron.BrowserWindow;  ...etc
const { app, BrowserWindow, ipcMain } = require('electron');

// `path` is a built-in Node module for building file paths safely.
// We use it instead of gluing strings together with '/' because it handles
// differences between operating systems (macOS/Linux use '/', Windows uses '\').
const path = require('path');

// ---------------------------------------------------------------------------
// WINDOW CREATION
// ---------------------------------------------------------------------------
// We define a function that creates our app's window. `function name() {}`
// declares a function — a reusable block of code we can call later by name.
function createWindow() {
  // `new BrowserWindow(...)` creates an actual desktop window.
  // The `new` keyword means "construct an object from this blueprint (class)".
  // The `{...}` we pass in is an OPTIONS OBJECT: a bundle of settings,
  // written as `key: value` pairs.
  const win = new BrowserWindow({
    width: 1100,           // window width in pixels
    height: 700,           // window height in pixels
    minWidth: 800,         // user can't shrink it smaller than this...
    minHeight: 500,        // ...because a terminal needs room to breathe

    // On macOS this hides the title bar but keeps the traffic-light buttons
    // (red/yellow/green), giving that sleek Termius look.
    titleBarStyle: 'hiddenInset',

    // Dark background from the very first frame, so the window doesn't
    // "flash white" while our CSS is still loading.
    backgroundColor: '#0d1117',

    webPreferences: {
      // THE SECURITY SETTINGS — the most important lines in this file.

      // preload: the path to our "bridge" script (see src/preload/preload.js).
      // `__dirname` is a Node variable that means "the folder THIS file is in"
      // (so: .../sshclient/src/main). path.join glues path pieces together,
      // and '..' means "go up one folder" — landing us at src/preload/preload.js.
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),

      // contextIsolation: the renderer (UI) and the preload script live in
      // SEPARATE JavaScript worlds. The UI can only see what the preload
      // explicitly shares. This is the modern, secure default. Keep it true.
      contextIsolation: true,

      // nodeIntegration: false means the UI can NOT use require(), fs, or any
      // Node powers directly. If our UI ever runs untrusted content (or just
      // has a bug), it can't touch the disk. All power flows through the
      // preload bridge, on OUR terms.
      nodeIntegration: false,
    },
  });

  // Tell the window what to display — the moment it loads, the RENDERER
  // process for this window is born. Since the React/Vite migration there
  // are two cases (process.argv is the list of command-line arguments):
  if (process.argv.includes('--dev')) {
    // `npm run dev` passes --dev and runs Vite's live server alongside us.
    // Loading from the server gives hot reload: edits appear instantly.
    win.loadURL('http://localhost:5173');
  } else {
    // `npm start` runs `vite build` first, which compiles the renderer
    // (JSX, Tailwind) into plain files in dist/renderer/. We load those.
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }
}

// ---------------------------------------------------------------------------
// IPC HANDLERS — "the menu" the renderer is allowed to order from
// ---------------------------------------------------------------------------
// ipcMain.handle(channelName, handlerFunction) registers a listener:
// "when a renderer invokes 'ping', run this function and send back whatever
// it returns."
//
// The `async (event, message) => { ... }` part is an ARROW FUNCTION — a
// compact way to write a function. `async` means it may contain `await` and
// always returns a Promise (a "value that arrives later"). More on that in
// Phase 1, mission 1.4!
//
// Parameters:
//   event   — info about who sent the message (we don't need it yet)
//   message — whatever the renderer passed along when calling ping()
ipcMain.handle('ping', async (event, message) => {
  // This log appears in the TERMINAL where you ran `npm start` — NOT in the
  // app window. Why? Because this code runs in the main process (Node),
  // which has no window of its own. First lesson in "which process am I in?"
  console.log('[main] got a ping from the UI, message:', message);

  // Whatever we return here travels back across IPC and becomes the resolved
  // value of the Promise in the renderer. We return an object with some info
  // only the MAIN process could know — proving the bridge really works.
  return {
    reply: `pong! main process received: "${message}"`,
    electronVersion: process.versions.electron, // version of Electron running us
    nodeVersion: process.versions.node,         // version of Node in this process
    chromeVersion: process.versions.chrome,     // version of Chrome rendering the UI
  };
});

// ---------------------------------------------------------------------------
// APP LIFECYCLE — reacting to the app starting and quitting
// ---------------------------------------------------------------------------
// Electron needs a moment to boot up before it can create windows.
// `app.whenReady()` returns a Promise that resolves when boot-up is done.
// `.then(createWindow)` says: "when that happens, run createWindow."
app.whenReady().then(() => {
  createWindow();

  // macOS-specific behavior: clicking the dock icon when the app is running
  // but has no windows should open a new window (that's the Mac convention).
  // `app.on(eventName, fn)` means "every time eventName happens, run fn".
  app.on('activate', () => {
    // BrowserWindow.getAllWindows() returns an array of open windows.
    // `.length === 0` asks: is that array empty?
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// When all windows are closed: on Windows/Linux the app should quit.
// On macOS apps traditionally stay alive in the dock (so we do nothing).
// `process.platform` is 'darwin' on macOS. `!==` means "not equal".
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

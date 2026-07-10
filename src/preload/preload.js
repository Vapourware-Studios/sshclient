// ============================================================================
// preload.js — THE BRIDGE (a.k.a. "the waiter")
// ============================================================================
// This script runs inside the renderer's window, BUT with one special power
// the UI itself doesn't have: it can talk to the main process via ipcRenderer.
//
// Its whole job: build a small "menu" of safe functions and hang it on the
// UI's `window` object as `window.api`. The UI can call those functions and
// NOTHING else. If a function isn't on this menu, the UI can't do it. That's
// the security model of our entire app.
//
// As we build the real app, this menu grows:
//   Phase 3:  api.sshConnect(config), api.sshWrite(data), api.onSshData(cb)
//   Phase 6:  api.sftpList(path), api.sftpDownload(remote, local), ...
// ============================================================================

// contextBridge — the official, safe tool for exposing things to the UI.
// ipcRenderer  — the renderer-side end of the IPC phone line to main.
const { contextBridge, ipcRenderer } = require('electron');

// exposeInMainWorld(name, object):
//   "in the UI's world, create a global variable called `name`,
//    containing this object."
// After this line runs, code in renderer.js can call `window.api.ping(...)`.
contextBridge.exposeInMainWorld('api', {
  // ping: our first menu item. It takes a message and forwards it to main.
  //
  // `(message) => ipcRenderer.invoke('ping', message)` is an arrow function
  // with no curly braces — a one-liner that automatically returns its result.
  //
  // ipcRenderer.invoke(channel, data):
  //   1. sends `data` to the main process on the channel named 'ping'
  //   2. main's ipcMain.handle('ping', ...) runs and returns something
  //   3. that something comes back here as a resolved Promise
  //
  // So from the UI's point of view: `await window.api.ping('hi')` just...
  // returns main's answer. All the plumbing is hidden behind this one line.

  ping: (message) => ipcRenderer.invoke('ping', message),

  log: (entry) => ipcRenderer.send("log", entry),
});

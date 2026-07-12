import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const ADAPTERS = {
  ssh: {
    write: 'sshWrite',
    resize: 'sshResize',
    attach: 'sshAttach',
    onData: 'onSshData',
    onClosed: 'onSshClosed',
    onError: 'onSshError',
  },
  local: {
    write: 'localWrite',
    resize: 'localResize',
    attach: 'localAttach',
    onData: 'onLocalData',
    onClosed: 'onLocalClosed',
    onError: 'onLocalError',
  },
  serial: {
    write: 'serialWrite',
    resize: null,
    attach: 'serialAttach',
    onData: 'onSerialData',
    onClosed: 'onSerialClosed',
    onError: 'onSerialError',
  },
};

export default function TerminalView({ sessionId, kind = 'ssh', active }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    const adapter = ADAPTERS[kind] ?? ADAPTERS.ssh;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      theme: { background: '#00000000' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const dataSub = term.onData((data) => {
      window.api[adapter.write](sessionId, data);
    });

    const resizeSub = term.onResize(({ cols, rows }) => {
      if (adapter.resize) window.api[adapter.resize](sessionId, cols, rows);
    });

    // Live chunks that arrive while the attach below is still in flight are
    // held back — the attach replays everything printed so far, so writing
    // live chunks first would show them out of order (or twice).
    let pendingLive = [];

    const unsubData = window.api[adapter.onData]((payload) => {
      if (payload.sessionId !== sessionId) return;
      if (pendingLive) pendingLive.push(payload);
      else term.write(payload.data);
    });

    // Everything printed before this terminal mounted (MOTD, first prompt)
    // is kept in the main process — fetch and replay it, then flush the
    // held-back live chunks. `lastSeq` marks where the replayed history
    // ends: chunks numbered at or below it are already on screen.
    let disposed = false;
    window.api[adapter.attach](sessionId).then((result) => {
      if (disposed) return;
      if (result?.backlog) term.write(result.backlog);
      for (const payload of pendingLive) {
        if (payload.seq > (result?.lastSeq ?? 0)) term.write(payload.data);
      }
      pendingLive = null;
    });

    const unsubClosed = window.api[adapter.onClosed]((payload) => {
      if (payload.sessionId === sessionId) {
        term.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n');
      }
    });

    const unsubError = window.api[adapter.onError]((payload) => {
      if (payload.sessionId === sessionId) {
        term.write(`\r\n\x1b[31m[error] ${payload.message}\x1b[0m\r\n`);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      dataSub.dispose();
      resizeSub.dispose();
      unsubData();
      unsubClosed();
      unsubError();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [sessionId, kind]);

  useEffect(() => {
    if (active) {
      fitAddonRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div
      className={`absolute inset-0 bg-background p-2 ${active ? '' : 'invisible pointer-events-none'}`}
      ref={containerRef}
    />
  );
}

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export default function TerminalView({ sessionId, active }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      theme: { background: '#0d1117' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const dataSub = term.onData((data) => {
      window.api.sshWrite(sessionId, data);
    });

    const resizeSub = term.onResize(({ cols, rows }) => {
      window.api.sshResize(sessionId, cols, rows);
    });

    // Live chunks that arrive while the attach below is still in flight are
    // held back — the attach replays everything printed so far, so writing
    // live chunks first would show them out of order (or twice).
    let pendingLive = [];

    const unsubData = window.api.onSshData((payload) => {
      if (payload.sessionId !== sessionId) return;
      if (pendingLive) pendingLive.push(payload);
      else term.write(payload.data);
    });

    // Everything printed before this terminal mounted (MOTD, first prompt)
    // is kept in the main process — fetch and replay it, then flush the
    // held-back live chunks. `lastSeq` marks where the replayed history
    // ends: chunks numbered at or below it are already on screen.
    let disposed = false;
    window.api.sshAttach(sessionId).then((result) => {
      if (disposed) return;
      if (result?.backlog) term.write(result.backlog);
      for (const payload of pendingLive) {
        if (payload.seq > (result?.lastSeq ?? 0)) term.write(payload.data);
      }
      pendingLive = null;
    });

    const unsubClosed = window.api.onSshClosed((payload) => {
      if (payload.sessionId === sessionId) {
        term.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n');
      }
    });

    const unsubError = window.api.onSshError((payload) => {
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
  }, [sessionId]);

  useEffect(() => {
    if (active) {
      fitAddonRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div
      className={`absolute inset-0 p-2 ${active ? '' : 'invisible pointer-events-none'}`}
      ref={containerRef}
    />
  );
}

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export default function LocalTerminalView({ sessionId, active }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
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

    const dims = fitAddon.proposeDimensions();
    if (dims) {
      window.api.localResize(sessionId, dims.cols, dims.rows);
    }

    const dataSub = term.onData((data) => {
      window.api.localWrite(sessionId, data);
    });

    const resizeSub = term.onResize(({ cols, rows }) => {
      window.api.localResize(sessionId, cols, rows);
    });

    const unsubData = window.api.onLocalData((payload) => {
      if (payload.sessionId === sessionId) term.write(payload.data);
    });

    const unsubClosed = window.api.onLocalClosed((payload) => {
      if (payload.sessionId === sessionId) {
        term.write(`\r\n\x1b[31m[process exited with code ${payload.exitCode}]\x1b[0m\r\n`);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      dataSub.dispose();
      resizeSub.dispose();
      unsubData();
      unsubClosed();
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
      className={`absolute inset-0 bg-background p-2 ${active ? '' : 'invisible pointer-events-none'}`}
      ref={containerRef}
    />
  );
}

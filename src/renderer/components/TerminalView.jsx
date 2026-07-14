import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Slider } from '@/components/ui/slider';
import { useTheme } from '@/lib/theme-settings.jsx';
import { Pause, Play } from 'lucide-react';

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

function formatTime(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function TerminalView({ sessionId, kind = 'ssh', active, recording }) {
  const { terminalTheme } = useTheme();
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;
  const fitAddonRef = useRef(null);
  const seekRef = useRef(null);
  const positionRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  const duration = recording?.duration ?? 0;

  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      cursorBlink: kind !== 'playback',
      disableStdin: kind === 'playback',
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      theme: terminalThemeRef.current,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return true;
      const key = e.key.toLowerCase();
      if (key === 'c' && term.hasSelection()) {
        e.preventDefault();
        navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (key === 'v') {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        });
        return false;
      }
      return true;
    });

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    if (kind === 'playback') {
      const frames = recording?.frames ?? [];
      let writtenCount = 0;

      const seekTo = (ms) => {
        const clamped = Math.max(0, Math.min(ms, duration));
        const targetCount = frames.filter((f) => f.at <= clamped).length;
        if (targetCount < writtenCount) {
          term.reset();
          term.write(frames.slice(0, targetCount).map((f) => f.data).join(''));
        } else if (targetCount > writtenCount) {
          term.write(frames.slice(writtenCount, targetCount).map((f) => f.data).join(''));
        }
        writtenCount = targetCount;
        positionRef.current = clamped;
        setPosition(clamped);
      };

      seekRef.current = seekTo;
      positionRef.current = 0;
      setPosition(0);
      setPlaying(true);

      return () => {
        seekRef.current = null;
        resizeObserver.disconnect();
        term.dispose();
      };
    }

    const adapter = ADAPTERS[kind] ?? ADAPTERS.ssh;

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
  }, [sessionId, kind, recording]);

  useEffect(() => {
    if (kind !== 'playback' || !playing) return;

    let raf;
    let last = performance.now();
    const tick = (now) => {
      const delta = now - last;
      last = now;
      const next = positionRef.current + delta;
      if (next >= duration) {
        seekRef.current?.(duration);
        setPlaying(false);
        return;
      }
      seekRef.current?.(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [kind, playing, duration]);

  // Restyle live terminals when the theme template changes — no re-mount,
  // so scrollback and the running session are untouched.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme;
  }, [terminalTheme]);

  useEffect(() => {
    if (active) {
      fitAddonRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div
      className={`absolute inset-0 flex flex-col bg-background ${active ? '' : 'invisible pointer-events-none'}`}
    >
      <div className="min-h-0 flex-1 p-2" ref={containerRef} />

      {kind === 'playback' && (
        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            title={playing ? 'Pause' : 'Play'}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
            {formatTime(position)}
          </span>
          <Slider
            className="flex-1"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={[position]}
            onValueChange={([value]) => {
              setPlaying(false);
              seekRef.current?.(value);
            }}
          />
          <span className="w-10 shrink-0 text-xs text-muted-foreground">{formatTime(duration)}</span>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Slider } from '@/components/ui/slider';
import { useTheme } from '@/lib/theme-settings.jsx';
import { memberColorHex, useCursorSlot } from '@/lib/sharing.jsx';
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
  // Watching somebody else's terminal. Keystrokes take the long way round —
  // relay, owner, terminal — and are dropped unless we hold the keyboard, so
  // there is no resize: the owner's terminal is the one that has a size.
  shared: {
    write: 'shareInput',
    resize: null,
    attach: 'shareAttach',
    onData: 'onShareData',
    onClosed: 'onShareClosed',
    onError: null,
  },
};

const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 40;

/**
 * Sizes the font so an owner's cols x rows grid fills the room this window
 * has. Their terminal keeps its dimensions — a viewer on a laptop must not
 * squash the shell somebody else is working in — so the only thing that gives
 * is how big the text is here.
 *
 * How many columns fit is inversely proportional to the font size, so the
 * addon's proposal at the current size says directly how far off we are. Two
 * passes settle the rounding.
 */
function fitFontToGrid(term, fitAddon, grid) {
  if (!grid?.cols || !grid?.rows) return;

  for (let pass = 0; pass < 2; pass += 1) {
    const proposed = fitAddon.proposeDimensions();
    if (!proposed?.cols || !proposed?.rows) return;

    const scale = Math.min(proposed.cols / grid.cols, proposed.rows / grid.rows);
    const next = Math.max(
      MIN_FONT_SIZE,
      Math.min(MAX_FONT_SIZE, Math.floor(term.options.fontSize * scale))
    );
    if (next === term.options.fontSize) break;
    term.options.fontSize = next;
  }

  if (term.cols !== grid.cols || term.rows !== grid.rows) term.resize(grid.cols, grid.rows);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function TerminalView({ sessionId, kind = 'ssh', active, recording }) {
  const { terminalTheme, activeTheme } = useTheme();
  const cursorSlot = useCursorSlot(sessionId);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;
  const fitAddonRef = useRef(null);
  const refitRef = useRef(null);
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
      fontSize: 14,
      fontFamily: 'Consolas, ui-monospace, Menlo, monospace',
      fontWeight: 'normal',
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

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    if (kind === 'playback') {
      refitRef.current = () => fitAddon.fit();
      fitAddon.fit();
      const resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(containerRef.current);

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
        refitRef.current = null;
        seekRef.current = null;
        resizeObserver.disconnect();
        term.dispose();
      };
    }

    const adapter = ADAPTERS[kind] ?? ADAPTERS.ssh;
    const watching = kind === 'shared';

    // A viewer types only while it holds the keyboard. The relay and the
    // owner both enforce this too; blocking here just avoids the pantomime of
    // keystrokes that go nowhere.
    let canType = false;
    term.options.disableStdin = watching;

    const dataSub = term.onData((data) => {
      if (watching && !canType) return;
      window.api[adapter.write](sessionId, data);
    });

    const resizeSub = term.onResize(({ cols, rows }) => {
      if (adapter.resize) window.api[adapter.resize](sessionId, cols, rows);
    });

    // The owner's grid is authoritative. Rather than resize their terminal to
    // suit us, scale the font so their cols x rows fills whatever room this
    // window has — every viewer gets a right-sized view, nobody squashes the
    // shell being shared.
    let grid = null;
    const refit = () => {
      if (watching && grid) fitFontToGrid(term, fitAddon, grid);
      else fitAddon.fit();
    };
    refitRef.current = refit;
    refit();
    const resizeObserver = new ResizeObserver(refit);
    resizeObserver.observe(containerRef.current);

    let pendingLive = [];

    const unsubData = window.api[adapter.onData]((payload) => {
      if (payload.sessionId !== sessionId) return;
      if (pendingLive) pendingLive.push(payload);
      else term.write(payload.data);
    });

    let disposed = false;
    window.api[adapter.attach](sessionId).then((result) => {
      if (disposed) return;
      if (result?.backlog) term.write(result.backlog);
      for (const payload of pendingLive) {
        if (payload.seq > (result?.lastSeq ?? 0)) term.write(payload.data);
      }
      pendingLive = null;
      if (watching) {
        canType = Boolean(result?.canType);
        term.options.disableStdin = !canType;
        if (result?.size) {
          grid = result.size;
          refit();
        }
      }
    });

    const unsubSize = watching
      ? window.api.onShareSize((payload) => {
          if (payload.sessionId !== sessionId) return;
          grid = { cols: payload.cols, rows: payload.rows };
          refit();
        })
      : null;

    const unsubViewer = watching
      ? window.api.onShareViewer((state) => {
          if (state.shareId !== sessionId) return;
          canType = Boolean(state.canType);
          term.options.disableStdin = !canType;
        })
      : null;

    const unsubClosed = window.api[adapter.onClosed]((payload) => {
      if (payload.sessionId !== sessionId) return;
      term.write(
        watching
          ? `\r\n\x1b[31m[${payload.reason ?? 'the share ended'}]\x1b[0m\r\n`
          : '\r\n\x1b[31m[connection closed]\x1b[0m\r\n'
      );
    });

    const unsubError = adapter.onError
      ? window.api[adapter.onError]((payload) => {
          if (payload.sessionId === sessionId) {
            term.write(`\r\n\x1b[31m[error] ${payload.message}\x1b[0m\r\n`);
          }
        })
      : null;

    return () => {
      refitRef.current = null;
      disposed = true;
      dataSub.dispose();
      resizeSub.dispose();
      unsubData();
      unsubSize?.();
      unsubViewer?.();
      unsubClosed();
      unsubError?.();
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

  // While a terminal is shared its cursor is coloured for whoever holds the
  // keyboard, so who is driving shows up in the terminal itself and not only in
  // the strip above it. `activeTheme` is a dependency because the share palette
  // has a light set and a dark set, and switching themes swaps which one the
  // custom property resolves to.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // Only the cursor itself is recoloured. `cursorAccent` — the character
    // underneath it — is left as the theme had it, because the terminal's own
    // background is transparent and painting the character in it would rub it
    // out rather than invert it.
    const apply = () => {
      const cursor = cursorSlot === null ? null : memberColorHex(cursorSlot);
      term.options.theme = cursor ? { ...terminalTheme, cursor } : terminalTheme;
    };
    apply();
    if (cursorSlot === null) return;

    // And again once the browser has painted: which share palette is live is
    // decided by a class the theme provider sets in an effect of its own, and
    // React runs a child's effects before its parent's — so on the frame a
    // theme is switched the value read above is the outgoing one.
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [terminalTheme, cursorSlot, activeTheme]);

  useEffect(() => {
    if (active) {
      refitRef.current?.();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div
      className={`absolute inset-0 flex flex-col bg-background ${active ? '' : 'invisible pointer-events-none'}`}
    >
      {/* The padding lives on a wrapper, never on the element xterm is opened
          into. The fit addon sizes the grid from getComputedStyle(parent)
          .height, which for a border-box element is the *border* box — so any
          padding here would be counted as room for text, and the row it fits
          into that padding hangs off the bottom of the pane, cut in half. */}
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <div className="size-full" ref={containerRef} />
      </div>

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

// ============================================================================
// App.jsx — THE UI, AS A REACT COMPONENT
// ============================================================================
// This replaces the old index.html structure + renderer.js behavior, merged
// into one place. A React component is a function that returns JSX — HTML-ish
// syntax that describes what should be on screen. When state changes, React
// re-runs the function and updates only what differs.
//
// The building blocks (Button, Card, Badge...) come from shadcn/ui:
// pre-styled, accessible components that live IN OUR CODEBASE under
// src/renderer/components/ui/ — open them, read them, change them.
// ============================================================================
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Terminal, Zap } from 'lucide-react';

export default function App() {
  // useState gives a component memory that survives re-renders.
  //   answer  — main process's reply to our ping (null until we ask)
  //   waiting — true while the ping is in flight, so the button can react
  const [answer, setAnswer] = useState(null);
  const [waiting, setWaiting] = useState(false);

  // Same bridge call as before: renderer → preload → main and back.
  // Only the surroundings changed — instead of poking the DOM by hand,
  // we put the reply into state and let React re-render.
  async function handlePing() {
    setWaiting(true);
    console.log('[renderer] button clicked, calling window.api.ping(...)');
    const reply = await window.api.ping('hello from the UI!');
    setAnswer(reply);
    setWaiting(false);
  }

  return (
    <div className="flex h-screen">
      {/* Invisible strip along the top edge: lets you drag the window,
          since main.js hides the native title bar (titleBarStyle). */}
      <div
        className="fixed inset-x-0 top-0 z-50 h-9"
        style={{ WebkitAppRegion: 'drag' }}
      />

      {/* ============ LEFT: SIDEBAR (host list lives here later) ========= */}
      <aside className="flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
        {/* Spacer so content clears the macOS traffic-light buttons */}
        <div className="h-9 shrink-0" />

        <div className="flex items-center gap-2 px-4 py-2">
          <Terminal className="size-4" />
          <h1 className="text-sm font-semibold tracking-widest">SSH CLIENT</h1>
        </div>

        <Separator />

        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Hosts
          </h2>
          <Badge variant="secondary">0</Badge>
        </div>

        {/* In Phase 1 mission 1.2, this becomes a list rendered from an
            array — in React that's hosts.map(host => <li>...</li>). */}
        <p className="px-4 text-sm text-muted-foreground">No saved hosts yet</p>
      </aside>

      {/* ============ RIGHT: MAIN AREA (future terminal) ================= */}
      <main className="flex flex-1 items-center justify-center p-8">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Phase 0 — The Backbone</CardTitle>
            <CardDescription>
              This window is the <strong>renderer process</strong>. The button
              below sends a message across the bridge to the{' '}
              <strong>main process</strong> and prints the reply.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button onClick={handlePing} disabled={waiting}>
              <Zap /> {waiting ? 'Pinging…' : 'Test the bridge (ping)'}
            </Button>

            {/* && = "render this only if answer exists" (null renders nothing) */}
            {answer && (
              <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
                {`reply from main:  ${answer.reply}\n` +
                  `electron:         v${answer.electronVersion}\n` +
                  `node (main proc): v${answer.nodeVersion}\n` +
                  `chrome (this UI): v${answer.chromeVersion}`}
              </pre>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

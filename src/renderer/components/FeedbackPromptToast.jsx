import { useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FeedbackDialog from '@/components/FeedbackDialog';

const AUTO_DISMISS_MS = 20_000;

const COPY = {
  'first-connection': {
    title: 'First connection done',
    body: 'Got a minute to say how it went?',
  },
  milestone: {
    title: "You've been at it a while",
    body: 'A minute of feedback would help a lot.',
  },
  crash: {
    title: 'Looks like it crashed last time',
    body: 'Mind telling us what happened?',
  },
  update: {
    title: 'Just updated',
    body: 'Anything broken, or better?',
  },
  'install-days': {
    title: "It's been a couple weeks",
    body: "What's working, what isn't?",
  },
  'first-sftp-transfer': {
    title: 'First file transfer done',
    body: 'How was it?',
  },
};

export default function FeedbackPromptToast() {
  const [reason, setReason] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCategory, setDialogCategory] = useState('other');

  useEffect(() => window.api.onFeedbackPrompt(({ reason }) => setReason(reason)), []);

  useEffect(() => {
    if (!reason) return;
    const timer = setTimeout(() => setReason(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [reason]);

  if (!reason) return <FeedbackDialog open={dialogOpen} onOpenChange={setDialogOpen} initialCategory={dialogCategory} />;

  const copy = COPY[reason] || COPY.milestone;

  function openFeedback() {
    setDialogCategory(reason === 'crash' ? 'bug' : 'other');
    setDialogOpen(true);
    setReason(null);
  }

  function optOut() {
    window.api.feedbackOptOut();
    setReason(null);
  }

  return (
    <>
      <div
        role="status"
        className="fixed bottom-4 right-4 z-40 w-72 animate-in fade-in-0 slide-in-from-bottom-2 rounded-lg border bg-popover p-3.5 text-popover-foreground shadow-lg"
      >
        <button
          onClick={() => setReason(null)}
          className="absolute top-2 right-2 rounded-sm opacity-60 hover:opacity-100"
        >
          <X className="size-3.5" />
          <span className="sr-only">Dismiss</span>
        </button>

        <div className="flex items-start gap-2 pr-4">
          <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">{copy.title}</p>
            <p className="text-xs text-muted-foreground">{copy.body}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={optOut}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
          >
            Don't ask again
          </button>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="xs" onClick={() => setReason(null)}>
              Not now
            </Button>
            <Button size="xs" onClick={openFeedback}>
              Send feedback
            </Button>
          </div>
        </div>
      </div>
      <FeedbackDialog open={dialogOpen} onOpenChange={setDialogOpen} initialCategory={dialogCategory} />
    </>
  );
}

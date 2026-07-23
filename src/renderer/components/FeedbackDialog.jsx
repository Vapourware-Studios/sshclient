import { useEffect, useState } from 'react';
import { Bug, Lightbulb, Loader2, MessageSquare, Send, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const MAX_LEN = 4000;

const CATEGORIES = [
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'idea', label: 'Idea', icon: Lightbulb },
  { value: 'other', label: 'Other', icon: MessageSquare },
];

export default function FeedbackDialog({ open, onOpenChange, initialCategory = 'bug' }) {
  const [category, setCategory] = useState(initialCategory);
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  // The dialog is mounted once and reused across prompts (crash, milestone,
  // manual button, ...) — re-sync the category each time it opens instead of
  // only seeding it from the prop at first mount.
  useEffect(() => {
    if (open) setCategory(initialCategory);
  }, [open, initialCategory]);

  function reset() {
    setCategory(initialCategory);
    setMessage('');
    setContactEmail('');
    setIncludeDiagnostics(true);
    setError('');
    setSent(false);
  }

  function handleOpenChange(next) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Say a little more before sending.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.api.feedbackSubmit({
        message: trimmed,
        category,
        contactEmail: contactEmail.trim() || undefined,
        includeDiagnostics,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not send feedback.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="size-4" /> Send feedback
          </DialogTitle>
          <DialogDescription>
            Bugs, ideas, or anything else — this goes straight to the people building the app.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm font-medium">Thanks — sent.</p>
            <p className="text-xs text-muted-foreground">
              No reply is guaranteed unless you left contact info.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-1.5">
              {CATEGORIES.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={category === value ? 'default' : 'outline'}
                  onClick={() => setCategory(value)}
                  disabled={busy}
                  className="flex-1"
                >
                  <Icon className="size-3.5" /> {label}
                </Button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
                placeholder="What happened, or what would help?"
                rows={5}
                disabled={busy}
                autoFocus
              />
              <p className="self-end text-xs text-muted-foreground">
                {message.length}/{MAX_LEN}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="feedback-email" className="text-xs text-muted-foreground">
                Contact email (optional, only if you want a reply)
              </Label>
              <Input
                id="feedback-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={busy}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-muted-foreground">
              <Checkbox
                checked={includeDiagnostics}
                onCheckedChange={(v) => setIncludeDiagnostics(Boolean(v))}
                disabled={busy}
                className="mt-0.5"
              />
              <span>
                Include app version, OS, and Electron/Chrome/Node versions — helps fix bugs faster.
                Never includes hosts, keys, or usernames.
              </span>
            </label>

            {error && (
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {sent ? (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          ) : (
            <Button onClick={submit} disabled={busy || !message.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

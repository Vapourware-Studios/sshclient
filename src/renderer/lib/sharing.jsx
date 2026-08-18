import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Everything the UI knows about shared terminals.
 *
 * Two sides, both kept here so any component can read either:
 *
 * - **shares** — terminals this app is sharing out, keyed by session id.
 * - **viewing** — terminals this app is watching, keyed by share id (which
 *   doubles as the id of the tab it is watched in).
 *
 * No keys or ciphertext reach the renderer; the main process does all of that.
 * What arrives here is presence, who holds the keyboard, and decrypted output.
 *
 * Who is typing sits in a context of its own. It changes on every keystroke
 * anybody sends, and the tab bar, the panels and every open terminal have no
 * business re-rendering for a blinking dot.
 */

const SharingContext = createContext(null);
const TypingContext = createContext(null);

/**
 * The relay hands out a slot; the app decides what a slot looks like. Nine of
 * them, one per participant at full capacity — the owner plus eight.
 *
 * Deliberately not `tone.js`: that hashes an id into five shared colours, and
 * two people in the same terminal wearing the same colour defeats the point.
 */
const COLOR_SLOTS = 9;

function slotIndex(slot) {
  return Number.isInteger(slot) ? Math.abs(slot) % COLOR_SLOTS : 0;
}

export function memberColor(slot) {
  return `var(--share-${slotIndex(slot) + 1})`;
}

/**
 * The same colour as `memberColor`, but as something xterm will take.
 *
 * The palette is written in oklch and handed out as a custom property, and
 * xterm's parser understands neither. A canvas understands both: give it any
 * colour CSS accepts and it hands the same colour back as hex.
 */
let swatch = null;
const PROBE = '#010203';

export function memberColorHex(slot) {
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue(`--share-${slotIndex(slot) + 1}`)
    .trim();
  if (!token) return null;
  swatch ||= document.createElement('canvas').getContext('2d');
  // A colour the canvas cannot parse is ignored rather than thrown, so the
  // probe is what tells a rejected token from a real one.
  swatch.fillStyle = PROBE;
  swatch.fillStyle = token;
  return swatch.fillStyle === PROBE ? null : swatch.fillStyle;
}

/** How long a toast sticks around when nothing needs answering. */
const TOAST_MS = 6000;
/** Past this, the oldest toast nobody has to answer makes way. */
const MAX_TOASTS = 5;

function trimToasts(list) {
  if (list.length <= MAX_TOASTS) return list;
  const oldestIdle = list.findIndex((t) => !t.sticky);
  const victim = oldestIdle === -1 ? 0 : oldestIdle;
  return list.filter((_, i) => i !== victim);
}

export function SharingProvider({ children }) {
  const [shares, setShares] = useState({});
  const [viewing, setViewing] = useState({});
  const [toasts, setToasts] = useState([]);
  const [typing, setTyping] = useState({});
  const typingTimers = useRef(new Map());
  const toastTimers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    clearTimeout(toastTimers.current.get(id));
    toastTimers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast) => {
      const id = crypto.randomUUID();
      setToasts((prev) => {
        // One toast per subject: a second invite for the same share replaces
        // the first rather than queueing up behind it.
        const kept = toast.key ? prev.filter((t) => t.key !== toast.key) : prev;
        return trimToasts([...kept, { ...toast, id }]);
      });
      if (!toast.sticky) {
        toastTimers.current.set(id, setTimeout(() => dismissToast(id), TOAST_MS));
      }
    },
    [dismissToast],
  );

  /** Runs a toast's button and takes the toast away. */
  const answerToast = useCallback(
    (id, onSelect) => {
      onSelect?.();
      dismissToast(id);
    },
    [dismissToast],
  );

  // A member who is typing lights up for a moment, then goes quiet again.
  const markTyping = useCallback((sessionId, memberId) => {
    const key = `${sessionId}:${memberId}`;
    clearTimeout(typingTimers.current.get(key));
    setTyping((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    typingTimers.current.set(
      key,
      setTimeout(() => {
        typingTimers.current.delete(key);
        setTyping((prev) => {
          const { [key]: _gone, ...rest } = prev;
          return rest;
        });
      }, 1500),
    );
  }, []);

  useEffect(() => {
    const unsubOwner = window.api.onShareOwner((state) => {
      setShares((prev) => {
        if (state.status === 'ended') {
          const { [state.sessionId]: _gone, ...rest } = prev;
          return rest;
        }
        return { ...prev, [state.sessionId]: state };
      });
      if (state.status === 'ended' && state.reason && state.reason !== 'stopped') {
        pushToast({ tone: 'warn', title: 'Sharing stopped', body: describeReason(state.reason) });
      }
    });

    const unsubViewer = window.api.onShareViewer((state) => {
      setViewing((prev) => ({ ...prev, [state.shareId]: state }));
    });

    // Sent for a share that ended on its own *and* for one the user closed —
    // the tab state has to go either way. Only the former has anything to say.
    const unsubClosed = window.api.onShareClosed(({ sessionId, reason }) => {
      setViewing((prev) => {
        const { [sessionId]: _gone, ...rest } = prev;
        return rest;
      });
      if (reason) pushToast({ tone: 'warn', title: 'Shared terminal ended', body: reason });
    });

    const unsubInvite = window.api.onShareInvite((payload) => {
      if (payload.status === 'invalid') {
        pushToast({
          key: 'invite',
          tone: 'warn',
          title: 'That share link is incomplete',
          body: 'Ask for the whole link — the part after the # is what opens the terminal.',
        });
      }
      if (payload.status === 'needs-unlock') {
        pushToast({
          key: 'invite',
          tone: 'info',
          title: 'Unlock to join',
          body: 'Someone shared a terminal with you. Unlock your vault to open it.',
        });
      }
      if (payload.status === 'needs-sign-in') {
        pushToast({
          key: 'invite',
          tone: 'info',
          title: 'Sign in to join',
          body: 'Someone shared a terminal with you. Sign in and it will open.',
        });
      }
      // A link the browser handed over opens nothing until this is answered:
      // any page can fire the protocol handler, so arriving is not consent.
      if (payload.status === 'confirm') {
        pushToast({
          key: 'invite',
          tone: 'ask',
          sticky: true,
          title: 'Open a shared terminal?',
          body: 'Only if you were expecting this link. Whoever sent it can watch what you type if they hand you the keyboard.',
          actions: [
            {
              label: 'Open',
              onSelect: () => window.api.shareAcceptInvite(payload.shareId),
            },
            {
              label: 'Ignore',
              variant: 'ghost',
              onSelect: () => window.api.shareDeclineInvite(),
            },
          ],
        });
      }
      if (payload.status === 'joined') {
        setToasts((prev) => prev.filter((t) => t.key !== 'invite'));
      }
    });

    const unsubEvent = window.api.onShareEvent((event) => {
      if (event.kind === 'typing') {
        markTyping(event.sessionId, event.memberId);
        return;
      }
      if (event.kind === 'joined') {
        pushToast({
          tone: 'info',
          title: `${event.member.name} is watching`,
          colorSlot: event.member.color,
        });
        return;
      }
      if (event.kind === 'left') {
        pushToast({
          tone: 'info',
          title: `${event.member.name} stopped watching`,
          colorSlot: event.member.color,
        });
        return;
      }
      if (event.kind === 'control_requested' && event.member) {
        pushToast({
          key: `control:${event.sessionId}:${event.member.id}`,
          tone: 'ask',
          sticky: true,
          title: `${event.member.name} wants to type`,
          colorSlot: event.member.color,
          actions: [
            {
              label: 'Allow',
              onSelect: () => window.api.shareGrant(event.sessionId, event.member.id),
            },
            { label: 'Not now', variant: 'ghost' },
          ],
        });
        return;
      }
      if (event.kind === 'baton') {
        pushToast({
          tone: 'info',
          title: event.mine ? 'You have the keyboard' : 'The owner took the keyboard back',
        });
      }
    });

    return () => {
      unsubOwner();
      unsubViewer();
      unsubClosed();
      unsubInvite();
      unsubEvent();
    };
  }, [pushToast, markTyping]);

  // Pick up shares and viewers that outlived a renderer reload.
  useEffect(() => {
    window.api.shareList().then(({ shares: owned = [], viewing: watched = [] }) => {
      if (owned.length) {
        setShares(Object.fromEntries(owned.map((s) => [s.sessionId, s])));
      }
      if (watched.length) {
        setViewing(Object.fromEntries(watched.map((v) => [v.shareId, v])));
      }
    });
  }, []);

  // Both maps outlive the state they were set from, so sweep them together.
  useEffect(() => {
    const pending = [typingTimers.current, toastTimers.current];
    return () => {
      for (const timers of pending) {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      shares,
      viewing,
      toasts,
      dismissToast,
      answerToast,
      start: (sessionId, kind) => window.api.shareStart(sessionId, kind),
      stop: (sessionId) => window.api.shareStop(sessionId),
      grant: (sessionId, memberId) => window.api.shareGrant(sessionId, memberId),
      revoke: (sessionId) => window.api.shareRevoke(sessionId),
      kick: (sessionId, memberId) => window.api.shareKick(sessionId, memberId),
      requestControl: (shareId) => window.api.shareRequestControl(shareId),
      releaseControl: (shareId) => window.api.shareReleaseControl(shareId),
    }),
    [shares, viewing, toasts, dismissToast, answerToast],
  );

  return (
    <SharingContext.Provider value={value}>
      <TypingContext.Provider value={typing}>{children}</TypingContext.Provider>
    </SharingContext.Provider>
  );
}

export function useSharing() {
  const value = useContext(SharingContext);
  if (!value) throw new Error('useSharing must be used inside a SharingProvider');
  return value;
}

/** Subscribes to one member's typing light, and nothing else. */
export function useIsTyping(sessionId, memberId) {
  const typing = useContext(TypingContext);
  return Boolean(typing?.[`${sessionId}:${memberId}`]);
}

/**
 * The colour slot of whoever is driving a terminal right now. Both sides of a
 * share resolve through here: the owner's own session is keyed by session id,
 * a viewer's copy by share id, and those are the keys of the two maps.
 *
 * A shared shell has one cursor, not one per person — everybody's view is the
 * same grid with the same caret in it. So rather than draw carets nobody's
 * keystrokes move, the real one wears the colour of whoever it is currently
 * obeying, and it changes hands when the keyboard does. `null` for a terminal
 * nobody is sharing: it keeps whatever cursor its theme gave it.
 */
export function useCursorSlot(sessionId) {
  const { shares, viewing } = useSharing();
  const state = shares[sessionId] ?? viewing[sessionId] ?? null;
  if (!state) return null;

  const members = state.members ?? [];
  // A null baton means the owner is typing; the relay lists them like anyone
  // else, so their slot is theirs rather than a colour reserved here.
  if (state.baton === null || state.baton === undefined) {
    return members.find((m) => m.role === 'owner')?.color ?? 0;
  }
  return members.find((m) => m.id === state.baton)?.color ?? null;
}

function describeReason(reason) {
  if (reason === 'expired') return 'The share reached its time limit.';
  if (reason === 'output_flood') return 'The terminal produced more output than the relay allows.';
  if (reason === 'owner_gone') return 'The connection to the relay was lost.';
  if (reason === 'unreachable') return 'Could not reach the relay.';
  if (reason === 'locked') return 'The vault was locked.';
  return 'The share ended.';
}

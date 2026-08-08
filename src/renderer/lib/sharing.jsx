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
 */

const SharingContext = createContext(null);

/** The relay hands out a slot; the app decides what a slot looks like. Nine
 *  of them, one per participant at full capacity — the owner plus eight. */
const COLOR_SLOTS = 9;

export function memberColor(slot) {
  return `var(--share-${(Number(slot) % COLOR_SLOTS) + 1})`;
}

/** How long a toast sticks around when nothing needs answering. */
const TOAST_MS = 6000;

export function SharingProvider({ children }) {
  const [shares, setShares] = useState({});
  const [viewing, setViewing] = useState({});
  const [toasts, setToasts] = useState([]);
  const [invite, setInvite] = useState(null);
  const [typing, setTyping] = useState({});
  const typingTimers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
      if (!toast.sticky) setTimeout(() => dismissToast(id), TOAST_MS);
    },
    [dismissToast],
  );

  // A member who is typing lights up for a moment, then goes quiet again.
  const markTyping = useCallback((sessionId, memberId) => {
    const key = `${sessionId}:${memberId}`;
    clearTimeout(typingTimers.current.get(key));
    setTyping((prev) => ({ ...prev, [key]: true }));
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

    const unsubClosed = window.api.onShareClosed(({ sessionId, reason }) => {
      setViewing((prev) => {
        const { [sessionId]: _gone, ...rest } = prev;
        return rest;
      });
      pushToast({ tone: 'warn', title: 'Shared terminal ended', body: reason });
    });

    const unsubInvite = window.api.onShareInvite((payload) => {
      setInvite(payload);
      if (payload.status === 'invalid') {
        pushToast({
          tone: 'warn',
          title: 'That share link is incomplete',
          body: 'Ask for the whole link — the part after the # is what opens the terminal.',
        });
      }
      if (payload.status === 'needs-unlock') {
        pushToast({
          tone: 'info',
          title: 'Unlock to join',
          body: 'Someone shared a terminal with you. Unlock your vault to open it.',
        });
      }
      if (payload.status === 'needs-sign-in') {
        pushToast({
          tone: 'info',
          title: 'Sign in to join',
          body: 'Someone shared a terminal with you. Sign in and it will open.',
        });
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
          tone: 'ask',
          sticky: true,
          title: `${event.member.name} wants to type`,
          colorSlot: event.member.color,
          action: { label: 'Allow', sessionId: event.sessionId, memberId: event.member.id },
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

  const value = useMemo(
    () => ({
      shares,
      viewing,
      toasts,
      invite,
      isTyping: (sessionId, memberId) => Boolean(typing[`${sessionId}:${memberId}`]),
      dismissToast,
      start: (sessionId, kind) => window.api.shareStart(sessionId, kind),
      stop: (sessionId) => window.api.shareStop(sessionId),
      grant: (sessionId, memberId) => window.api.shareGrant(sessionId, memberId),
      revoke: (sessionId) => window.api.shareRevoke(sessionId),
      kick: (sessionId, memberId) => window.api.shareKick(sessionId, memberId),
      leave: (shareId) => window.api.shareLeave(shareId),
      requestControl: (shareId) => window.api.shareRequestControl(shareId),
      releaseControl: (shareId) => window.api.shareReleaseControl(shareId),
    }),
    [shares, viewing, toasts, invite, typing, dismissToast],
  );

  return <SharingContext.Provider value={value}>{children}</SharingContext.Provider>;
}

export function useSharing() {
  const value = useContext(SharingContext);
  if (!value) throw new Error('useSharing must be used inside a SharingProvider');
  return value;
}

function describeReason(reason) {
  if (reason === 'expired') return 'The share reached its time limit.';
  if (reason === 'output_flood') return 'The terminal produced more output than the relay allows.';
  if (reason === 'owner_gone') return 'The connection to the relay was lost.';
  if (reason === 'unreachable') return 'Could not reach the relay.';
  if (reason === 'locked') return 'The vault was locked.';
  return 'The share ended.';
}

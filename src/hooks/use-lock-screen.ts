/**
 * useLockScreen — activity tracker + auto-lock state manager
 *
 * Manages:
 *  - inactivity timer (mouse/keyboard/touch/click)
 *  - lock state (isLocked, lastActivePath)
 *  - PIN setup status (hasPIN from backend)
 *
 * IMPORTANT: lock is UI-only — the OIDC session stays alive.
 * PIN or password required to unlock.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { useApiQuery } from "@/lib/query.ts";

const DEFAULT_TIMEOUT_SECONDS = 30;

/** `GET /api/auth/security` javobi. */
export type SecuritySettings = {
  hasPIN: boolean;
  autoLockTimeoutSeconds: number;
  isPinLocked: boolean;
  pinLockedUntil: string | null;
  pinFailedAttempts: number;
};

/** Faqat kirgan foydalanuvchi uchun so'raladi. */
export function useSecuritySettings(): SecuritySettings | undefined {
  const currentUser = useCurrentUser();
  return useApiQuery<SecuritySettings>(currentUser ? "/api/auth/security" : null).data;
}

export type LockState = {
  isLocked: boolean;
  lastActivePath: string;
  lock: () => void;
  unlock: () => void;
  resetTimer: () => void;
};

// Module-level singleton so state persists across re-renders/remounts
let _isLocked = false;
let _lastActivePath = "/";
const _listeners = new Set<() => void>();

function notifyAll() {
  _listeners.forEach((fn) => fn());
}

export function lockScreen(path?: string) {
  if (path) _lastActivePath = path;
  _isLocked = true;
  notifyAll();
}

export function unlockScreen() {
  _isLocked = false;
  notifyAll();
}

export function useLockScreen(): LockState {
  const [, forceUpdate] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const securitySettings = useSecuritySettings();
  const timeoutSeconds = securitySettings?.autoLockTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  // Subscribe to module-level state changes
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  const lock = useCallback(() => {
    lockScreen();
  }, []);

  const unlock = useCallback(() => {
    unlockScreen();
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // timeoutSeconds=0 means disabled
    if (timeoutSeconds <= 0 || _isLocked) return;
    timerRef.current = setTimeout(() => {
      lockScreen();
    }, timeoutSeconds * 1000);
  }, [timeoutSeconds]);

  // Track user activity — restart timer on any interaction
  useEffect(() => {
    if (timeoutSeconds <= 0) return; // disabled

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    const handler = () => {
      if (!_isLocked) resetTimer();
    };

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetTimer(); // start immediately

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutSeconds, resetTimer]);

  return {
    isLocked: _isLocked,
    lastActivePath: _lastActivePath,
    lock,
    unlock,
    resetTimer,
  };
}

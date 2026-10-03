import { useEffect, useRef } from 'react';
import { ERROR_DISPLAY_MS } from '../utils/friendlyError.js';

// Calls `dismiss` once `value` (an error message, usually) has been on screen
// for `ms`. A new value restarts the clock; clearing it cancels.
export function useAutoDismiss(value, dismiss, ms = ERROR_DISPLAY_MS) {
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    dismissRef.current = dismiss;
  });
  useEffect(() => {
    if (!value) return undefined;
    const timer = window.setTimeout(() => dismissRef.current(), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
}

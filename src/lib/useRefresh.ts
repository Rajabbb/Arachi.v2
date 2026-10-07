import { useEffect, useState } from "react";

/**
 * A number that grows when the page should load its data again: every
 * `intervalMs` while the tab is visible, and right away when the user comes
 * back to the tab. Put it in an effect's dependencies, so delivery statuses
 * the server learns meanwhile (a bounce from the Resend webhook, an opened
 * email) show without reloading the page.
 */
export function useRefresh(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    const timer = setInterval(bump, intervalMs);
    document.addEventListener("visibilitychange", bump);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [intervalMs]);
  return tick;
}

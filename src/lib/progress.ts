import { useEffect, useState } from "react";

/**
 * The name of the sub-process happening now, instead of a bare "loading": it moves through
 * `steps` while `active` is true and stays on the last one until the work ends.
 */
export function useProgress(active: boolean, steps: string[], intervalMs = 1600): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    setIndex(0);
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, steps.join("|"), intervalMs]);
  return steps[Math.min(index, steps.length - 1)] ?? "";
}

/** Steps shown while the agent works on a message. */
export function chatSteps(hasFiles: boolean, text: string): string[] {
  const t = text.toLowerCase();
  const steps = hasFiles ? ["Fayl oxunur…", "Məlumatlar çıxarılır…"] : ["Mesaj oxunur…"];
  if (/(göndər|send|отправ)/.test(t)) steps.push("Daşıyıcılar yoxlanılır…");
  else if (/(rfq|sorğu|yarat|create)/.test(t)) steps.push("Sahələr yoxlanılır…");
  else steps.push("arachi.co-dan məlumat alınır…");
  steps.push("Cavab hazırlanır…");
  return steps;
}

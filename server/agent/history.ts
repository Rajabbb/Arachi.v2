import { config } from "../config";
import type { ModelProvider } from "./providers/types";

/**
 * What the model remembers of a saved conversation: its own transcript,
 * kept as one array of messages per turn (the user's message, tool calls
 * and results, the answer). Whole turns are dropped from the front, so the
 * transcript always starts at a user's message and every remaining turn
 * stays exactly as the model produced it.
 */

/** The saved turns this provider can continue; another provider's transcript starts over. */
export function usableTurns<M>(turns: unknown[][], provider: ModelProvider<M>): M[][] {
  return provider.ownsTranscript(turns.flat()) ? (turns as M[][]) : [];
}

/**
 * Adds a finished turn and keeps the latest `historyTurns`; turns older
 * than the latest `attachmentTurns` lose their images and PDFs.
 */
export function remember<M>(turns: M[][], added: M[], provider: ModelProvider<M>): M[][] {
  const all = added.length > 0 ? [...turns, added] : turns;
  const kept = all.slice(-config.historyTurns);
  const withFiles = kept.length - config.attachmentTurns;
  return kept.map((turn, i) =>
    i < withFiles && turn.length > 0 ? [provider.dropAttachments(turn[0]), ...turn.slice(1)] : turn,
  );
}

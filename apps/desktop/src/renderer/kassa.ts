/** Main jarayon bilan aloqa (`window.bumKassa`, preload). */
import type { KassaBridge, KassaChannel, KassaChannels, KassaError } from "../shared/kassa-api.js";

declare global {
  interface Window {
    bumKassa: KassaBridge;
  }
}

export class KassaCallError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(error: KassaError) {
    super(error.message);
    this.name = "KassaCallError";
    this.code = error.code;
    this.details = error.details;
  }
}

export async function call<C extends KassaChannel>(
  channel: C,
  ...input: KassaChannels[C]["input"] extends void ? [] : [KassaChannels[C]["input"]]
): Promise<KassaChannels[C]["output"]> {
  const result = await window.bumKassa.invoke(channel, ...input);
  if (!result.ok) throw new KassaCallError(result.error);
  return result.data;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "Kutilmagan xato");

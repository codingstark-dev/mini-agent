import type { ProviderName } from "../providers/create.js";
import type { SessionStore } from "./session-store.js";

export interface StartupSelection {
  provider: ProviderName;
  model: string;
}

export async function resolveStartupSelection(
  fallback: StartupSelection,
  sessions: SessionStore,
  restoreSaved: boolean,
): Promise<StartupSelection> {
  if (!restoreSaved) return fallback;
  const latest = (await sessions.list())[0];
  if (latest) return { provider: latest.provider, model: latest.model };
  return fallback;
}

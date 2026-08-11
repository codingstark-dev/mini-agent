import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ProviderName } from "./create.js";

type StoredCredentials = Partial<Record<ProviderName, string>>;

export function defaultCredentialFile(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.MINI_AGENT_STATE_DIR) {
    return path.resolve(environment.MINI_AGENT_STATE_DIR, "credentials.json");
  }
  const stateRoot = environment.XDG_STATE_HOME || path.join(homedir(), ".local", "state");
  return path.join(stateRoot, "mini-agent", "credentials.json");
}

export class CredentialStore {
  constructor(private readonly file = defaultCredentialFile()) {}

  private async read(): Promise<StoredCredentials> {
    let contents: string;
    try {
      contents = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    const value: unknown = JSON.parse(contents);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Credential file is invalid");
    }
    const credentials: StoredCredentials = {};
    for (const provider of ["anthropic", "openrouter", "vercel"] as const) {
      const key = (value as Record<string, unknown>)[provider];
      if (typeof key === "string" && key.length > 0) credentials[provider] = key;
    }
    return credentials;
  }

  async get(provider: ProviderName): Promise<string | undefined> {
    return (await this.read())[provider];
  }

  async set(provider: ProviderName, apiKey: string): Promise<void> {
    const key = apiKey.trim();
    if (!key) throw new Error("API key cannot be empty");
    const credentials = await this.read();
    credentials[provider] = key;
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

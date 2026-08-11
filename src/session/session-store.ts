import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { AgentEvent } from "../agent/run-agent.js";
import type { ProviderName } from "../providers/create.js";

export interface SessionTurn {
  id: string;
  prompt: string;
  answer: string;
  activations: string[];
  activity: AgentEvent[];
  createdAt: string;
}

export interface AgentSession {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  provider: ProviderName;
  model: string;
  turns: SessionTurn[];
  redoTurns?: SessionTurn[];
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  provider: ProviderName;
  model: string;
  turnCount: number;
}

function validId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function sessionTitle(session: AgentSession): string {
  const prompt = session.turns[0]?.prompt.replaceAll(/\s+/g, " ").trim();
  return prompt ? prompt.slice(0, 60) : "Empty session";
}

function isAgentSession(value: unknown): value is AgentSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AgentSession>;
  return session.version === 1 &&
    typeof session.id === "string" &&
    validId(session.id) &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string" &&
    (session.provider === "anthropic" || session.provider === "openrouter" || session.provider === "vercel") &&
    typeof session.model === "string" &&
    Array.isArray(session.turns);
}

export function defaultSessionDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.MINI_AGENT_STATE_DIR) return path.resolve(environment.MINI_AGENT_STATE_DIR, "sessions");
  const stateRoot = environment.XDG_STATE_HOME || path.join(homedir(), ".local", "state");
  return path.join(stateRoot, "mini-agent", "sessions");
}

export function createSession(provider: ProviderName, model: string, now = new Date()): AgentSession {
  const timestamp = now.toISOString();
  return {
    version: 1,
    id: randomUUID().slice(0, 8),
    createdAt: timestamp,
    updatedAt: timestamp,
    provider,
    model,
    turns: [],
  };
}

export function rewindSession(
  session: AgentSession,
  keepTurns: number,
  now = new Date(),
): AgentSession {
  if (!Number.isInteger(keepTurns) || keepTurns < 0 || keepTurns > session.turns.length) {
    throw new Error(`Cannot rewind session to ${keepTurns} turns`);
  }
  return {
    ...session,
    turns: session.turns.slice(0, keepTurns),
    redoTurns: [...session.turns.slice(keepTurns), ...(session.redoTurns ?? [])],
    updatedAt: now.toISOString(),
  };
}

export function redoSession(session: AgentSession, now = new Date()): AgentSession {
  if (!session.redoTurns?.length) throw new Error("There are no rewound turns to restore");
  const { redoTurns, ...current } = session;
  return {
    ...current,
    turns: [...session.turns, ...redoTurns],
    updatedAt: now.toISOString(),
  };
}

export class SessionStore {
  constructor(private readonly directory = defaultSessionDirectory()) {}

  async save(session: AgentSession): Promise<void> {
    if (!validId(session.id)) throw new Error("Session ID contains unsupported characters");
    await mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `${session.id}.json`);
    const temporary = path.join(this.directory, `.${session.id}.${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
  }

  async load(id: string): Promise<AgentSession> {
    if (!validId(id)) throw new Error("Session ID contains unsupported characters");
    const contents = await readFile(path.join(this.directory, `${id}.json`), "utf8");
    const session: unknown = JSON.parse(contents);
    if (!isAgentSession(session) || session.id !== id) throw new Error(`Invalid session: ${id}`);
    return session;
  }

  async list(): Promise<SessionSummary[]> {
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const sessions: AgentSession[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      try {
        sessions.push(await this.load(id));
      } catch {
        // A damaged file should not make the rest of the history unavailable.
      }
    }
    return sessions
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        id: session.id,
        title: sessionTitle(session),
        updatedAt: session.updatedAt,
        provider: session.provider,
        model: session.model,
        turnCount: session.turns.length,
      }));
  }
}

import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProviderTool } from "../providers/types.js";

export type WorkspaceMode = "read-only" | "workspace-write";

export interface ToolExecutionResult {
  content: string;
  summary: string;
}

const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 256 * 1024;

const readTools: readonly ProviderTool[] = [
  {
    name: "list_files",
    description: "List project files with ripgrep. Use this before guessing project structure.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory to list. Defaults to the project root." },
        glob: { type: "string", description: "Optional ripgrep glob, such as **/*.ts." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description: "Search file contents with ripgrep. The pattern is a regular expression and paths stay inside the project.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Relative directory to search. Defaults to the project root." },
        glob: { type: "string", description: "Optional ripgrep glob, such as **/*.tsx." },
        max_results: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 project file, optionally selecting an inclusive line range.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "git_history",
    description: "Read recent git commits for release notes or repository context. This tool never changes the repository.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Optional git date expression, such as 7 days ago or 2026-08-01." },
        until: { type: "string", description: "Optional end date expression." },
        max_count: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
] as const;

const writeTools: readonly ProviderTool[] = [
  {
    name: "write_file",
    description: "Create or replace a UTF-8 file inside the project. Parent directories are created when needed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    description: "Make one precise edit by replacing unique text in a project file. Fails when the old text is missing or ambiguous.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
  },
] as const;

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalString(input: Record<string, unknown>, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalInteger(
  input: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function nearestExistingPath(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function checkedPath(root: string, requested: string, mayCreate = false): Promise<string> {
  if (path.isAbsolute(requested)) throw new Error("Absolute paths are outside the workspace");
  const candidate = path.resolve(root, requested);
  if (!isWithin(root, candidate)) throw new Error(`Path is outside the workspace: ${requested}`);

  const resolved = mayCreate ? await nearestExistingPath(candidate) : await realpath(candidate);
  if (!isWithin(root, resolved)) throw new Error(`Path resolves outside the workspace: ${requested}`);
  return candidate;
}

function runProcess(
  command: string,
  arguments_: string[],
  cwd: string,
  successCodes: readonly number[],
  missingMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (error?: Error, value = ""): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("ripgrep output exceeded 256 KiB; narrow the path or glob"));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { errors.push(chunk); });
    child.on("error", (error) => {
      finish(error.message.includes("ENOENT")
        ? new Error(missingMessage)
        : error);
    });
    child.on("close", (code) => {
      const stdout = Buffer.concat(output).toString("utf8").trimEnd();
      if (code !== null && successCodes.includes(code)) finish(undefined, stdout);
      else finish(new Error(Buffer.concat(errors).toString("utf8").trim() || `${command} exited with code ${code}`));
    });
  });
}

function runRipgrep(arguments_: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return runProcess(
    "rg",
    arguments_,
    cwd,
    [0, 1],
    "ripgrep (rg) is required for file search but was not found on PATH",
    signal,
  );
}

function gitDate(input: Record<string, unknown>, name: string): string | undefined {
  const value = optionalString(input, name);
  if (value && (value.length > 100 || /[\0\r\n]/.test(value))) {
    throw new Error(`${name} is not a valid git date expression`);
  }
  return value;
}

export class WorkspaceTools {
  readonly tools: readonly ProviderTool[];

  constructor(
    readonly root: string,
    readonly mode: WorkspaceMode,
  ) {
    this.tools = mode === "workspace-write" ? [...readTools, ...writeTools] : [...readTools];
  }

  async execute(name: string, rawInput: unknown, signal?: AbortSignal): Promise<ToolExecutionResult> {
    if (!this.tools.some((tool) => tool.name === name)) throw new Error(`Tool is not available: ${name}`);
    const input = record(rawInput);

    if (name === "list_files") {
      const relativePath = optionalString(input, "path") ?? ".";
      const directory = await checkedPath(this.root, relativePath);
      if (!(await stat(directory)).isDirectory()) throw new Error(`Not a directory: ${relativePath}`);
      const glob = optionalString(input, "glob");
      const arguments_ = ["--files", "--hidden", "--glob", "!.git/**"];
      if (glob) arguments_.push("--glob", glob);
      arguments_.push("--", relativePath);
      const content = await runRipgrep(arguments_, this.root, signal);
      return { content: content || "(no files)", summary: `listed ${relativePath}` };
    }

    if (name === "search_files") {
      const pattern = requiredString(input, "pattern");
      const relativePath = optionalString(input, "path") ?? ".";
      const directory = await checkedPath(this.root, relativePath);
      if (!(await stat(directory)).isDirectory()) throw new Error(`Not a directory: ${relativePath}`);
      const glob = optionalString(input, "glob");
      const maximum = optionalInteger(input, "max_results", 1, 200) ?? 100;
      const arguments_ = ["--line-number", "--column", "--color=never", "--no-heading", "--hidden", "--glob", "!.git/**"];
      if (glob) arguments_.push("--glob", glob);
      arguments_.push("--", pattern, relativePath);
      const output = await runRipgrep(arguments_, this.root, signal);
      const lines = output ? output.split("\n") : [];
      const content = lines.slice(0, maximum).join("\n") || "(no matches)";
      const suffix = lines.length > maximum ? `\n… ${lines.length - maximum} more matches` : "";
      return { content: `${content}${suffix}`, summary: `searched ${relativePath} for ${pattern}` };
    }

    if (name === "read_file") {
      const relativePath = requiredString(input, "path");
      const file = await checkedPath(this.root, relativePath);
      const details = await stat(file);
      if (!details.isFile()) throw new Error(`Not a file: ${relativePath}`);
      if (details.size > MAX_FILE_BYTES) throw new Error("File exceeds the 512 KiB read limit");
      const start = optionalInteger(input, "start_line", 1) ?? 1;
      const lines = (await readFile(file, "utf8")).split("\n");
      const end = optionalInteger(input, "end_line", start, lines.length) ?? lines.length;
      return {
        content: lines.slice(start - 1, end).map((line, index) => `${start + index}| ${line}`).join("\n"),
        summary: `read ${relativePath}:${start}-${end}`,
      };
    }

    if (name === "git_history") {
      const maximum = optionalInteger(input, "max_count", 1, 200) ?? 50;
      const since = gitDate(input, "since");
      const until = gitDate(input, "until");
      const arguments_ = [
        "log",
        "--no-decorate",
        "--date=short",
        "--pretty=format:%h%x09%ad%x09%s",
        `--max-count=${maximum}`,
      ];
      if (since) arguments_.push(`--since=${since}`);
      if (until) arguments_.push(`--until=${until}`);
      arguments_.push("--");
      const content = await runProcess(
        "git",
        arguments_,
        this.root,
        [0],
        "git is required for commit history but was not found on PATH",
        signal,
      );
      return { content: content || "(no commits)", summary: `read ${maximum} recent commits` };
    }

    if (name === "write_file") {
      const relativePath = requiredString(input, "path");
      const content = typeof input.content === "string" ? input.content : undefined;
      if (content === undefined) throw new Error("content must be a string");
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error("Content exceeds the 512 KiB write limit");
      const file = await checkedPath(this.root, relativePath, true);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, "utf8");
      return { content: `Wrote ${Buffer.byteLength(content)} bytes to ${relativePath}`, summary: `wrote ${relativePath}` };
    }

    if (name === "edit_file") {
      const relativePath = requiredString(input, "path");
      const oldText = requiredString(input, "old_text");
      const newText = typeof input.new_text === "string" ? input.new_text : undefined;
      if (newText === undefined) throw new Error("new_text must be a string");
      const file = await checkedPath(this.root, relativePath);
      const original = await readFile(file, "utf8");
      const occurrences = original.split(oldText).length - 1;
      if (occurrences !== 1) throw new Error(`old_text must match exactly once; found ${occurrences} matches`);
      const updated = original.replace(oldText, newText);
      if (Buffer.byteLength(updated) > MAX_FILE_BYTES) throw new Error("Edited file exceeds the 512 KiB limit");
      await writeFile(file, updated, "utf8");
      return { content: `Edited ${relativePath}`, summary: `edited ${relativePath}` };
    }

    throw new Error(`Tool is not implemented: ${name}`);
  }
}

export async function createWorkspaceTools(root: string, mode: WorkspaceMode): Promise<WorkspaceTools> {
  const canonicalRoot = await realpath(root);
  if (!(await stat(canonicalRoot)).isDirectory()) throw new Error(`Workspace is not a directory: ${root}`);
  return new WorkspaceTools(canonicalRoot, mode);
}

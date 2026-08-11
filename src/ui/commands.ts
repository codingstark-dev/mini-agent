export interface SlashCommand {
  name: string;
  argument: string;
}

export interface SlashCommandDefinition {
  name: string;
  description: string;
  usage: string;
}

export interface SlashSuggestion {
  name: string;
  description: string;
  kind: "command" | "skill";
}

interface SuggestibleSkill {
  name: string;
  description: string;
}

export const slashCommands: readonly SlashCommandDefinition[] = [
  { name: "model", usage: "/model [id]", description: "Choose or set the active model" },
  { name: "models", usage: "/models", description: "Choose or set the active model" },
  { name: "history", usage: "/history", description: "Resume a saved session" },
  { name: "sessions", usage: "/sessions", description: "Resume a saved session" },
  { name: "continue", usage: "/continue", description: "Resume a saved session" },
  { name: "resume", usage: "/resume [id]", description: "Resume a session by id" },
  { name: "rewind", usage: "/rewind [turns]", description: "Return to an earlier turn" },
  { name: "undo", usage: "/undo", description: "Remove the latest turn" },
  { name: "redo", usage: "/redo", description: "Restore rewound turns" },
  { name: "new", usage: "/new", description: "Start a new session" },
  { name: "skills", usage: "/skills", description: "List installed skills" },
  { name: "tools", usage: "/tools", description: "List workspace tools and permissions" },
  { name: "status", usage: "/status", description: "Show session details" },
  { name: "activity", usage: "/activity", description: "Show or hide agent activity" },
  { name: "thinking", usage: "/thinking", description: "Show or hide agent activity" },
  { name: "clear", usage: "/clear", description: "Clear this conversation" },
  { name: "help", usage: "/help", description: "Show every command" },
  { name: "exit", usage: "/exit", description: "Close the agent" },
  { name: "quit", usage: "/quit", description: "Close the agent" },
] as const;

const slashCommandNames = new Set(slashCommands.map((command) => command.name));

export function isSlashCommand(name: string): boolean {
  return slashCommandNames.has(name);
}

export function slashHelpText(): string {
  return slashCommands
    .filter((command) => !["continue", "models", "quit", "sessions", "thinking"].includes(command.name))
    .map((command) => `${command.usage.padEnd(17)} ${command.description.toLowerCase()}`)
    .join("\n");
}

export function slashSuggestions(
  input: string,
  skills: readonly SuggestibleSkill[],
  limit = 8,
): SlashSuggestion[] {
  if (!input.startsWith("/") || /\s/.test(input)) return [];

  const query = input.slice(1).toLowerCase();
  const commands: SlashSuggestion[] = slashCommands
    .filter((command) => command.name.startsWith(query))
    .map((command) => ({
      name: command.name,
      description: command.description,
      kind: "command",
    }));
  const installedSkills: SlashSuggestion[] = skills
    .filter((skill) => skill.name.startsWith(query))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      kind: "skill",
    }));

  return [...commands, ...installedSkills].slice(0, Math.max(0, limit));
}

export function parseSlashCommand(input: string): SlashCommand | undefined {
  const match = /^\/([a-z][a-z-]*)(?:\s+(.*))?$/i.exec(input.trim());
  if (!match?.[1]) return undefined;
  return {
    name: match[1].toLowerCase(),
    argument: match[2]?.trim() ?? "",
  };
}

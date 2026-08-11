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
  { name: "plan", usage: "/plan <task>", description: "Create and store an implementation plan" },
  { name: "start-work", usage: "/start-work", description: "Execute and verify the next planned step" },
  { name: "loop", usage: "/loop [limit]", description: "Work until the plan passes verification" },
  { name: "key", usage: "/key", description: "Choose a provider, model, and API key" },
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
const hiddenHelpCommands = new Set(["continue", "models", "quit", "sessions", "thinking"]);

export function isSlashCommand(name: string): boolean {
  return slashCommandNames.has(name);
}

export function slashHelpText(): string {
  const lines: string[] = [];
  for (const command of slashCommands) {
    if (!hiddenHelpCommands.has(command.name)) {
      lines.push(`${command.usage.padEnd(17)} ${command.description.toLowerCase()}`);
    }
  }
  return lines.join("\n");
}

export function slashSuggestions(
  input: string,
  skills: readonly SuggestibleSkill[],
  limit = 8,
): SlashSuggestion[] {
  if (!input.startsWith("/") || /\s/.test(input)) return [];

  const maximum = Math.max(0, limit);
  const query = input.slice(1).toLowerCase();
  const suggestions: SlashSuggestion[] = [];
  for (const command of slashCommands) {
    if (command.name.startsWith(query)) {
      suggestions.push({ name: command.name, description: command.description, kind: "command" });
      if (suggestions.length === maximum) return suggestions;
    }
  }
  for (const skill of skills) {
    if (skill.name.startsWith(query)) {
      suggestions.push({ name: skill.name, description: skill.description, kind: "skill" });
      if (suggestions.length === maximum) return suggestions;
    }
  }
  return suggestions;
}

export function parseSlashCommand(input: string): SlashCommand | undefined {
  const match = /^\/([a-z][a-z-]*)(?:\s+(.*))?$/i.exec(input.trim());
  if (!match?.[1]) return undefined;
  return {
    name: match[1].toLowerCase(),
    argument: match[2]?.trim() ?? "",
  };
}

export interface SlashCommand {
  name: string;
  argument: string;
}

export function parseSlashCommand(input: string): SlashCommand | undefined {
  const match = /^\/([a-z][a-z-]*)(?:\s+(.*))?$/i.exec(input.trim());
  if (!match?.[1]) return undefined;
  return {
    name: match[1].toLowerCase(),
    argument: match[2]?.trim() ?? "",
  };
}

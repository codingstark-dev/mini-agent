import type { SessionTurn } from "../session/session-store.js";
import { activityLineCount } from "./activity-view.js";

export interface TurnWindow {
  turns: SessionTurn[];
  hidden: number;
}

function wrappedLines(text: string, width: number): number {
  return text.split("\n").reduce((total, line) => {
    const length = [...line].length;
    return total + Math.max(1, Math.ceil(length / width));
  }, 0);
}

function turnHeight(turn: SessionTurn, columns: number, showActivity: boolean): number {
  const width = Math.max(20, columns - 4);
  return wrappedLines(turn.prompt, width) +
    wrappedLines(turn.answer, width) +
    (showActivity ? activityLineCount(turn.activity, 4) : 0) +
    1;
}

export function fitRecentTurns(
  turns: readonly SessionTurn[],
  lineBudget: number,
  columns: number,
  showActivity: boolean,
): TurnWindow {
  const visible: SessionTurn[] = [];
  let used = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) continue;
    const height = turnHeight(turn, columns, showActivity);
    if (visible.length > 0 && used + height > lineBudget) break;
    visible.unshift(turn);
    used += height;
  }

  return { turns: visible, hidden: turns.length - visible.length };
}

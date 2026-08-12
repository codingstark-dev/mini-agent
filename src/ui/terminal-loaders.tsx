import React, { useEffect, useState } from "react";
import { Text } from "ink";

const matrixFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function matrixGlyph(frame: number): string {
  return matrixFrames[frame % matrixFrames.length] ?? matrixFrames[0];
}

export interface FocusSegments {
  before: string;
  focus: string;
  after: string;
}

export function focusSegments(text: string, frame: number, width = 5): FocusSegments {
  const characters = [...text];
  if (characters.length === 0) return { before: "", focus: "", after: "" };
  const focusWidth = Math.max(1, Math.min(width, characters.length));
  const position = frame % (characters.length + focusWidth);
  const start = Math.max(0, Math.min(characters.length, position - focusWidth));
  const end = Math.min(characters.length, position);
  return {
    before: characters.slice(0, start).join(""),
    focus: characters.slice(start, end).join(""),
    after: characters.slice(end).join(""),
  };
}

function useLoaderFrame(interval: number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => { setFrame((current) => current + 1); }, interval);
    return () => { clearInterval(timer); };
  }, [interval]);
  return frame;
}

interface TextLoaderProperties {
  color?: string;
  text: string;
  variant: "focus";
}

export function TextLoader({ color, text }: TextLoaderProperties): React.JSX.Element {
  const frame = useLoaderFrame(85);
  const segments = focusSegments(text, frame);
  return (
    <Text>
      <Text dimColor>{segments.before}</Text>
      <Text bold {...(color ? { color } : {})}>{segments.focus}</Text>
      <Text dimColor>{segments.after}</Text>
    </Text>
  );
}

interface InlineLoaderProperties {
  color?: string;
  size?: number;
  variant: "matrix";
}

export function InlineLoader({ color, size = 24 }: InlineLoaderProperties): React.JSX.Element {
  const frame = useLoaderFrame(70);
  return (
    <Text bold={size >= 24} {...(color ? { color } : {})}>
      {matrixGlyph(frame)}
    </Text>
  );
}

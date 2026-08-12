import assert from "node:assert/strict";
import test from "node:test";

import { focusSegments, matrixGlyph } from "../../src/ui/terminal-loaders.js";

test("the matrix loader cycles through terminal-safe frames", () => {
  assert.notEqual(matrixGlyph(0), matrixGlyph(1));
  assert.equal(matrixGlyph(0), matrixGlyph(10));
});

test("the focus loader preserves text while moving its highlighted range", () => {
  const text = "calling the model";
  const first = focusSegments(text, 4);
  const later = focusSegments(text, 9);

  assert.equal(first.before + first.focus + first.after, text);
  assert.equal(later.before + later.focus + later.after, text);
  assert.notEqual(first.focus, later.focus);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TURKEY_COLORS } from "../../netlify/lib/turkey-colors.mjs";

const { turkeys } = JSON.parse(readFileSync(new URL("../../turkey-trot/turkeys.json", import.meta.url), "utf8"));

test("the colour list matches turkeys.json, icon by icon", () => {
  assert.equal(TURKEY_COLORS.length, 50);
  assert.deepEqual(TURKEY_COLORS, turkeys.map(t => t.color));
});

test("the colours are valid and unique", () => {
  assert.ok(TURKEY_COLORS.every(c => /^#[0-9a-f]{6}$/.test(c)));
  assert.equal(new Set(TURKEY_COLORS).size, 50);
});

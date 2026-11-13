import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../../netlify/lib/turkey-trot-api.mjs";
import * as fn from "../../netlify/functions/turkey-trot.mjs";

const cell = (v = "", bg = null) => ({ v, bg });
const row = (rsn, progress) => [cell("2026-11-19T14:00:00Z"), cell(rsn), ...Array.from({ length: 26 }, (_, i) => i < progress ? cell("✓", "#1ad535") : cell()), cell()];

// Fake deps: `vars` is the env, `sheet` is a reader (or an error to throw), `saved` records the snapshot
function setup({ vars = {}, sheet, saved = null } = {}){
  const state = { saved, reads: 0 };
  const deps = {
    env: n => vars[n] || "",
    configured: () => !!vars.GOOGLE_SA_EMAIL,
    readSheet: async (id, tab) => {
      state.reads++; state.args = [id, tab];
      if (sheet instanceof Error) throw sheet;
      return sheet;
    },
    snapshot: { get: async () => state.saved, set: async r => { state.saved = r; } },
  };
  return { handle: makeHandler(deps), state };
}
const configured = { GOOGLE_SA_EMAIL: "bot@x.com", TROT_SHEET_ID: "sheet1" };
const get = (handle, path = "/api/turkey-trot") => handle(new Request("https://kingdomosrs.com" + path));

test("a good read returns the standings, public cache headers and writes the snapshot", async () => {
  const { handle, state } = setup({ vars: configured, sheet: { progress: [row("Alice", 4), row("Bob", 9)], drops: [["1", "Dragon pickaxe"]] } });
  const res = await get(handle);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.players.map(p => p.rsn), ["Bob", "Alice"]);
  assert.deepEqual(body.drops, [{ n: 1, name: "Dragon pickaxe" }]);
  assert.equal(body.total, 26);
  assert.ok(body.updated);
  assert.equal(res.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=30");
  assert.equal(res.headers.get("cache-tag"), "turkeytrot");
  assert.equal(res.headers.get("netlify-vary"), "query=sample");   // other query strings share one cache entry, so they cannot drain the Sheets quota
  assert.deepEqual(state.saved, body);
  assert.deepEqual(state.args, ["sheet1", "Progress"]);
  assert.equal(body.players[0].color, "#1ad535");
});

test("TROT_SHEET_TAB picks the tab", async () => {
  const { handle, state } = setup({ vars: { ...configured, TROT_SHEET_TAB: "Event 2" }, sheet: { progress: [], drops: [] } });
  await get(handle);
  assert.equal(state.args[1], "Event 2");
});

test("a sheet failure serves the snapshot", async () => {
  const snap = { total: 26, drops: [], players: [{ rsn: "Old", icon: 1, color: "#d9552f", progress: 2, reachedAt: null }], updated: "2026-11-20T00:00:00.000Z" };
  const { handle } = setup({ vars: configured, sheet: new Error("Google Sheets read failed (503)"), saved: snap });
  const res = await get(handle);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), snap);
});

test("a sheet failure with no snapshot is a 503, not an empty board", async () => {
  const { handle } = setup({ vars: configured, sheet: new Error("down") });
  const res = await get(handle);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("netlify-cdn-cache-control"), null);
});

test("an empty tab keeps serving the last board and does not overwrite the snapshot", async () => {
  const snap = { total: 26, drops: [], players: [{ rsn: "Old", icon: 1, color: "#d9552f", progress: 2, reachedAt: null }], updated: "2026-11-20T00:00:00.000Z" };
  const { handle, state } = setup({ vars: configured, sheet: { progress: [], drops: [] }, saved: snap });
  const res = await get(handle);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), snap);
  assert.deepEqual(state.saved, snap);
});

test("an empty tab with no earlier snapshot is an empty board and is not saved", async () => {
  const { handle, state } = setup({ vars: configured, sheet: { progress: [], drops: [] } });
  const res = await get(handle);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).players, []);
  assert.equal(state.saved, null);
});

test("no env returns an empty 200 and never reads the sheet", async () => {
  const { handle, state } = setup({ sheet: { progress: [row("Alice", 4)], drops: [] } });
  const res = await get(handle);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { total: 26, drops: [], players: [], updated: null });
  assert.equal(state.reads, 0);
  assert.equal(res.headers.get("cache-tag"), "turkeytrot");
});

test("a failing snapshot store does not break a good read", async () => {
  const deps = { env: n => configured[n] || "", configured: () => true, readSheet: async () => ({ progress: [row("Alice", 4)], drops: [] }),
    snapshot: { get: async () => { throw new Error("blobs"); }, set: async () => { throw new Error("blobs"); } } };
  const res = await get(makeHandler(deps));
  assert.equal((await res.json()).players.length, 1);
});

test("?sample=1 works only when TROT_ALLOW_SAMPLE=1", async () => {
  const on = setup({ vars: { TROT_ALLOW_SAMPLE: "1" } }), off = setup({});
  const sample = await (await get(on.handle, "/api/turkey-trot?sample=1")).json();
  assert.ok(sample.players.length > 20);
  assert.equal((await get(on.handle)).headers.get("cache-tag"), "turkeytrot");
  assert.deepEqual((await (await get(off.handle, "/api/turkey-trot?sample=1")).json()).players, []);
});

test("only GET is allowed", async () => {
  const { handle } = setup({});
  const res = await handle(new Request("https://kingdomosrs.com/api/turkey-trot", { method: "POST" }));
  assert.equal(res.status, 405);
});

test("the function module exports a handler and its route", () => {
  assert.equal(typeof fn.default, "function");
  assert.equal(fn.config.path, "/api/turkey-trot");
});

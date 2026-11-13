import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { clearToken, normalizeKey, readGrid, readRange, signJwt } from "../../netlify/lib/google.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const decode = part => JSON.parse(Buffer.from(part, "base64url").toString());

afterEach(() => { clearToken(); delete process.env.GOOGLE_SA_EMAIL; delete process.env.GOOGLE_SA_KEY; });

test("the JWT has the right header and claims", () => {
  const jwt = signJwt({ email: "bot@example.iam.gserviceaccount.com", key: pem, now: 1000 });
  const [h, c] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(c), {
    iss: "bot@example.iam.gserviceaccount.com",
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1000,
    exp: 4600,
  });
});

test("the JWT signature verifies with the public key", () => {
  const jwt = signJwt({ email: "bot@example.com", key: pem });
  const i = jwt.lastIndexOf(".");
  const ok = createVerify("RSA-SHA256").update(jwt.slice(0, i)).verify(publicKey, jwt.slice(i + 1), "base64url");
  assert.equal(ok, true);
  const bad = createVerify("RSA-SHA256").update(jwt.slice(0, i) + "x").verify(publicKey, jwt.slice(i + 1), "base64url");
  assert.equal(bad, false);
});

test("a key with literal \\n or wrapping quotes becomes a usable PEM", () => {
  const flat = '"' + pem.trim().replace(/\n/g, "\\n") + '"';
  assert.equal(normalizeKey(flat), pem.trim());
  assert.ok(signJwt({ email: "a@b.c", key: normalizeKey(flat) }).split(".").length === 3);
});

test("readRange fetches a token once and reuses it", async () => {
  process.env.GOOGLE_SA_EMAIL = "bot@example.com";
  process.env.GOOGLE_SA_KEY = pem.trim().replace(/\n/g, "\\n");
  const calls = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return String(url).startsWith("https://oauth2.googleapis.com/token")
      ? Response.json({ access_token: "tok", expires_in: 3600 })
      : Response.json({ values: [["a", "b"]] });
  };
  try {
    assert.deepEqual(await readRange("sheet id", "'Progress'!A2:AF"), [["a", "b"]]);
    await readRange("sheet id", "'Drops'!A2:B27");
    const tokenCalls = calls.filter(c => c.url.includes("oauth2"));
    assert.equal(tokenCalls.length, 1);
    assert.ok(String(tokenCalls[0].opts.body).includes("grant_type=urn"));
    const read = calls.find(c => c.url.includes("sheets.googleapis.com"));
    assert.ok(read.url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/sheet%20id/values/"));
    assert.equal(read.opts.headers.authorization, "Bearer tok");
  } finally { globalThis.fetch = realFetch; }
});

test("a 401 from Sheets drops the cached token so the next read signs in again", async () => {
  process.env.GOOGLE_SA_EMAIL = "bot@example.com";
  process.env.GOOGLE_SA_KEY = pem.trim().replace(/\n/g, "\\n");
  let tokens = 0, reads = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) { tokens++; return Response.json({ access_token: "tok" + tokens, expires_in: 3600 }); }
    return ++reads === 1 ? new Response("no", { status: 401 }) : Response.json({ values: [["ok"]] });
  };
  try {
    await assert.rejects(readRange("sheet", "'Progress'!A2:AC"), /401/);
    assert.deepEqual(await readRange("sheet", "'Progress'!A2:AC"), [["ok"]]);
    assert.equal(tokens, 2);
  } finally { globalThis.fetch = realFetch; }
});

test("readRange throws on a Google error and returns [] for an empty range", async () => {
  process.env.GOOGLE_SA_EMAIL = "bot@example.com";
  process.env.GOOGLE_SA_KEY = pem;
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => String(url).includes("oauth2") ? Response.json({ access_token: "t", expires_in: 3600 }) : Response.json({ range: "x" });
    assert.deepEqual(await readRange("id", "A1"), []);
    globalThis.fetch = async url => String(url).includes("oauth2") ? Response.json({ access_token: "t", expires_in: 3600 }) : new Response("no", { status: 403 });
    await assert.rejects(readRange("id", "A1"), /403/);
  } finally { globalThis.fetch = realFetch; }
});

test("readGrid asks for cell text and fill only, and turns Google's 0..1 floats into #rrggbb", async () => {
  process.env.GOOGLE_SA_EMAIL = "bot@example.com";
  process.env.GOOGLE_SA_KEY = pem;
  const realFetch = globalThis.fetch, urls = [];
  const grid = { sheets: [{ data: [{ rowData: [
    { values: [{ formattedValue: "2026-11-19T14:00:00Z" }, { formattedValue: "Alice" },
      { formattedValue: "✓", userEnteredFormat: { backgroundColor: { red: 217 / 255, green: 85 / 255, blue: 47 / 255 } } },
      { formattedValue: "✓", userEnteredFormat: { backgroundColor: { green: 1 } } }, {}] },
    {},
  ] }] }] };
  globalThis.fetch = async url => { urls.push(String(url)); return String(url).includes("oauth2") ? Response.json({ access_token: "t", expires_in: 3600 }) : Response.json(grid); };
  try {
    const rows = await readGrid("sheet1", "'Progress'!A2:AC");
    assert.deepEqual(rows, [[{ v: "2026-11-19T14:00:00Z", bg: null }, { v: "Alice", bg: null }, { v: "✓", bg: "#d9552f" }, { v: "✓", bg: "#00ff00" }, { v: "", bg: null }], []]);
    const read = new URL(urls.find(u => u.includes("sheets.googleapis.com")));
    assert.equal(read.pathname, "/v4/spreadsheets/sheet1");
    assert.equal(read.searchParams.get("includeGridData"), "true");
    assert.equal(read.searchParams.get("ranges"), "'Progress'!A2:AC");
    assert.equal(read.searchParams.get("fields"), "sheets(data(rowData(values(formattedValue,userEnteredFormat(backgroundColor)))))");
    globalThis.fetch = async url => String(url).includes("oauth2") ? Response.json({ access_token: "t", expires_in: 3600 }) : Response.json({ sheets: [{ data: [{}] }] });
    assert.deepEqual(await readGrid("sheet1", "A2:AC"), []);
  } finally { globalThis.fetch = realFetch; }
});

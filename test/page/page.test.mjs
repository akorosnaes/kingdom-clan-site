import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = p => readFileSync(new URL(p, root), "utf8");
const html = read("turkey-trot.html");
const S = JSON.parse(read("turkey-trot/board/spots.json"));
const turkeys = JSON.parse(read("turkey-trot/turkeys.json"));
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
const pageScript = scripts.find(s => s.includes("turkey-trot/board/spots.json"));

test("every inline script compiles", () => {
  scripts.forEach(s => new vm.Script(s));
});

test("the page has the Turkey Trot content and none of the left-out items", () => {
  assert.match(html, /<title>Turkey Trot \| Kingdom<\/title>/);
  assert.match(html, /src="turkey-trot\/board\/board\.png"/);
  assert.match(html, /<h1 class="sr">Turkey Trot<\/h1>/);
  assert.doesNotMatch(html, /class="phero"|class="how"|submiteventdrop/);
  assert.match(html, /<symbol id="turkey"/);
  assert.doesNotMatch(html, /countdown|milestone|halfway|<time/i);
  assert.match(html, /og:url" content="https:\/\/kingdomosrs\.com\/turkey-trot\.html"/);
});

test("every page links to Turkey Trot once, and only the new page marks it current", () => {
  for (const f of readdirSync(root).filter(f => f.endsWith(".html"))) {
    const text = read(f);
    assert.equal(text.split('href="turkey-trot.html">Turkey Trot</a>').length - 1, 1, f);
    const on = text.includes('<a class="on" href="turkey-trot.html">');
    assert.equal(on, f === "turkey-trot.html", f);
  }
  assert.match(read("sitemap.xml"), /turkey-trot\.html/);
  assert.match(read("robots.txt"), /Allow: \/api\/turkey-trot\$/);
});

// A just-enough DOM to run the page script
class El {
  constructor(tag){
    this.tag = tag; this.children = []; this.parent = null; this.attrs = {}; this.cls = new Set();
    this.style = { props: {}, setProperty(k, v){ this.props[k] = v; } };
    this.textContent = ""; this.hidden = false; this.tabIndex = -1;
  }
  get className(){ return [...this.cls].join(" "); }
  set className(v){ this.cls = new Set(v.split(/\s+/).filter(Boolean)); }
  get classList(){
    const c = this.cls;
    return { add: n => c.add(n), remove: n => c.delete(n), contains: n => c.has(n), toggle: (n, on) => (on ? c.add(n) : c.delete(n)) };
  }
  set innerHTML(h){
    El.html.push(h);
    this.children = [];
    if (h.includes("<svg")) this.append(new El("svg"));
    if (h.includes("<b>")) this.append(new El("b"));
    if (h.includes('class="tip"')) { const t = new El("span"); t.className = "tip"; this.append(t); }
  }
  append(...nodes){ for (const n of nodes) { const e = typeof n === "string" ? Object.assign(new El("#text"), { textContent: n }) : n; e.parent?.children.splice(e.parent.children.indexOf(e), 1); e.parent = this; this.children.push(e); } }
  replaceChildren(...nodes){ this.children = []; this.append(...nodes); }
  remove(){ this.parent?.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  querySelector(sel){ return this.children.find(c => sel[0] === "." ? c.cls.has(sel.slice(1)) : c.tag === sel) ?? null; }
  setAttribute(k, v){ this.attrs[k] = String(v); }
  getAttribute(k){ return this.attrs[k] ?? null; }
  removeAttribute(k){ delete this.attrs[k]; }
}
El.html = [];

function boot({ api }){
  El.html = [];
  const byId = Object.fromEntries(["board", "note", "rows", "results", "empty"].map(id => [id, new El(id === "rows" ? "tbody" : "div")]));
  byId.results.hidden = byId.empty.hidden = true;
  const timers = [], frames = [], listeners = {}, motion = { matches: false };
  const doc = { hidden: false, getElementById: id => byId[id], createElement: t => new El(t), addEventListener: (e, f) => { listeners[e] = f; } };
  const calls = [];
  const sandbox = {
    document: doc, location: { search: "" }, matchMedia: () => motion, performance: { now: () => 0 },
    requestAnimationFrame: f => frames.push(f), setTimeout: f => timers.push(f), clearTimeout: () => {},
    AbortSignal, URLSearchParams, Promise, Object, Math, Map, Set, Array, Number, String, JSON, Error, Response,
    fetch: async url => {
      calls.push(String(url));
      if (url === "turkey-trot/board/spots.json") return Response.json(S);
      if (url === "turkey-trot/turkeys.json") return Response.json(turkeys);
      const body = api();
      if (body instanceof Error) throw body;
      return Response.json(body);
    },
  };
  const window = {};
  vm.runInNewContext(read("turkey-trot/board/board-hook.js"), { window });
  sandbox.TrotBoard = window.TrotBoard;
  vm.runInNewContext(pageScript, sandbox);
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  // Runs animation frames 50 ms apart until the walks are over
  const walkAll = () => { let now = 0, n = 0; while (frames.length && n++ < 3000) { const q = frames.splice(0); now += 50; q.forEach(f => f(now)); } return n; };
  const poll = async () => { timers.pop()(); await settle(); };
  const board = byId.board;
  const tk = () => board.children.filter(c => c.cls.has("tk") && !c.cls.has("idle"));
  const idle = () => board.children.filter(c => c.cls.has("idle"));
  const tip = el => el.querySelector(".tip").textContent;
  return { byId, board, tk, idle, tip, settle, walkAll, poll, motion, calls, frames, timers, listeners, doc };
}

const px = v => (v * 100).toFixed(3) + "%";
const player = (rsn, icon, progress, color = "#d9552f") => ({ rsn, icon, color, progress, reachedAt: null });
const drops = [{ n: 1, name: "Dragon pickaxe" }, { n: 2, name: "Abyssal whip" }];
const find = (tk, tipText) => tk.find(e => e.querySelector(".tip").textContent === tipText);

test("first load places turkeys without walking and fills the table, spots and Start stack", async () => {
  const data = { players: [player("Dee", 4, 26), player("Amy", 5, 3), player("Bo", 6, 3), player("Cy", 7, 0)], drops };
  const page = boot({ api: () => data });
  await page.settle();
  assert.equal(page.frames.length, 0);
  assert.equal(page.tk().length, 3);
  assert.equal(page.idle().length, 2);
  assert.equal(page.board.children.filter(c => c.cls.has("sp")).length, 27);
  const amy = find(page.tk(), "Amy - 3/26");
  assert.ok(amy && find(page.tk(), "Bo - 3/26") && find(page.tk(), "Dee - 26/26"));
  assert.match(amy.style.left, /^\d+\.\d+%$/);
  assert.equal(amy.querySelector("b").textContent, "A");
  assert.equal(amy.attrs["aria-label"], "Amy - 3/26");
  assert.equal(amy.tabIndex, 0);
  assert.equal(amy.cls.has("r"), S.spots[3].faceIn === "right");
  assert.equal(page.idle()[0].attrs["aria-hidden"], "true");
  assert.equal(page.idle()[0].tabIndex, -1);
  const spotTips = page.board.children.filter(c => c.cls.has("sp")).map(page.tip);
  assert.deepEqual([spotTips[0], spotTips[1], spotTips[2], spotTips[3]], ["Start", "#1 Dragon pickaxe", "#2 Abyssal whip", "#3"]);
  const text = el => String(el.textContent || "") + el.children.map(text).join("");
  assert.deepEqual(page.byId.rows.children.map(r => r.children.map(text)), [["1", "Dee", "26/26"], ["2", "Amy", "3/26"], ["3", "Bo", "3/26"]]);
  assert.equal(page.byId.results.hidden, false);
  assert.equal(page.byId.empty.hidden, true);
  assert.equal(page.timers.length, 1);
  assert.equal(page.calls.at(-1), "/api/turkey-trot");
  // The shared turkey symbol is drawn from 0,0, so each turkey svg must start at 0,0 or part of the turkey is cut off
  assert.ok(El.html.some(h => h.includes('<svg viewBox="0 0 326 329"')));
  assert.ok(El.html.every(h => !h.includes('viewBox="156')));
});

test("later changes walk along the route and an idle turkey takes over for a new player", async () => {
  let data = { players: [player("Amy", 5, 3), player("Bo", 6, 3)], drops };
  const page = boot({ api: () => data });
  await page.settle();
  const [idle1] = page.idle();
  data = { players: [player("Amy", 5, 5), player("Cy", 7, 1), player("Di", 8, 4)], drops };
  await page.poll();
  assert.ok(page.frames.length > 0, "walks are animated");
  assert.equal(page.tk().length, 3);
  page.walkAll();
  assert.equal(page.idle().length, 2);
  assert.ok(!page.idle().includes(idle1));
  assert.ok(page.tk().includes(idle1), "the front idle turkey became a player");
  const amy = find(page.tk(), "Amy - 5/26"), cy = find(page.tk(), "Cy - 1/26"), di = find(page.tk(), "Di - 4/26");
  assert.ok(amy && cy && di, page.tk().map(page.tip).join(", "));
  assert.equal(find(page.tk(), "Bo - 3/26"), undefined);
  assert.equal(amy.cls.has("walking"), false);
  const hook = {};
  vm.runInNewContext(read("turkey-trot/board/board-hook.js"), { window: hook });
  const where = hook.window ?? hook, L = where.TrotBoard.layout(S, [{ rsn: "Amy", icon: 5, progress: 5 }, { rsn: "Cy", icon: 7, progress: 1 }, { rsn: "Di", icon: 8, progress: 4 }]);
  assert.equal(amy.style.left, px(L.place.Amy.x / S.size[0]));
  assert.equal(amy.style.top, px(L.place.Amy.y / S.size[1]));
  assert.equal(di.style.left, px(L.place.Di.x / S.size[0]));
  assert.equal(cy.querySelector("b").textContent, "C");
  assert.equal(cy.cls.has("r"), S.spots[1].faceIn === "right");
  assert.equal(page.byId.rows.children.length, 3);
});

test("with reduced motion nothing walks", async () => {
  let data = { players: [player("Amy", 5, 3)], drops };
  const page = boot({ api: () => data });
  await page.settle();
  page.motion.matches = true;
  data = { players: [player("Amy", 5, 9), player("New", 6, 2)], drops };
  await page.poll();
  assert.equal(page.frames.length, 0);
  assert.ok(find(page.tk(), "Amy - 9/26") && find(page.tk(), "New - 2/26"));
});

test("a player who moves back jumps and one at 0 leaves the board", async () => {
  let data = { players: [player("Amy", 5, 9), player("Bo", 6, 4)], drops };
  const page = boot({ api: () => data });
  await page.settle();
  data = { players: [player("Amy", 5, 2), player("Bo", 6, 0)], drops };
  await page.poll();
  assert.equal(page.frames.length, 0);
  assert.deepEqual(page.tk().map(page.tip), ["Amy - 2/26"]);
});

test("a failed refresh keeps the board and says so; a failed first load says so too", async () => {
  let data = { players: [player("Amy", 5, 3)], drops };
  const page = boot({ api: () => data });
  await page.settle();
  data = new Error("down");
  await page.poll();
  assert.match(page.byId.note.textContent, /Couldn't refresh/);
  assert.equal(page.tk().length, 1);
  const fresh = boot({ api: () => new Error("down") });
  await fresh.settle();
  assert.match(fresh.byId.note.textContent, /Couldn't load the standings/);
  assert.equal(fresh.idle().length, 2);
  assert.equal(fresh.timers.length, 1);
});

test("an empty result shows the empty message; junk entries are ignored", async () => {
  const page = boot({ api: () => ({ players: [null, { rsn: 5 }, { rsn: "X", icon: 99, progress: 1 }, { rsn: "Y", icon: 2, progress: 40 }], drops: "no" }) });
  await page.settle();
  assert.equal(page.tk().length, 0);
  assert.equal(page.byId.empty.hidden, false);
  assert.equal(page.byId.results.hidden, true);
});

test("text from the API only goes in through textContent", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const page = boot({ api: () => ({ players: [player(evil, 3, 4, "red;background:url(x)")], drops: [{ n: 4, name: evil }] }) });
  await page.settle();
  assert.ok(El.html.every(h => !h.includes("<img")), "never in innerHTML");
  const t = page.tk()[0];
  assert.equal(page.tip(t), `${evil} - 4/26`);
  const dot = page.byId.rows.children[0].children[1].children[0];
  assert.equal(dot.style.background, "#888888");
});

test("polling stops while the tab is hidden and resumes on return", async () => {
  const page = boot({ api: () => ({ players: [], drops: [] }) });
  await page.settle();
  const before = page.calls.length;
  page.doc.hidden = true; page.listeners.visibilitychange();
  page.doc.hidden = false; page.listeners.visibilitychange();
  await page.settle();
  assert.equal(page.calls.length, before + 1);
});

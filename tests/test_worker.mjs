// Node-Test für worker/worker.mjs (ohne Cloudflare): Auth, Merkliste, Telegram-Weiterleitung, Zeitauslöser
import assert from "assert";
import worker from "../worker/worker.mjs";

const kv = new Map(), meta = new Map();
const env = { ACCESS_PASSWORD: "pw", GH_TOKEN: "t", TG_SECRET: "s", GH_REPO: "a/b", TELEGRAM_CHAT_ID: "42",
  WL: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v, o) => { kv.set(k, v); if (o?.metadata) meta.set(k, o.metadata); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: meta.get(name) })) }) } };
const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return new Response(null, { status: 204 }); };
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const req = (path, init = {}) => new Request("https://w.example" + path, init);

let r = await worker.fetch(req("/api/watchlist"), env, ctx);
assert.strictEqual(r.status, 401, "ohne Passwort");
r = await worker.fetch(req("/api/watchlist", { headers: { "x-key": "falsch" } }), env, ctx);
assert.strictEqual(r.status, 401);
r = await worker.fetch(req("/api/watchlist", { headers: { "x-key": "pw" } }), env, ctx);
assert.deepStrictEqual(await r.json(), { rules: [], groups: {} });
r = await worker.fetch(req("/api/watchlist", { method: "PUT", headers: { "x-key": "pw" }, body: JSON.stringify({ rules: [{ name: "A" }] }) }), env, ctx);
assert.strictEqual((await r.json()).count, 1);
r = await worker.fetch(req("/api/watchlist", { headers: { "x-key": "pw" } }), env, ctx);
assert.strictEqual((await r.json()).rules[0].name, "A");
r = await worker.fetch(req("/api/watchlist", { method: "PUT", headers: { "x-key": "pw" }, body: "{}" }), env, ctx);
assert.strictEqual(r.status, 400);

// Löschen: ohne doppelte Bestätigung abgelehnt, mit ihr erlaubt - und der alte Stand bleibt erhalten
const put = (rules, extra = {}) => worker.fetch(req("/api/watchlist", { method: "PUT", headers: { "x-key": "pw", ...extra }, body: JSON.stringify({ rules }) }), env, ctx);
await put([{ name: "A" }, { name: "B" }]);
r = await put([{ name: "A" }]);
assert.strictEqual(r.status, 409, "weniger Regeln ohne Bestätigung abgelehnt");
r = await put([{ name: "A" }], { "x-confirm-delete": "2" });
assert.strictEqual(r.status, 200);
r = await worker.fetch(req("/api/history", { headers: { "x-key": "pw" } }), env, ctx);
const hist = await r.json();
assert.ok(hist.length >= 2, "Versionen vorhanden");
const versions = await Promise.all(hist.map(async (h) => (await worker.fetch(req("/api/history?id=" + encodeURIComponent(h.id), { headers: { "x-key": "pw" } }), env, ctx)).json()));
assert.ok(versions.some((v) => JSON.stringify(v.rules.map((x) => x.name)) === '["A","B"]'), "gelöschte Regel B ist wiederherstellbar");
r = await worker.fetch(req("/api/history"), env, ctx); assert.strictEqual(r.status, 401);

const tg = (chat, secret = "s") => req("/tg", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ message: { chat: { id: chat }, text: "Knivshult Hamburg" } }) });
await worker.fetch(tg(42, "falsch"), env, ctx);
await worker.fetch(tg(99), env, ctx);
await Promise.all(pending);
assert.strictEqual(calls.length, 0, "falscher Absender/Secret wird ignoriert");
await worker.fetch(tg(42), env, ctx);
await Promise.all(pending);
assert.strictEqual(calls.length, 1);
assert.ok(calls[0].url.endsWith("/repos/a/b/actions/workflows/bot.yml/dispatches"));
assert.strictEqual(calls[0].body.inputs.text, "Knivshult Hamburg"); assert.strictEqual(calls[0].auth, "Bearer t");

await worker.scheduled({}, env, ctx); await Promise.all(pending);
assert.ok(calls[1].url.endsWith("/scrape.yml/dispatches"));

// Diagnose: Status zeigt Konfiguration und letztes Ergebnis; Fehler werden erklärt
let st = await (await worker.fetch(req("/api/status", { headers: { "x-key": "pw" } }), env, ctx)).json();
assert.strictEqual(st.config.GH_TOKEN, true); assert.strictEqual(st.scrape.ok, true); assert.strictEqual(st.telegram.ok, true);
globalThis.fetch = async () => new Response("no", { status: 403 });
await worker.scheduled({}, env, ctx); await Promise.all(pending);
st = await (await worker.fetch(req("/api/status", { headers: { "x-key": "pw" } }), env, ctx)).json();
assert.strictEqual(st.scrape.ok, false); assert.match(st.scrape.error, /Berechtigung/);
const noTok = { ...env, GH_TOKEN: "" };
await worker.scheduled({}, noTok, ctx); await Promise.all(pending);
st = await (await worker.fetch(req("/api/status", { headers: { "x-key": "pw" } }), env, ctx)).json();
assert.match(st.scrape.error, /GH_TOKEN/);
console.log("worker: alle Tests bestanden");
{
  const r2 = await worker.fetch(new Request("https://w.example/api/ping"), { ...env, ACCESS_PASSWORD: "" }, { waitUntil() {} });
  const pj = await r2.json();
  if (pj.config.ACCESS_PASSWORD !== false || pj.config.GH_TOKEN !== true || JSON.stringify(pj).includes('"t"')) throw new Error("ping");
  console.log("worker: ping ok");
}

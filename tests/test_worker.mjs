// Node-Test für worker/worker.mjs (ohne Cloudflare): Auth, Merkliste, Telegram-Weiterleitung, Zeitauslöser
import assert from "assert";
import worker from "../worker/worker.mjs";

const kv = new Map();
const env = { ACCESS_PASSWORD: "pw", GH_TOKEN: "t", TG_SECRET: "s", GH_REPO: "a/b", TELEGRAM_CHAT_ID: "42",
  WL: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
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
console.log("worker: alle Tests bestanden");

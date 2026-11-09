// Node-Test: Browser-Abgleich (docs/core.js) verhält sich wie tracker/merge.py
const assert = require("assert");
const ZC = require("../docs/core.js");
const g = (store, title, art, orig, offers) => ({ storeId: store, title, description: "Regal, weiß", articleNumbers: [art], originalPrice: orig, offers });
const o = (uuid, num, price, cond = "Gut", reason = "Kratzer") => ({ offerUuid: uuid, offerNumber: num, price, productConditionTitle: cond, reasonDiscount: reason });
const stores = [{ id: "148", name: "Berlin-Lichtenberg" }, { id: "124", name: "Hannover EXPO Park" }];
const state = { db: {}, events: [], runs: [], updated: null, stores: [] };
let h = 0;
const snap = (results) => ({ fetched_at: `2026-05-01T${String(h++).padStart(2, "0")}:00:00.000Z`, stores, results });
const ok = (content) => ({ ok: true, content });

let r = ZC.ingestSnapshot(state, snap({ "148": ok([g("148", "KALLAX", "802.758.87", 50, [o("a", "1001", 35), o("b", "1002", 35), o("b", "1002", 35)])]), "124": ok([]) }));
assert.strictEqual(Object.keys(state.db).length, 2, "Duplikate verworfen, zwei Einzelstücke");
const a = state.db["u:a"];
assert.strictEqual(a.discount_eur, 15); assert.strictEqual(a.discount_pct, 30); assert.strictEqual(a.article_number, "80275887");
assert.ok(a.link.endsWith("#/berlinlichtenberg/1001"), a.link);
assert.strictEqual(a.first_seen, "2026-05-01T00:00:00+00:00");

// Markt fällt aus -> nichts archivieren
for (let i = 0; i < 3; i++) ZC.ingestSnapshot(state, snap({ "148": { ok: false, error: "timeout" }, "124": ok([]) }));
assert.strictEqual(state.db["u:b"].status, "active");

// b fehlt, a billiger
const c1 = [g("148", "KALLAX", "802.758.87", 50, [o("a", "1001", 29)])];
ZC.ingestSnapshot(state, snap({ "148": ok(c1), "124": ok([]) }));
assert.strictEqual(state.db["u:b"].status, "active", "einmal fehlen reicht nicht");
assert.strictEqual(state.db["u:a"].price_history.length, 2);
ZC.ingestSnapshot(state, snap({ "148": ok(c1), "124": ok([]) }));
assert.strictEqual(state.db["u:b"].status, "gone");
assert.strictEqual(state.db["u:b"].gone_at, "2026-05-01T00:00:00+00:00", "gone_at = zuletzt gesehen");

// b wieder da
ZC.ingestSnapshot(state, snap({ "148": ok([g("148", "KALLAX", "802.758.87", 50, [o("a", "1001", 29), o("b", "1002", 35)])]), "124": ok([]) }));
assert.strictEqual(state.db["u:b"].status, "active"); assert.strictEqual(state.db["u:b"].reappear_count, 1);
assert.strictEqual(Object.keys(state.db).length, 2);
const types = new Set(state.events.map((e) => e.type));
for (const t of ["new", "price_change", "gone", "reappeared"]) assert.ok(types.has(t), t);

// alter Snapshot wird abgelehnt
assert.throws(() => ZC.ingestSnapshot(state, { fetched_at: "2026-04-01T00:00:00Z", stores, results: {} }));

// unplausibel leerer Markt
const s2 = { db: {}, events: [], runs: [], updated: null, stores: [] }; h = 0;
ZC.ingestSnapshot(s2, snap({ "148": ok([g("148", "X", "1", 10, Array.from({ length: 15 }, (_, i) => o("u" + i, String(i), 5)))]) }));
for (let i = 0; i < 3; i++) r = ZC.ingestSnapshot(s2, snap({ "148": ok([]) }));
assert.ok(Object.values(s2.db).every((x) => x.status === "active")); assert.ok(r.errors.includes("leer trotz Bestand"));

// Fallback-Schlüssel + Slug
const s3 = { db: {}, events: [], runs: [], updated: null, stores: [] };
ZC.ingestSnapshot(s3, { fetched_at: "2026-05-02T00:00:00Z", stores, results: { "124": ok([g("124", "LACK", "1", 20, [{ offerNumber: "77", price: 10 }])]) } });
assert.deepStrictEqual(Object.keys(s3.db), ["n:124:77"]); assert.ok(s3.db["n:124:77"].link.includes("hannover+expopark/77"));

// Regeln identisch zu watch.py
const m = { title: "MALM", product_description: "Kommode mit 4 Schubladen, weiß", offer_description: "", article_numbers: ["80214546"], article_number: "80214546", store_id: "148", store: "Berlin-Lichtenberg", price: 60, discount_pct: 40, condition: "Gebraucht - wie neu", reason_discount: "Kratzer an der Seite" };
assert.ok(ZC.matches({ keywords: ["malm kommode"] }, m)); assert.ok(ZC.matches({ keywords: ["weiss"] }, m));
assert.ok(ZC.matches({ article_numbers: ["802.145.46"] }, m)); assert.ok(!ZC.matches({ keywords: ["malm"], stores: ["Hamburg"] }, m));
assert.ok(ZC.matches({ keywords: ["malm"], stores: ["148"] }, m)); assert.ok(!ZC.matches({ keywords: ["malm"], min_discount_pct: 50 }, m));
assert.ok(ZC.matches({ conditions: ["kratzer"] }, m)); assert.ok(!ZC.matches({ keywords: ["malm"], exclude: ["schublade"] }, m));
assert.ok(!ZC.matches({ keywords: ["malm"], enabled: false }, m));


// Doppelte Merklisten-Regeln werden auch bei anderer Grossschreibung/Reihenfolge zusammengefuehrt.
const dupRules = ZC.dedupeRules([
  { name: "Teppich", keywords: ["Stockholm Teppich"], stores: ["245", "325"], enabled: false },
  { name: "Teppich nochmal", keywords: ["teppich stockholm"], stores: ["325", "245"] },
  { name: "PS 2026", article_numbers: ["IKEA PS 2026"] },
]);
assert.strictEqual(dupRules.length, 2);
assert.notStrictEqual(dupRules[0].enabled, false, "aktive Regel bleibt aktiv");
assert.deepStrictEqual(dupRules[1].keywords, ["IKEA PS 2026"]);
assert.deepStrictEqual(dupRules[1].article_numbers, []);

const top = ZC.topSorted([{ n: 9 }, { n: 1 }, { n: 7 }, { n: 2 }, { n: 3 }], (a, b) => a.n - b.n, 3);
assert.deepStrictEqual(top.map((x) => x.n), [1, 2, 3]);

// Python-verschluesselte Datei im Browser-Code lesen (Gegenstueck zu tracker/crypto.py + pack.py)
(async () => {
  const buf = require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample.bin"));
  const key = await ZC.importKey(await ZC.deriveKeyB64("test-passwort"));
  const packed = await ZC.openBlob(buf, key);
  const [x, y] = ZC.unpackOffers(packed, { "148": { name: "Berlin-Lichtenberg", slug: "berlinlichtenberg" } }, { "148": "2026-01-09T00:00:00+00:00" });
  assert.strictEqual(x.title, "KALLAX"); assert.strictEqual(x.article_number, "80275887");
  assert.strictEqual(x.discount_pct, 20); assert.strictEqual(x.store, "Berlin-Lichtenberg");
  assert.strictEqual(x.last_seen, "2026-01-09T00:00:00+00:00"); assert.strictEqual(x.price_history.length, 2);
  assert.ok(x.link.endsWith("#/berlinlichtenberg/7"), x.link); assert.strictEqual(x.gone_at, null);
  assert.deepStrictEqual(x.log.map((l) => l[1]), ["gone", "back"]);
  assert.deepStrictEqual(y.price_history, [["2026-01-01T00:00:00+00:00", 40]], "Standard-Preisverlauf wird ergänzt"); assert.deepStrictEqual(y.log, []);
  await assert.rejects(ZC.openBlob(buf, await ZC.importKey(await ZC.deriveKeyB64("falsch"))), "falsches Passwort");
  console.log("core.js: alle Tests bestanden");
})().catch((e) => { console.error(e); process.exit(1); });

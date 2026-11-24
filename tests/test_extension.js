// Erweiterung: lib.js muss dasselbe entpacken wie die App (docs/core.js) bzw. katalog/model.py
const assert = require("assert");
const fs = require("fs"), path = require("path");
const ZC = require("../docs/core.js"), X = require("../extension/lib.js");
(async () => {
  const fix = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n));
  const key = await X.importKey(await X.deriveKeyB64("test-passwort"));
  const packed = await X.openBlob(fix("sample.bin"), key);
  const stores = { "148": { id: "148", name: "Berlin-Lichtenberg", slug: "berlinlichtenberg" } };
  const a = ZC.unpackOffers(packed, stores), b = X.unpackOffers(packed, stores);
  assert.strictEqual(b.length, a.length);
  for (let i = 0; i < a.length; i++) {
    assert.strictEqual(b[i].id, a[i].id); assert.strictEqual(b[i].price, a[i].price); assert.deepStrictEqual(b[i].arts, a[i].article_numbers);
    assert.strictEqual(b[i].link, a[i].link); assert.strictEqual(b[i].store, a[i].store); assert.ok(Math.abs(b[i].pct - a[i].discount_pct) < 0.11, "Rabatt");
  }
  const idx = X.buildIndex(b);
  assert.ok(idx["80275887"].length >= 1);
  const kat = X.unpackKatalog(await X.openBlob(fix("katalog_sample.bin"), key));
  assert.strictEqual(Object.keys(kat).length, 4); const k = kat["90584658"];
  assert.strictEqual(k.price, 539); assert.strictEqual(k.hi, 549); assert.strictEqual(k.lo, 539); assert.strictEqual(k.changes, 1);
  assert.ok(kat["s29490102"], "Sets mit s-Präfix");
  assert.strictEqual(X.artFromUrl("https://www.ikea.com/de/de/p/knivshult-schublade-hoch-dunkelgrau-70600664/"), "70600664");
  assert.strictEqual(X.artFromUrl("https://www.ikea.com/de/de/p/kivik-sofa-s29490102/?x=1"), "s29490102");
  assert.strictEqual(X.artFromUrl("https://www.ikea.com/de/de/cat/sofas-700640/"), null);
  console.log("extension: alle Tests bestanden");
})().catch((e) => { console.error(e); process.exit(1); });

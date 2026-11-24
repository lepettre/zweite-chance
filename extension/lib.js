/* Gemeinsame Funktionen der Erweiterung (Entschlüsseln + Entpacken). Gegenstück zu docs/core.js und katalog/model.py;
 * tests/test_extension.js prüft, dass beide dasselbe ergeben. */
(function (root) {
  "use strict";
  const ITERATIONS = 250000, SALT = new TextEncoder().encode("zc-site-v1");
  const IKEA_PAGE = "https://www.ikea.com/de/de/second-hand/buy-from-ikea/";
  const toB64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKeyB64(password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return toB64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: SALT, iterations: ITERATIONS }, base, 256)));
  }
  const importKey = (b64) => crypto.subtle.importKey("raw", fromB64(b64), "AES-GCM", false, ["decrypt"]);
  async function openBlob(buf, key) {
    const u = new Uint8Array(buf);
    if (u[0] !== 90 || u[1] !== 67 || u[2] !== 49) throw new Error("Unbekanntes Dateiformat");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(3, 15) }, key, u.slice(15));
    return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
  }

  // Fundgrube: nur die Felder, die die Erweiterung anzeigt
  function unpackOffers(d, stores) {
    if (!d) return [];
    const T = d.s, ix = Object.fromEntries(d.f.map((f, i) => [f, i])), g = (row, f) => T[row[ix[f]]], out = [];
    for (const row of d.r) {
      const sid = g(row, "store_id"), st = stores[sid] || {};
      const offerNo = g(row, "offer_number"), price = row[ix.price], orig = row[ix.original_price];
      const arts = g(row, "article_numbers").split(",").filter(Boolean);
      const disc = orig && price != null ? Math.round((1 - price / orig) * 1000) / 10 : null;
      out.push({ id: g(row, "id"), arts, store: st.name || sid, store_id: sid, title: g(row, "title"), desc: g(row, "product_description"),
        condition: g(row, "condition"), reason: g(row, "reason_discount"), price, orig, pct: disc, status: g(row, "status"),
        first_seen: g(row, "first_seen"), link: st.slug ? `${IKEA_PAGE}#/${st.slug}/${offerNo}` : IKEA_PAGE });
    }
    return out;
  }

  // Katalog: Artikelnummer -> Preisangaben
  function unpackKatalog(d) {
    if (!d) return {};
    const T = d.s, ix = Object.fromEntries(d.f.map((f, i) => [f, i])), out = {};
    for (const row of d.r) {
      const no = T[row[ix.no]], ph = T[row[ix.ph]] ? JSON.parse(T[row[ix.ph]]) : [[T[row[ix.first_seen]], row[ix.price]]];
      const vs = ph.map((p) => p[1]).filter((v) => v != null), key = (T[row[ix.type]] === "SPR" ? "s" : "") + no;
      out[key] = { name: T[row[ix.name]], price: row[ix.price], prev: row[ix.prev], lo: Math.min(...vs), hi: Math.max(...vs), changes: ph.length - 1,
        since: T[row[ix.first_seen]], last_change: ph.length > 1 ? ph[ph.length - 1][0] : null, status: T[row[ix.status]], last: row[ix.last] === 1 };
    }
    return out;
  }

  function buildIndex(offers) {
    const by = {};
    for (const o of offers) if (o.status === "active") for (const a of o.arts) (by[a] ||= []).push(o);
    for (const a of Object.keys(by)) by[a].sort((x, y) => (x.price ?? 1e9) - (y.price ?? 1e9));
    return by;
  }
  // Artikelnummer aus der Produktadresse: .../p/name-70600664/ oder .../p/name-s69012345/
  const artFromUrl = (url) => { const m = /-(s?\d{8})\/?(?:[?#].*)?$/.exec(url); return m ? m[1] : null; };

  const api = { deriveKeyB64, importKey, openBlob, unpackOffers, unpackKatalog, buildIndex, artFromUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ZCX = api;
})(typeof self !== "undefined" ? self : globalThis);

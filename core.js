/* Zweite-Chance-Monitor – reine Logik (Browser + Node-Tests).
 * Spiegelt tracker/normalize.py, tracker/merge.py und tracker/watch.py. */
(function (root) {
  "use strict";
  const IKEA_PAGE = "https://www.ikea.com/de/de/second-hand/buy-from-ikea/";
  const GONE_AFTER = 2, SUSPICIOUS_EMPTY_MIN = 10;
  const KNOWN_SLUGS = ["augsburg","berlinlichtenberg","berlinspandau","berlintempelhof","berlinwaltersdorf","bielefeld","braunschweig","bremerhaven","brinkum","chemnitz","dortmund","dresden","duisburg","düsseldorf","erfurt","essen","frankfurt","freiburg","halleleipzig","hamburgaltona","hamburgmoorfleet","hamburgschnelsen","hanau","hannover+expopark","hannovergroßburgwedel","kaarst","kaiserslautern","kamen","karlsruhe","kassel","kiel","koblenz","kölnam+butzweilerhof","kölngodorf","lübeck","ludwigsburg","magdeburg","mannheim","münchenbrunnthal","müncheneching","nürnbergfürth","oldenburg","osnabrück","regensburg","rostock","saarlouis","siegen","sindelfingen","ulm","wallau","walldorf","wetzlar","wuppertal","würzburg"];

  const alnum = (s) => String(s || "").toLowerCase().replace(/[^0-9a-zäöüß]/g, "");
  const storeName = (n) => String(n || "").replace(/^IKEA\s+/i, "").replace(/\s+/g, " ").trim();
  function storeSlug(name) {
    const a = alnum(name);
    const k = KNOWN_SLUGS.find((s) => alnum(s) === a);
    return k || String(name).toLowerCase().replace(/[-/]/g, "").trim().replace(/\s+/g, "+");
  }
  const offerLink = (slug, num) => slug && num ? `${IKEA_PAGE}#/${slug}/${num}` : slug ? `${IKEA_PAGE}#/${slug}` : IKEA_PAGE;

  function fold(t) {
    return String(t || "").toLocaleLowerCase("de").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
      .replace(/ß/g, "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }
  const normArticle = (n) => String(n || "").replace(/\D/g, "");
  const fmtArticle = (n) => { const d = normArticle(n); return d.length === 8 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}` : (n || ""); };
  const num = (v) => { if (v === null || v === undefined || v === "") return null; const f = Number(v); return Number.isFinite(f) ? Math.round(f * 100) / 100 : null; };
  function txt(v) {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.filter(Boolean).map(txt).join("; ");
    if (typeof v === "object") return Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${k}: ${txt(x)}`).join("; ");
    return String(v).replace(/\s+/g, " ").trim();
  }
  const DESCRIPTIVE = ["title","product_description","offer_description","condition","condition_description","reason_discount","additional_info","original_price"];
  const pyStr = (v) => v === null || v === undefined ? "None" : typeof v === "number" ? (Number.isInteger(v) ? v.toFixed(1) : String(v)) : String(v);
  const contentHash = (r) => DESCRIPTIVE.map((k) => pyStr(r[k] ?? "")).join("\x1f"); // lokal: Klartext statt SHA1

  function offerKey(sid, o) {
    if (o.offerUuid) return `u:${o.offerUuid}`;
    if (o.offerNumber) return `n:${sid}:${o.offerNumber}`;
    if (o.id) return `i:${sid}:${o.id}`;
    return null;
  }

  function flatten(content, storeId, stores) {
    const out = [];
    for (const g of content || []) {
      const sid = String(g.storeId || storeId);
      const st = stores[sid] || { name: sid, slug: null };
      const arts = (g.articleNumbers || []).filter(Boolean).map(normArticle);
      const orig = num(g.originalPrice);
      for (const o of g.offers || []) {
        const id = offerKey(sid, o); if (!id) continue;
        const price = num(o.price);
        const disc = orig !== null && price !== null ? Math.round((orig - price) * 100) / 100 : null;
        const pct = disc !== null && orig ? Math.round(disc / orig * 1000) / 10 : null;
        out.push({
          id, offer_uuid: o.offerUuid || "", offer_number: String(o.offerNumber || ""), store_id: sid, store: st.name,
          title: txt(g.title), product_description: txt(g.description), offer_description: txt(o.description),
          article_number: arts[0] || "", article_numbers: arts, condition: txt(o.productConditionTitle),
          condition_code: txt(o.productConditionCode), condition_description: txt(o.productConditionDescription),
          reason_discount: txt(o.reasonDiscount), additional_info: txt(o.additionalInfo), price, original_price: orig,
          discount_eur: disc, discount_pct: pct, currency: g.currency || "EUR", image: g.heroImage || "",
          link: offerLink(st.slug, String(o.offerNumber || "")),
        });
      }
    }
    return out;
  }

  function plausible(sid, nSeen, db) {
    if (nSeen > 0) return true;
    let a = 0; for (const o of Object.values(db)) if (o.store_id === sid && o.status === "active") a++;
    return a < SUSPICIOUS_EMPTY_MIN;
  }

  function merge(db, records, okStores, ts) {
    const events = [], seen = new Set();
    const ev = (o, type, extra = {}) => events.push({ ts, type, id: o.id, store_id: o.store_id, article_number: o.article_number || "", title: o.title || "", price: o.price, ...extra });
    for (const r of records) {
      if (seen.has(r.id)) continue; seen.add(r.id);
      const h = contentHash(r); let o = db[r.id];
      if (!o) {
        o = db[r.id] = { ...r, first_seen: ts, last_seen: ts, gone_at: null, status: "active", missing_runs: 0, times_seen: 1, reappear_count: 0, hash: h, price_history: [[ts, r.price]] };
        ev(o, "new"); continue;
      }
      if (o.status === "gone") { o.status = "active"; o.gone_at = null; o.reappear_count = (o.reappear_count || 0) + 1; ev(o, "reappeared"); }
      if (r.price !== o.price) { ev(o, "price_change", { old_price: o.price, new_price: r.price }); (o.price_history ||= []).push([ts, r.price]); }
      if (h !== o.hash) {
        const changed = ["title","condition","condition_description","reason_discount","additional_info","offer_description","original_price"].filter((k) => String(r[k] ?? "") !== String(o[k] ?? ""));
        if (changed.length) ev(o, "changed", { fields: changed.join(",") });
      }
      const keep = { first_seen: o.first_seen, gone_at: o.gone_at, status: o.status, times_seen: o.times_seen, reappear_count: o.reappear_count, price_history: o.price_history };
      for (const k of Object.keys(o)) delete o[k];
      Object.assign(o, r, keep, { hash: h, last_seen: ts, missing_runs: 0, times_seen: (keep.times_seen || 0) + 1 });
    }
    for (const o of Object.values(db)) {
      if (o.status !== "active" || seen.has(o.id) || !okStores.has(o.store_id)) continue;
      o.missing_runs = (o.missing_runs || 0) + 1;
      if (o.missing_runs >= GONE_AFTER) { o.status = "gone"; o.gone_at = o.last_seen; ev(o, "gone"); }
    }
    return events;
  }

  /** Snapshot (Lesezeichen-Format) in lokalen Bestand einspielen. */
  function ingestSnapshot(state, snap) {
    const ts = String(snap.fetched_at).replace(/\.\d+/, "").replace(/Z$/, "+00:00");
    if (state.updated && ts <= state.updated) throw new Error(`Snapshot (${ts}) ist nicht neuer als der lokale Bestand (${state.updated}).`);
    const stores = {};
    for (const s of snap.stores || []) stores[String(s.id)] = { id: String(s.id), name: s.name, slug: s.slug || storeSlug(s.name) };
    const records = [], ok = new Set(), errors = [];
    for (const [sid, res] of Object.entries(snap.results || {})) {
      if (!res.ok) { errors.push(`${stores[sid]?.name || sid}: ${res.error || "?"}`); continue; }
      const recs = flatten(res.content, sid, stores);
      if (plausible(sid, recs.length, state.db)) ok.add(sid); else errors.push(`${stores[sid]?.name}: leer trotz Bestand`);
      records.push(...recs);
    }
    const events = merge(state.db, records, ok, ts);
    state.events.push(...events);
    state.updated = ts;
    const counts = {}; for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
    const run = { ts, source: snap.source || "bookmarklet", stores_total: Object.keys(stores).length, stores_ok: ok.size, offers_seen: records.length, ...counts, errors: errors.join(" | ") };
    state.runs.push(run);
    state.stores = Object.values(stores).map((s) => ({ ...s, last_ok: ok.has(s.id) ? ts : null }));
    return run;
  }

  const list = (v) => v === null || v === undefined ? [] : Array.isArray(v) ? v : [v];
  function cleanRule(rule) {
    const r = { ...rule };
    const words = [...list(r.keywords).filter(Boolean)];
    const arts = [];
    for (const a of list(r.article_numbers).filter(Boolean)) {
      const digits = normArticle(a);
      if (digits.length === 8) arts.push(digits);
      else words.push(String(a).trim());
    }
    r.keywords = words; r.article_numbers = arts;
    return r;
  }
  function ruleKey(rule) {
    const r = cleanRule(rule);
    const uniq = (xs, fn) => [...new Set(xs.map(fn).filter(Boolean))].sort();
    const kw = uniq(r.keywords, (x) => fold(x).split(/\s+/).filter(Boolean).sort().join(" "));
    const fields = [kw, uniq(r.exclude || [], fold), uniq(r.article_numbers || [], normArticle),
      uniq(r.stores || [], (x) => fold(String(x))),
      r.min_discount_pct === null || r.min_discount_pct === undefined || r.min_discount_pct === "" ? "" : Number(r.min_discount_pct),
      r.max_price === null || r.max_price === undefined || r.max_price === "" ? "" : Number(r.max_price),
      uniq(r.conditions || [], fold)];
    return JSON.stringify(fields);
  }
  function dedupeRules(rules) {
    const out = [], indexes = new Map();
    for (const input of rules || []) {
      const rule = cleanRule(input), key = ruleKey(rule);
      if (!indexes.has(key)) { indexes.set(key, out.length); out.push(rule); continue; }
      const i = indexes.get(key);
      if (out[i].enabled === false && rule.enabled !== false) out[i] = rule;
    }
    return out;
  }
  function topSorted(list, compare, limit) {
    if (list.length <= limit) return list.slice().sort(compare);
    const a = list.slice(); let left = 0, right = a.length - 1, target = limit - 1;
    while (left < right) {
      const pivot = a[(left + right) >> 1]; let i = left, j = right;
      while (i <= j) {
        while (compare(a[i], pivot) < 0) i++;
        while (compare(a[j], pivot) > 0) j--;
        if (i <= j) { [a[i], a[j]] = [a[j], a[i]]; i++; j--; }
      }
      if (target <= j) right = j;
      else if (target >= i) left = i;
      else break;
    }
    return a.slice(0, limit).sort(compare);
  }
  /** Regel einmal vorbereiten (Normalisierung der Suchbegriffe), dann schnell auf viele Angebote anwenden. */
  function compileRule(rule) {
    if (rule.enabled === false) return () => false;
    const kws = list(rule.keywords).filter(Boolean).map(fold).map((k) => k.split(/\s+/).filter(Boolean));
    const arts = list(rule.article_numbers).filter(Boolean).map(normArticle);
    const excl = list(rule.exclude).filter(Boolean).map(fold);
    const stores = list(rule.stores).filter(Boolean).map((s) => fold(String(s)));
    const hasMin = rule.min_discount_pct !== null && rule.min_discount_pct !== undefined && rule.min_discount_pct !== "";
    const hasMax = rule.max_price !== null && rule.max_price !== undefined && rule.max_price !== "";
    const min = hasMin ? Number(rule.min_discount_pct) : 0, max = hasMax ? Number(rule.max_price) : 0;
    const conds = list(rule.conditions).filter(Boolean).map(fold);
    return (o) => {
      const hay = o._rh || (o._rh = fold([o.title, o.product_description, o.offer_description].join(" ")));
      if (kws.length || arts.length) {
        const hk = kws.some((parts) => parts.every((p) => hay.includes(p)));
        const oa = o.article_numbers && o.article_numbers.length ? o.article_numbers : [o.article_number];
        if (!hk && !arts.some((a) => oa.includes(a))) return false;
      }
      if (excl.some((x) => hay.includes(x))) return false;
      if (stores.length) {
        const sid = fold(o.store_id), sn = o._rs || (o._rs = fold(o.store));
        if (!stores.some((s) => s === sid || sn.includes(s))) return false;
      }
      if (hasMin && (o.discount_pct === null || o.discount_pct === undefined || o.discount_pct < min)) return false;
      if (hasMax && (o.price === null || o.price === undefined || o.price > max)) return false;
      if (conds.length) {
        const c = o._rc || (o._rc = fold([o.condition, o.condition_description, o.reason_discount, o.additional_info].join(" ")));
        if (!conds.some((x) => c.includes(x))) return false;
      }
      return true;
    };
  }
  const compiled = new WeakMap();
  function matches(rule, o) {
    let f = compiled.get(rule);
    if (!f) compiled.set(rule, f = compileRule(rule));
    return f(o);
  }

  /* ---------- Entschluesselung + Entpacken (Gegenstueck zu tracker/crypto.py, tracker/pack.py) ---------- */
  const ITERATIONS = 250000, SALT = new TextEncoder().encode("zc-site-v1");
  const toB64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveKeyB64(password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: SALT, iterations: ITERATIONS }, base, 256);
    return toB64(new Uint8Array(bits));
  }
  const importKey = (b64) => crypto.subtle.importKey("raw", fromB64(b64), "AES-GCM", false, ["decrypt"]);
  async function openBlob(buf, key) {
    const u = new Uint8Array(buf);
    if (u[0] !== 90 || u[1] !== 67 || u[2] !== 49) throw new Error("Unbekanntes Dateiformat");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(3, 15) }, key, u.slice(15));
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  const STR_FIELDS = ["id", "offer_number", "store_id", "title", "product_description", "offer_description", "article_numbers", "condition", "condition_code", "condition_description", "reason_discount", "additional_info", "image", "status", "first_seen", "last_seen", "gone_at", "price_history", "log"];
  function unpackOffers(d, stores, lastOk, updated) {
    if (!d) return [];
    const T = d.s, ix = Object.fromEntries(d.f.map((f, i) => [f, i])), out = [];
    for (const row of d.r) {
      const o = {};
      for (const f of STR_FIELDS) o[f] = T[row[ix[f]]];
      for (const f of ["price", "original_price", "reappear_count", "missing_runs"]) o[f] = row[ix[f]];
      const arts = o.article_numbers.split(",").filter(Boolean), st = stores[o.store_id] || {};
      const disc = o.original_price !== null && o.price !== null ? Math.round((o.original_price - o.price) * 100) / 100 : null;
      Object.assign(o, {
        article_numbers: arts, article_number: arts[0] || "", offer_uuid: o.id.startsWith("u:") ? o.id.slice(2) : "",
        store: st.name || o.store_id, currency: "EUR", discount_eur: disc,
        discount_pct: disc !== null && o.original_price ? Math.round(disc / o.original_price * 1000) / 10 : null,
        link: offerLink(st.slug || storeSlug(st.name || o.store_id), o.offer_number), gone_at: o.gone_at || null,
        price_history: o.price_history ? JSON.parse(o.price_history) : [[o.first_seen, o.price]],
        log: o.log ? JSON.parse(o.log) : [],
      });
      if (!o.last_seen) o.last_seen = (lastOk || {})[o.store_id] || updated || o.first_seen;
      out.push(o);
    }
    return out;
  }

  const api = { compileRule, deriveKeyB64, importKey, openBlob, unpackOffers, IKEA_PAGE, KNOWN_SLUGS, storeName, storeSlug, offerLink, fold, normArticle, fmtArticle, flatten, merge, plausible, ingestSnapshot, matches, offerKey, ruleKey, dedupeRules, cleanRule, topSorted };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ZC = api;
})(typeof window !== "undefined" ? window : globalThis);

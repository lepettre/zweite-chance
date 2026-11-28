/* Zweite Chance – Web-App (ohne Build). Start · Fundgrube · Sortiment · Analyse · Daten · Einstellungen.
   Datenschicht wie bisher (verschlüsselte Dateien unter d/ und k/, Merkliste über den Worker). Die alte Oberfläche liegt unter alt.html. */
(function () {
  "use strict";
  const APP_VERSION = "2.20";       // bei jeder Änderung erhöhen und im Handbuch-Changelog eintragen
  /* ================= Grundlagen ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NF = new Intl.NumberFormat("de-DE"), NF2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf = (v) => (v == null ? "–" : NF.format(v));
  const eur = (v) => (v == null ? "–" : `${NF2.format(v)} €`);
  const eur0 = (v) => (v == null ? "–" : `${NF.format(Math.round(v))} €`);
  const pr = (v) => { if (v == null) return "–"; const [e, c] = Number(v).toFixed(2).split("."); return `<span class="pr">${NF.format(+e)}<sup>,${c === "00" ? "–" : c}</sup><small>€</small></span>`; };
  const day = (ts) => (ts ? String(ts).slice(0, 10) : "");
  const TODAY = new Date().toISOString().slice(0, 10);
  const ms = (d) => Date.parse(day(d) + "T12:00:00Z");
  const dIso = (n) => new Date(ms(TODAY) - n * 864e5).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / 864e5);
  const fD = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "–");
  const fS = (d) => (d ? `${+d.slice(8, 10)}.${+d.slice(5, 7)}.` : "–");
  const fDT = (ts) => (ts ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts)) : "–");
  const fNo = (n) => ZC.fmtArticle(n);
  const ago = (n) => (n == null ? "–" : n <= 0 ? "heute" : n === 1 ? "gestern" : `vor ${n} Tagen`);
  const rel = (ts) => { if (!ts) return "–"; const s = (Date.now() - new Date(ts)) / 1000; return s < 90 ? "gerade eben" : s < 3600 ? `vor ${Math.round(s / 60)} Min.` : s < 129600 ? `vor ${Math.round(s / 3600)} Std.` : `vor ${Math.round(s / 86400)} Tagen`; };
  const qn = (arr, p) => { const a = arr.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * p, l = Math.floor(i); return a[l] + (a[Math.ceil(i)] - a[l]) * (i - l); };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } };
  function toast(msg, t = 4500) { const el = document.createElement("div"); el.className = "toast"; el.innerHTML = msg; $("#toasts").appendChild(el); setTimeout(() => el.remove(), t); }
  const fold = (t) => ZC.fold(String(t || ""));
  const LS = { key: "zc.k", pw: "zc.p", rules: "zc.rules", lastVisit: "zc.lastVisit", mine: "zc.mymarkets", workerUrl: "zc.w", view: "zc.v2.view", intlOff: "zc.intlOff" };
  const K_IMG = "https://www.ikea.com/de/de/images/products/", K_P = "https://www.ikea.com/de/de/p/";
  const IOS = /ikea of sweden/i;
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.2-4.5-9.1-8.7C1.5 8.2 3.4 5 6.7 5c2.1 0 3.4 1.2 4.3 2.5C11.9 6.2 13.2 5 15.3 5c3.3 0 5.2 3.2 3.8 6.3C19.2 15.5 12 20 12 20z"/></svg>';
  const COLHEX = { weiß: "#F3F2EE", beige: "#D8C6A8", grau: "#8F9194", schwarz: "#262626", braun: "#7A5A40", grün: "#5E7B5A", blau: "#3E5F8A", rot: "#A8322D", gelb: "#E2B93B", lila: "#7A5C8A", rosa: "#E1B2AE", orange: "#D9822B", türkis: "#3AA39A", silberfarben: "#C0C0C0", goldfarben: "#C9A54A", transparent: "#FFFFFF", mehrfarbig: "linear-gradient(90deg,#d33,#3a3,#33d)", natur: "#D3B58E", anthrazit: "#3A3D40" };
  const sq_ = (c) => `<i class="sq" style="background:${COLHEX[c] || "#ccc"}"></i>`;

  /* ================= Zugang und Daten ================= */
  class AuthError extends Error {}
  const AUTH = { key: null, pw: null };
  async function openFile(path, version) {
    const r = await fetch(`${path}${version ? "?v=" + encodeURIComponent(version) : ""}`, { cache: version ? "force-cache" : "no-cache" });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    try { return await ZC.openBlob(await r.arrayBuffer(), AUTH.key); } catch { throw new AuthError("Passwort stimmt nicht"); }
  }
  const getBin = (n, v) => openFile(`d/${n}`, v), getK = (n, v) => openFile(`k/${n}`, v);
  const soft = (p) => p.catch((e) => { if (e instanceof AuthError) throw e; return null; });
  // wie soft, aber unterscheidet "Datei gibt es nicht" (404 -> null) von Netzfehlern (-> undefined, später erneut versuchen)
  const tryLoad = (p) => p.catch((e) => { if (e instanceof AuthError) throw e; return /^404 /.test(e.message) ? null : undefined; });

  const S = {
    repo: { meta: null, current: [], archive: null, watch: [], runs: null },
    rules: ZC.dedupeRules(lsGet(LS.rules, [])), server: { ok: false, groups: {} },
    kat: null, rng: undefined, facets: undefined, details: undefined, state: undefined,
    tab: "start", f: { fund: {}, sort: {} }, sort: { fund: "neu", sort: "chg" }, view: lsGet(LS.view, { fund: "liste", sort: "liste" }), grp: "aus",
    open: null, sq: {}, more: {}, rev: {}, ss: {}, ts: {}, fo: {}, heatSort: "anteil", cmp: null, shown: 150, prevVisit: lsGet(LS.lastVisit, null),
  };
  const storeList = () => (S.repo.meta?.stores || []).slice().sort((a, b) => a.name.localeCompare(b.name, "de"));
  const nameOf = (id) => (S.repo.meta?.stores || []).find((s) => s.id === id)?.name || S.rng?.byId?.[id]?.name || id;
  const MINE = () => lsGet(LS.mine, []);
  const isMine = (id) => MINE().includes(id);

  // Startbestand: Angebote, die beim ersten Abruf schon da waren, tragen denselben Zeitstempel – nie als „neu“ zählen.
  const findBase = (list) => { const m = new Map(); for (const o of list) m.set(o.first_seen, (m.get(o.first_seen) || 0) + 1); let best = null; for (const [k, n] of m) if (n >= 1000 && n >= list.length * 0.05 && (!best || k < best)) best = k; return best; };
  const unpackOffers = (d) => ZC.unpackOffers(d, Object.fromEntries((S.repo.meta?.stores || []).map((s) => [s.id, s])), Object.fromEntries((S.repo.meta?.stores || []).map((s) => [s.id, s.last_ok])), S.repo.meta?.updated);
  function adaptOffer(o) {
    if (o._a) return o;
    o.no = ZC.normArticle(o.article_number || (o.article_numbers || [])[0] || "");
    o.base = !!S.baseTs && o.first_seen === S.baseTs;
    o.active = o.status === "active";
    o.mid = o.store_id; o.market = o.store || nameOf(o.store_id);
    o.start = day(o.first_seen); o.end = o.active ? null : day(o.gone_at || o.last_seen);
    o.age = daysBetween(o.start, TODAY);
    o.disc = o.discount_pct != null ? Math.round(o.discount_pct) : null; o.orig = o.original_price;
    o._a = 1;
    return o;
  }
  const linkOffer = (o) => { o.art = S.kat?.byNo.get(o.no) || null; o.top = o.art?.top || "Artikel noch nicht erfasst"; o.thumb = o.image ? `${o.image}?f=xs` : o.art ? o.art.thumb : ""; return o; };
  async function loadRepo() {
    const meta = await soft(getBin("meta.bin"));
    if (!meta) { S.repo.meta = null; return; }
    S.repo.meta = meta;
    const cur = unpackOffers(await soft(getBin("current.bin", meta.current_version)));
    S.baseTs = findBase(cur); S.repo.current = cur.map(adaptOffer); S.repo.archive = null;
    await loadRules();
  }
  async function loadArchive() {
    if (S.repo.archive || !S.repo.meta) return;
    const months = (S.repo.meta.archive_months || []).slice().sort();
    const parts = await Promise.all(months.map((m) => soft(getBin(`a-${m}.bin`, (S.repo.meta.archive_hash || {})[m] || S.repo.meta.updated)).then((d) => (d ? unpackOffers(d) : []))));
    const seen = new Set(S.repo.current.map((o) => o.id));
    S.repo.archive = parts.flat().filter((o) => !seen.has(o.id)).map(adaptOffer);
  }
  const FA = () => S.repo.current.filter((o) => o.active);
  const FALL = () => (S.repo.archive ? [...S.repo.current, ...S.repo.archive] : S.repo.current);

  // Sortiment (k/items.bin) – Gegenstück zu katalog/model.py
  function unpackK(d) {
    if (!d) return [];
    const T = d.s, ix = Object.fromEntries(d.f.map((f, i) => [f, i])), STR = ["id", "no", "type", "name", "kind", "measure", "slug", "img", "cat", "vfrom", "vto", "tag", "first_seen", "last_seen", "status", "ph", "log", "col", "ctx", "hfb", "pa", "vars"], out = [];
    for (const row of d.r) {
      const o = {};
      for (const f of STR) o[f] = ix[f] === undefined ? "" : T[row[ix[f]]];
      for (const f of ["price", "prev", "last", "online", "missing", "rating", "rcount", "nvar"]) o[f] = ix[f] === undefined ? 0 : row[ix[f]];
      const cp = (o.cat || "").split(" › "); o.top = cp[0] || "–"; o.sub = cp[1] || ""; o.sub2 = cp[2] || "";
      o.coll = /\b(19|20)\d\d\b/.test(o.name || "") ? o.name : null;     // Kollektion: Name mit Jahreszahl, z. B. IKEA PS 2026, STOCKHOLM 2025
      o.ph = o.ph ? JSON.parse(o.ph) : [[o.first_seen, o.price]];
      o.log = o.log ? JSON.parse(o.log) : [];
      o.cols = (o.col || "").split(", ").filter(Boolean);
      o.thumb = o.img ? `${K_IMG}${o.img}?f=xs` : "";
      out.push(o);
    }
    return out;
  }
  // Welche Artikel sind Farben/Größen DESSELBEN Produkts? Maßgeblich ist IKEAs eigene Variantenliste (Feld vars).
  // Artikel, für die sie noch nicht erfasst ist: vorläufig gleicher Name + Art + Maß.
  function groupProducts(items) {
    const byId = new Map(items.map((o) => [o.id, o])), parent = new Map(), find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const latest = items.reduce((m, o) => (o.last_seen > m ? o.last_seen : m), "");
    const hasVars = items.some((x) => x.vars);
    for (const o of items) parent.set(o.id, o.id);
    for (const o of items) {
      const vs = (o.vars || "").split(",").filter(Boolean);
      o.varsKnown = vs.length > 0 || (hasVars && o.last_seen === latest);
      for (const v of vs) { const other = byId.get(v) || byId.get("s" + v) || byId.get(v.replace(/^s/, "")); if (other) parent.set(find(other.id), find(o.id)); }
    }
    for (const o of items) o.pk = o.varsKnown ? "v:" + find(o.id) : `f:${o.name}|${o.kind}|${o.measure}`;
  }
  async function loadKatalog() {
    if (S.kat && !S.kat.failed) return S.kat;
    const meta = await tryLoad(getK("meta.bin")), raw = meta ? await tryLoad(getK("items.bin", meta.items_version)) : null;
    if (meta === undefined || (meta && raw === undefined)) { S.katErr = true; return { meta: null, items: [], byId: new Map(), byNo: new Map(), failed: true }; }
    S.katErr = false;
    const items = unpackK(raw);
    const first = items.reduce((m, o) => (o.first_seen && o.first_seen < m ? o.first_seen : m), "9999");
    const firstN = items.filter((o) => o.first_seen === first).length;
    for (const o of items) {
      // Anlernphase: alles, was bis zum Schließen der Sitemap-Lücken erfasst wurde, ist Startbestand (nie "neu")
      o.base = (firstN >= 1000 && o.first_seen === first) || !meta?.baseline_until || o.first_seen <= meta.baseline_until;
      o.first = o.base ? null : o.first_seen;
      o.gone = o.status === "gone" ? o.last_seen : null;
      o.stub = o.status === "stub";
    }
    S.kat = { meta, items, first, byId: new Map(items.map((o) => [o.id, o])), byNo: new Map(items.filter((o) => !o.stub).map((o) => [o.no, o])) };
    groupProducts(items);
    S.t0 = [first, day(S.baseTs)].filter((x) => x && x !== "9999").sort()[0] || dIso(180);
    for (const o of FALL()) linkOffer(o);
    return S.kat;
  }
  const b64bits = (s) => (s ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(0));
  const bitAt = (arr, i) => (arr[i >> 3] >> (i & 7)) & 1;
  async function loadRange() {
    if (S.rng !== undefined) return S.rng;
    const d = await tryLoad(getK("range.bin"));
    if (d === undefined) return null;
    if (!d) return (S.rng = null);
    const N = d.ids.length, st = d.stores.filter((s) => d.range[s.id]).map((s) => ({ ...s, r: b64bits(d.range[s.id]), k: b64bits((d.stock || {})[s.id]), n: Math.min(s.n || 0, N) }));
    const cnt = new Uint16Array(N), known = new Uint16Array(N);
    for (const s of st) for (let i = 0; i < s.n; i++) { known[i]++; if (bitAt(s.r, i)) cnt[i]++; }
    S.rng = { ids: d.ids, N, st, cnt, known, idx: new Map(d.ids.map((x, i) => [x, i])), updated: d.updated, byId: Object.fromEntries(st.map((s) => [s.id, s])) };
    for (const o of S.kat?.items || []) { const i = S.rng.idx.get(o.id); o.ri = i; o.nMk = i != null && known[i] ? cnt[i] : null; o.nKn = i != null ? known[i] : 0; }
    return S.rng;
  }
  const carries = (o, sid) => { const R = S.rng, s = R?.byId[sid]; if (!s || o.ri == null || o.ri >= s.n) return null; return bitAt(s.r, o.ri) === 1; };
  async function loadFacets() {
    if (S.facets !== undefined) return S.facets;
    const d = await tryLoad(getK("facets.bin"));
    if (d === undefined) return null;
    if (!d) return (S.facets = null);
    const by = new Map(), matBy = new Map(), ppl = new Map(), pc = new Map(), pr_ = new Map(), praw = new Map();
    for (const [n, ids] of Object.entries(d.designer || {})) for (const id of ids) by.set(id, n);
    for (const [n, ids] of Object.entries(d.material || {})) for (const id of ids) matBy.set(id, n);
    const pm = ZC.designerPeople(Object.keys(d.designer || {}).filter((r) => !IOS.test(r)));
    for (const [raw, ids] of Object.entries(d.designer || {})) { const ps = pm.get(raw); if (!ps) continue; const names = [...new Set(ps.map((x) => x.name))]; for (const x of ps) pr_.set(x.name, x.resolved); for (const id of ids) ppl.set(id, names); for (const n of names) { pc.set(n, (pc.get(n) || 0) + ids.length); praw.set(n, [...(praw.get(n) || []), raw]); } }
    const persons = [...pc].map(([name, n]) => ({ name, n, resolved: pr_.get(name) })).sort((a, b) => ZC.sortByLast(a.name, b.name));
    for (const [id, c] of Object.entries(d.cat || {})) { const a = S.kat?.byId.get(id); if (a && !a.cat) { a.cat = c; const cp = c.split(" › "); a.top = cp[0] || "–"; a.sub = cp[1] || ""; a.sub2 = cp[2] || ""; a._h = null; } }
    for (const [id, c] of Object.entries(d.col || {})) { const a = S.kat?.byId.get(id); if (a && !a.col) { a.col = c; a.cols = c.split(/,\s*/).filter(Boolean); } }
    return (S.facets = { by, matBy, ppl, praw, persons, materials: Object.keys(d.material || {}).sort((a, b) => a.localeCompare(b, "de")), n: d.n, raw: Object.keys(d.designer || {}) });
  }
  // Ländervergleich (k/intl.bin): Preis je Land für jeden Artikel, Wechselkurse der EZB
  async function loadIntl() {
    if (S.intl !== undefined) return S.intl;
    const d = await tryLoad(getK("intl.bin"));
    if (d === undefined) return null;
    if (!d || !d.ids?.length) return (S.intl = null);
    return (S.intl = { ...d, pos: new Map(d.ids.map((x, i) => [x, i])) });
  }
  const CN = (() => { try { const dn = new Intl.DisplayNames(["de"], { type: "region" }); return (cc) => dn.of(cc.toUpperCase()); } catch { return (cc) => cc.toUpperCase(); } })();
  const toEur = (c, v) => { if (v == null) return null; if (c.cur === "EUR") return v; const r = S.intl?.rates?.[c.cur]; return r ? v / r : null; };
  const local = (c, v) => { try { return new Intl.NumberFormat("de-DE", { style: "currency", currency: c.cur || "EUR", maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v); } catch { return `${nf(v)} ${c.cur}`; } };
  function abroad(a) {      // [{c, v, eur}] je Land, in dem es den Artikel gibt
    const I = S.intl, i = I?.pos.get(a.id); if (i == null) return [];
    const off = new Set(lsGet(LS.intlOff, []));
    return I.countries.filter((c) => !off.has(c.cc)).map((c) => ({ c, v: I.p[c.cc]?.[i] })).filter((x) => x.v != null).map((x) => ({ ...x, eur: toEur(x.c, x.v) }));
  }
  async function loadDetails() {
    if (S.details !== undefined) return S.details;
    const d = await tryLoad(getK("details.bin"));
    if (d === undefined) return null;
    if (!d) return (S.details = null);
    const T = d.s, ix = Object.fromEntries(d.f.map((f, i) => [f, i])), m = new Map();
    for (const row of d.r) m.set(row[0], Object.fromEntries(d.f.slice(1).map((f) => [f, T[row[ix[f]]]])));
    return (S.details = m);
  }

  /* ================= Merkliste (gemerkte Artikel und gespeicherte Suchen) ================= */
  const worker = {
    get url() { const u = (S.repo.meta?.worker || lsGet(LS.workerUrl, "") || "").trim().replace(/\/+$/, ""); return u ? (/^https?:\/\//i.test(u) ? u : "https://" + u) : null; },
    async call(method, body, { path = "/api/watchlist", confirmDelete = false } = {}) {
      const r = await fetch(`${this.url}${path}`, { method, headers: { "x-key": AUTH.pw, "content-type": "application/json", ...(confirmDelete ? { "x-confirm-delete": "2" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(`Worker ${r.status}`);
      return r.json();
    },
  };
  const hashStr = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const withId = (r) => (r.id ? r : { ...r, id: "r" + hashStr(ZC.ruleKey(r)) });
  const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  async function loadRules() {
    S.server = { ok: false, groups: {} };
    if (worker.url && AUTH.pw) {
      try {
        const w = await worker.call("GET");
        S.server = { ok: true, groups: w.groups || {}, dupFix: ZC.dedupeRules(w.rules || []).length < (w.rules || []).length };
        const old = lsGet(LS.rules, []);
        let base = w.rules || [], seed = false;
        if (!base.length) { const saved = await soft(getBin("watchlist.bin")); base = saved?.rules || []; seed = base.length > 0; }
        S.rules = ZC.dedupeRules([...base, ...old]).map(withId); S.repo.watch = [];
        if ((old.length || seed) && (await persistRules()) && old.length) lsSet(LS.rules, []);
        return;
      } catch (e) { console.warn("Merkliste vom Server nicht lesbar", e); }
    }
    const saved = await soft(getBin("watchlist.bin"));
    S.repo.watch = ZC.dedupeRules((saved?.rules || []).map((r, i) => ({ ...r, name: r.name || `Suche ${i + 1}`, _repo: true }))).map(withId);
    S.rules = S.rules.map(withId);
  }
  const confirmTwice = (what) => confirm(`${what}\n\nBestätigung 1 von 2.`) && confirm(`Wirklich? ${what}\n\nBestätigung 2 von 2. Der frühere Stand bleibt wiederherstellbar.`);
  async function persistRules(confirmDelete = false) {
    S.rules = ZC.dedupeRules(S.rules); memo.clear();
    if (S.server?.ok) {
      try { await worker.call("PUT", { rules: S.rules.map(withId).map(({ _repo, ...r }) => r), groups: S.server.groups }, { confirmDelete: confirmDelete || S.server.dupFix }); S.server.dupFix = false; return true; }
      catch (e) { toast(`<b>Merkliste nicht gespeichert:</b> ${esc(e.message)}`, 7000); return false; }
    }
    lsSet(LS.rules, S.rules); return true;
  }
  const allRules = () => { const own = new Set(S.rules.map((r) => r.id)); return ZC.dedupeRules([...S.repo.watch.filter((r) => !own.has(r.id)), ...S.rules]); };
  const isFavRule = (r) => (r.article_numbers || []).length === 1 && !(r.keywords || []).length && !(r.stores || []).length && !r.ui;
  const isSubRule = (r) => !!r.sub;
  const favRules = () => allRules().filter(isFavRule), searchRules = () => allRules().filter((r) => !isFavRule(r) && !isSubRule(r)), subRules = () => allRules().filter(isSubRule);
  const SUBL = { des: "Designer", serie: "Serie", koll: "Kollektion" };
  const subLabel = (sub) => `${SUBL[sub.k] || ""} ${sub.v}`;
  const subItem = (sub, a) => (sub.k === "des" ? (S.facets?.ppl.get(a.id) || []).includes(sub.v) : a.name === sub.v);
  const seriesOf = (a) => (a.coll ? a.name.replace(/\s*\b(19|20)\d\d\b\s*/, " ").trim() : a.name);   // STOCKHOLM 2025 -> Serie STOCKHOLM
  const followBtn = (k, v) => { const on_ = allRules().some((r) => r.sub && r.sub.k === k && r.sub.v === v); return `<button class="follow ${on_ ? "on" : ""}" data-follow="${esc(JSON.stringify({ k, v }))}" aria-pressed="${on_}">${on_ ? "folge ich" : "folgen"}</button>`; };
  const FAVS = () => { if (!memo.has("favs")) memo.set("favs", new Set(favRules().map((r) => ZC.normArticle(r.article_numbers[0])))); return memo.get("favs"); };
  const memo = new Map();
  async function toggleFav(no, label) {
    const key = ZC.normArticle(no), mine = S.rules.filter((r) => isFavRule(r) && ZC.normArticle(r.article_numbers[0]) === key);
    if (FAVS().has(key)) {
      if (!mine.length) { toast("Dieser Eintrag stammt aus der Sicherung. Entfernen geht erst, wenn der Hilfsdienst verbunden ist."); return; }
      if (!confirmTwice(`„${label}“ nicht mehr merken?`)) return;
      S.rules = S.rules.filter((r) => !mine.includes(r)); await persistRules(true); toast("Entfernt. Früherer Stand unter Einstellungen wiederherstellbar.");
    } else {
      S.rules.push({ id: newId(), name: `${label} ${fNo(key)}`, enabled: true, notify: true, article_numbers: [fNo(key)] });
      await persistRules(); toast(`„${esc(label)}“ gemerkt. Du bekommst eine Nachricht, sobald er in einer Fundgrube auftaucht.`);
    }
    memo.clear(); render();
  }
  function ruleMatcher(r) {
    const k = "rm" + r.id + (r.ui ? JSON.stringify(r.ui) : ZC.ruleKey(r));
    if (!memo.has(k)) memo.set(k, r.ui ? (o) => passAll(o, "fund", r.ui) : ZC.compileRule({ ...r, enabled: true }));
    return memo.get(k);
  }
  const ruleHits = (r, list = FA()) => { const f = ruleMatcher(r); return list.filter((o) => (r.ui ? o.active || r.ui.zeit : true) && f(o)); };
  const ruleText = (r) => (r.sub ? `Folgen: ${subLabel(r.sub)}` : r.ui ? sentence("fund", r.ui).replace(/^Zeige aktuelle /, "").replace(/^./, (c) => c.toUpperCase()) : r.name || "Suche");
  function goodPrice(f, r) {
    const list = FALL(), fx = r ? (r.ui ? { ...r.ui, zeit: "alle" } : null) : { ...f, zeit: "alle" };
    const all = fx ? list.filter((o) => passAll(o, "fund", fx)) : list.filter(ZC.compileRule({ ...r, enabled: true }));
    if (all.length < 3) return null;
    const past = all.filter((o) => !o.active && !o.base);
    return { n: all.length, q1: qn(all.map((o) => o.price), 0.25), lo: Math.min(...all.map((o) => o.price)), dw: past.length >= 3 ? Math.round(qn(past.map((o) => daysBetween(o.start, o.end)), 0.5)) : null, full: !!S.repo.archive };
  }

  /* ================= Filter: Sätze, innerhalb einer Angabe ODER, zwischen Angaben UND ================= */
  const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));
  const lastChg = (a) => (a.ph.length > 1 ? { d: day(a.ph[a.ph.length - 1][0]), from: a.ph[a.ph.length - 2][1], to: a.ph[a.ph.length - 1][1] } : null);
  const DEF = {
    fund: [
      { k: "zeit", l: "Zeitraum", base: 1, pre: "Zeige", any: "aktuelle", t: "single", opts: [["alle", "aktuelle und vergangene"], ["weg", "vergangene"]], test: (o, v) => (v === "weg" ? !o.active : true), post: "Fundgrube-Angebote", arch: 1 },
      { k: "markt", l: "Markt", base: 1, pre: "in", any: "allen Märkten", t: "multi", get: (o) => [o.mid], lab: nameOf, ord: (a, b) => (isMine(b) - isMine(a)) || nameOf(a).localeCompare(nameOf(b), "de"), search: true, mine: true },
      { k: "bereich", l: "Bereich", base: 1, pre: "aus", any: "allen Bereichen", t: "multi", get: (o) => [o.top] },
      { k: "preis", l: "Preis", base: 1, pre: "für", any: "jeden Preis", t: "range", get: (o) => o.price },
      { k: "zust", g: "Was", l: "Zustand", pre: "im Zustand", t: "multi", get: (o) => [o.condition || "ohne Angabe"] },
      { k: "grund", g: "Was", l: "Grund", pre: "mit Grund", t: "multi", get: (o) => [o.reason_discount || "ohne Angabe"], search: true },
      { k: "regulaer", g: "Was", l: "Im Sortiment?", t: "single", opts: [["ja", "die regulär im Sortiment sind"], ["weg", "die aus dem Sortiment ausgelistet sind"], ["unbekannt", "ohne Treffer in den Sortimentsdaten"]], test: (o, v) => (v === "ja" ? !!(o.art && !o.art.gone) : v === "weg" ? !!o.art?.gone : !o.art) },
      { k: "gemerkt", g: "Was", l: "Nur gemerkte Artikel", t: "toggle", txt: "nur gemerkte Artikel", test: (o) => FAVS().has(o.no) },
      { k: "rabatt", g: "Preis", l: "Rabatt", pre: "mit", t: "single", opts: [["30", "mind. 30 % Rabatt"], ["40", "mind. 40 % Rabatt"], ["50", "mind. 50 % Rabatt"]], test: (o, v) => (o.disc ?? 0) >= +v },
      { k: "seit", g: "Zeit", l: "Eingestellt", pre: "eingestellt", t: "single", opts: [["1", "heute"], ["3", "in den letzten 3 Tagen"], ["7", "in den letzten 7 Tagen"], ["30", "in den letzten 30 Tagen"]], test: (o, v) => !o.base && o.age < +v },
      { k: "besuch", g: "Zeit", l: "Neu seit letztem Besuch", t: "toggle", txt: "neu seit meinem letzten Besuch", test: (o) => isNewV(o) },
    ],
    sort: [
      { k: "stand", g: "Zeit", l: "Ausgelistete", pre: "Zeige Artikel", any: "im Sortiment", t: "single", opts: [["auch", "im Sortiment und ausgelistet"], ["weg", "die ausgelistet sind"]], test: (o, v) => (v === "weg" ? !!o.gone : true), dflt: (o) => !o.gone },
      { k: "bereich", l: "Bereich", base: 1, pre: "aus", any: "allen Bereichen", t: "multi", get: (o) => [o.top] },
      { k: "farbe", g: "Was", l: "Farbe", pre: "in", t: "multi", get: (o) => (o.cols.length ? o.cols : ["ohne Angabe"]) },
      { k: "preis", l: "Preis", base: 1, pre: "für", any: "jeden Preis", t: "range", get: (o) => o.price },
      { k: "wo", l: "Verfügbarkeit", base: 1, need: "R", pre: "", any: "in beliebigen Märkten", t: "single", opts: [["mine", "erhältlich in meinen Märkten"], ["notmine", "nicht in meinen Märkten erhältlich"], ["selten", "in höchstens 5 Märkten erhältlich"], ["fast", "in fast allen Märkten erhältlich"]],
        test: (o, v) => { if (o.nMk == null) return false; if (v === "selten") return o.nMk >= 1 && o.nMk <= 5; if (v === "fast") return o.nKn >= 10 && o.nMk / o.nKn >= 0.9; const c = MINE().map((m) => carries(o, m)).filter((x) => x !== null); if (!c.length) return false; return v === "mine" ? c.some(Boolean) : !c.some(Boolean); } },
      { k: "coll", g: "Was", l: "Kollektion", pre: "aus der Kollektion", t: "multi", get: (o) => (o.coll ? [o.coll] : []), ord: (a, b) => b.localeCompare(a, "de") },
      { k: "sub", g: "Was", l: "Unterkategorie", pre: "in", t: "multi", get: (o) => (o.sub ? [o.sub] : []), search: true },
      { k: "sub2", g: "Was", l: "Rubrik", pre: "in", t: "multi", get: (o) => (o.sub2 ? [o.sub2] : []), search: true },
      { k: "des", g: "Was", l: "Designer", pre: "von", need: "F", t: "multi", get: (o) => S.facets.ppl.get(o.id) || (S.facets.by.has(o.id) ? ["ohne Namen (IKEA of Sweden)"] : ["noch unbekannt"]), ord: (a, b) => ((a.startsWith("ohne") || a.startsWith("noch")) - (b.startsWith("ohne") || b.startsWith("noch"))) || ZC.sortByLast(a, b), search: true },
      { k: "mat", g: "Was", l: "Material", pre: "aus", need: "F", t: "multi", get: (o) => [S.facets.matBy.get(o.id) || "noch unbekannt"], search: true },
      { k: "typ", g: "Was", l: "Einzelartikel oder Set", t: "single", opts: [["ART", "nur Einzelartikel"], ["SPR", "nur Sets"]], test: (o, v) => o.type === v },
      { k: "bew", g: "Was", l: "Bewertung", t: "single", opts: [["4", "mit mind. 4 Sternen"], ["4.5", "mit mind. 4,5 Sternen"]], test: (o, v) => o.rcount >= 5 && o.rating >= +v },
      { k: "gemerkt", g: "Was", l: "Nur gemerkte Artikel", t: "toggle", txt: "nur gemerkte", test: (o) => FAVS().has(o.no) },
      { k: "chg", g: "Preis", l: "Preisänderung", pre: "deren Preis", t: "single", opts: [["d30", "in 30 Tagen gesunken"], ["u30", "in 30 Tagen gestiegen"], ["any", "sich seit Beginn geändert hat"]], test: (o, v) => { const c = lastChg(o); if (!c) return false; if (v === "any") return true; return c.d >= dIso(30) && (v[0] === "d" ? c.to < c.from : c.to > c.from); } },
      { k: "rabattk", g: "Preis", l: "Reduziert", t: "toggle", txt: "mit durchgestrichenem Vorher-Preis", test: (o) => !!o.prev },
      { k: "neu", g: "Zeit", l: "Neu im Sortiment", pre: "neu seit", t: "single", opts: [["7", "7 Tagen"], ["30", "30 Tagen"], ["90", "90 Tagen"]], test: (o, v) => !!o.first && day(o.first) >= dIso(+v) },
      { k: "letzte", g: "Zeit", l: "Letzte Chance", t: "toggle", txt: "nur Artikel mit „letzte Chance“", test: (o) => !!o.last && !o.gone },
      { k: "fehlt", g: "Wo", l: "Fehlt in Markt", pre: "die fehlen in", need: "R", t: "multi", get: (o) => (S.rng ? S.rng.st.filter((s) => carries(o, s.id) === false).map((s) => s.id) : []), lab: nameOf, ord: (a, b) => (isMine(b) - isMine(a)) || nameOf(a).localeCompare(nameOf(b), "de"), search: true },
      { k: "ausland", g: "Wo", l: "Andere Länder", need: "I", t: "single", opts: [["10", "im Ausland mind. 10 % günstiger"], ["25", "im Ausland mind. 25 % günstiger"], ["teurer", "in Deutschland am günstigsten"], ["nurde", "in keinem gemessenen Land außer Deutschland"]],
        test: (o, v) => { const ab = abroad(o); if (v === "nurde") return S.intl?.pos && !ab.length; const e = ab.map((x) => x.eur).filter((x) => x != null); if (!e.length || !o.price) return false; const min = Math.min(...e); return v === "teurer" ? min >= o.price : min <= o.price * (1 - +v / 100); } },
      { k: "fund", g: "Wo", l: "Gerade in der Fundgrube", t: "toggle", txt: "gerade auch in der Fundgrube", test: (o) => fundNow().has(o.no) },
    ],
  };
  const defsOf = (tab) => DEF[tab].filter((d) => !d.need || (d.need === "R" ? !!S.rng : d.need === "I" ? !!S.intl : !!S.facets));
  const on = (v) => !(v == null || v === "" || v === false || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !v.min && !v.max));
  const ok1 = (d, o, v) => { if (!on(v)) return d.dflt ? d.dflt(o) : true; if (d.t === "multi") return d.get(o).some((x) => v.includes(x)); if (d.t === "range") { const x = d.get(o); return x != null && (!v.min || x >= +v.min) && (!v.max || x <= +v.max); } return d.test(o, v); };
  const hay = (o) => o._h || (o._h = fold(`${o.name || o.title} ${o.kind || o.product_description} ${o.offer_description || ""} ${o.no} ${fNo(o.no)} ${o.col || ""} ${o.market || ""} ${o.cat || ""}`));
  const qok = (o, q) => { if (!q) return true; const terms = fold(q).split(/\s+/).filter(Boolean); const h = hay(o); return terms.every((t) => h.includes(t)); };
  function passAll(o, tab, f, ex) {
    if (tab === "fund" && !f.zeit && !o.active && !S.asof) return false;
    if (!qok(o, f.q)) return false;
    for (const d of defsOf(tab)) if (d.k !== ex && !ok1(d, o, f[d.k])) return false;
    return true;
  }
  // Zeitmaschine: Stand an einem früheren Tag aus Preisverlauf, Erscheinen/Auslisten und Fundgrube-Zeiträumen rekonstruieren
  const priceAt = (a, D) => { let v = a.ph[0]?.[1]; for (const [t, p] of a.ph) if (day(t) <= D && p != null) v = p; return v; };
  function itemsAt(D) { return S.kat.items.filter((a) => !a.stub && day(a.first || a.first_seen) <= D && (!a.gone || day(a.gone) > D)).map((a) => { const c = Object.create(a); c.price = priceAt(a, D); c.prev = null; c.gone = null; c.ph = a.ph.filter((p) => day(p[0]) <= D); return c; }); }
  function offersAt(D) { return FALL().filter((o) => (o.base ? day(S.baseTs) <= D : o.start <= D) && (!o.end || o.end >= D)).map((o) => { const c = Object.create(o); c.active = true; c.age = o.base ? 999 : daysBetween(o.start, D); return c; }); }
  const srcOf = (tab, f) => {
    const at = S.asof, k = at ? `s-at-${tab}-${at}-${S.repo.archive ? 1 : 0}` : tab === "fund" ? (f.zeit ? "s-fall" + (S.repo.archive ? 1 : 0) : "s-fa") : "s-kat";
    if (!memo.has(k)) memo.set(k, at ? (tab === "fund" ? offersAt(at) : itemsAt(at)) : tab === "fund" ? (f.zeit ? FALL() : FA()) : S.kat.items.filter((o) => !o.stub));
    return memo.get(k);
  };
  const apply = (tab, f, ex) => srcOf(tab, f).filter((o) => passAll(o, tab, f, ex));
  function optsOf(d, tab, f) {
    const k = `o|${tab}|${d.k}|${JSON.stringify(f)}`;
    if (memo.has(k)) return memo.get(k);
    let out;
    if (d.t === "single") out = d.opts.map(([v, l]) => ({ v, l, n: apply(tab, { ...f, [d.k]: v }).length }));
    else { const b = apply(tab, f, d.k), m = new Map(); for (const o of srcOf(tab, f)) for (const x of d.get(o)) if (!m.has(x)) m.set(x, 0); for (const o of b) for (const x of d.get(o)) m.set(x, (m.get(x) || 0) + 1); out = [...m].sort(d.ord ? (a, c) => d.ord(a[0], c[0]) : (a, c) => c[1] - a[1] || String(a[0]).localeCompare(String(c[0]), "de")).map(([v, n]) => ({ v, l: d.lab ? d.lab(v) : v, n })); }
    memo.set(k, out); return out;
  }
  const valTxt = (d, v) => { if (d.t === "multi") { if (d.mine && MINE().length && sameSet(v, MINE())) return "meinen Märkten"; const ls = v.map((x) => (d.lab ? d.lab(x) : x)); return ls.length > 3 ? `${ls.slice(0, 2).join(", ")} und ${ls.length - 2} weiteren` : ls.join(" oder "); } if (d.t === "range") return v.min && v.max ? `${eur0(+v.min)} bis ${eur0(+v.max)}` : v.max ? `höchstens ${eur0(+v.max)}` : `mindestens ${eur0(+v.min)}`; if (d.t === "toggle") return d.txt; return d.opts.find((x) => x[0] === v)?.[1] || v; };
  const sentence = (tab, f) => defsOf(tab).filter((d) => d.base || on(f[d.k])).map((d) => `${d.pre ? d.pre + " " : ""}${on(f[d.k]) ? valTxt(d, f[d.k]) : d.any}${d.post ? " " + d.post : ""}`).join(" ").replace(/ +/g, " ") + (f.q ? ` mit „${f.q}“` : "");
  const isNewV = (o) => !!S.prevVisit && !o.base && o.first_seen > S.prevVisit;
  const nv = (o) => (o.active && isNewV(o) ? `<i class="nv" title="neu seit deinem letzten Besuch"></i>` : "");
  const fundNow = () => { if (!memo.has("fn")) memo.set("fn", FA().reduce((m, o) => m.set(o.no, [...(m.get(o.no) || []), o]), new Map())); return memo.get("fn"); };
  const fundAll = () => { const k = "fa" + (S.repo.archive ? 1 : 0); if (!memo.has(k)) memo.set(k, FALL().reduce((m, o) => m.set(o.no, [...(m.get(o.no) || []), o]), new Map())); return memo.get(k); };

  function optList(d, tab, f, where = "pop", lim = 0) {
    const v = f[d.k];
    if (d.t === "range") return `<div class="range"><input type="number" min="0" inputmode="decimal" placeholder="ab €" id="r-${where}-${d.k}-min" data-range="${d.k}" data-side="min" value="${esc(v?.min || "")}" aria-label="ab Euro"><span>bis</span><input type="number" min="0" inputmode="decimal" placeholder="€" id="r-${where}-${d.k}-max" data-range="${d.k}" data-side="max" value="${esc(v?.max || "")}" aria-label="bis Euro"></div>${where === "pop" ? `<button class="ok" data-shut>Übernehmen</button>` : ""}`;
    if (d.t === "toggle") return `<label class="opt"><input type="checkbox" data-tg="${d.k}" ${v ? "checked" : ""}><span>${esc(d.txt)}</span><small>${nf(apply(tab, { ...f, [d.k]: true }).length)}</small></label>`;
    let os = optsOf(d, tab, f); const sq = S.sq[d.k] || "";
    if (d.search && sq) os = os.filter((o) => fold(o.l).includes(fold(sq)));
    const allN = os.length; if (lim && !S.more[d.k] && !sq && os.length > lim) { const sel = os.filter((o) => (v || []).includes?.(o.v)); os = [...new Set([...os.slice(0, lim), ...sel])]; }
    const mineOpt = d.mine && MINE().length ? `<label class="opt sep"><input type="checkbox" data-mine="${d.k}" ${sameSet(v, MINE()) ? "checked" : ""}><span><b>Meine Märkte</b> <span class="kd">${esc(MINE().map(nameOf).join(", "))}</span></span></label>` : "";
    return `${d.search && (allN > 8 || sq) ? `<input type="search" id="sq-${where}-${d.k}" data-sq="${d.k}" placeholder="suchen" value="${esc(sq)}" aria-label="${esc(d.l)} suchen">` : ""}${mineOpt}${os.map((o) => { const c = d.t === "multi" ? (v || []).includes(o.v) : v === o.v; const mine = d.mine || d.k === "fehlt" ? isMine(o.v) : false; return `<label class="opt ${o.n || c ? "" : "zero"}"><input type="${d.t === "multi" ? "checkbox" : "radio"}" name="${where}${tab}${d.k}" data-k="${d.k}" data-v="${esc(o.v)}" ${c ? "checked" : ""}><span>${d.k === "farbe" ? sq_(o.v) : ""}${mine ? `<b>${esc(o.l)}</b>` : esc(o.l)}</span><small>${nf(o.n)}</small></label>`; }).join("")}${lim && allN > lim && !sq ? `<button class="lnk more" data-more="${d.k}">${S.more[d.k] ? "weniger" : `alle ${allN} zeigen`}</button>` : ""}${d.t === "single" && v && where === "pop" ? `<button class="lnk" data-reset="${d.k}" style="margin-top:6px;display:block">zurücksetzen</button>` : ""}`;
  }
  const GRP = ["Was", "Preis", "Zeit", "Wo"];
  // weitere Filter (nicht in der Leiste): je Gruppe, jeder Filter einklappbar; aktive sind aufgeklappt
  function moreFilters(tab, f, where) {
    const defs = defsOf(tab).filter((d) => !d.base);
    return GRP.map((g) => [g, defs.filter((d) => d.g === g)]).filter(([, l]) => l.length).map(([g, l]) => `<div class="grp">${g}</div>${l.map((d) => `<details class="fd" ${on(f[d.k]) || S.fo[d.k] ? "open" : ""} data-fd="${d.k}"><summary>${esc(d.l)}${on(f[d.k]) ? ` <b>· ${esc(String(shortOf(d, f)).slice(0, 24))}</b>` : ""}</summary>${on(f[d.k]) ? `<button class="lnk on" data-reset="${d.k}">zurücksetzen</button>` : ""}${optList(d, tab, f, where, 7)}</details>`).join("")}`).join("");
  }
  const shortOf = (d, f) => { const v = f[d.k]; if (!on(v)) return ""; if (d.t === "multi") return v.length === 1 ? (d.lab ? d.lab(v[0]) : v[0]) : `${v.length}`; if (d.t === "range") return valTxt(d, v); if (d.t === "toggle") return "ja"; return d.opts.find((x) => x[0] === v)?.[1] || ""; };
  function sideFilters(tab, f) {
    const defs = defsOf(tab), box = (d) => `<div class="fg"><h4>${esc(d.l)}${on(f[d.k]) ? `<button class="on" data-reset="${d.k}">zurücksetzen</button>` : ""}</h4>${optList(d, tab, f, "side", 7)}</div>`;
    const nMore = defs.filter((d) => !d.base && on(f[d.k])).length;
    return `<aside class="side" aria-label="Filter">${defs.filter((d) => d.base).map(box).join("")}<details class="morebox" ${nMore || S.fo.__side ? "open" : ""} data-fd="__side"><summary>Weitere Filter${nMore ? ` <b>· ${nMore} aktiv</b>` : ""}</summary>${moreFilters(tab, f, "side")}</details></aside>`;
  }
  // Filterleiste: ein Knopf je Angabe; Tippen öffnet die Auswahl, jede Auswahl wirkt sofort. Aktive Angaben darunter als Marken.
  function filterBar(tab, f, extra = {}) {
    const defs = defsOf(tab), short = (d) => { const v = f[d.k]; if (!on(v)) return ""; if (d.t === "multi") return v.length === 1 ? (d.lab ? d.lab(v[0]) : v[0]) : `${v.length}`; if (d.t === "range") return valTxt(d, v); if (d.t === "toggle") return "ja"; return d.opts.find((x) => x[0] === v)?.[1] || ""; };
    const nMore = defs.filter((d) => !d.base && on(f[d.k])).length;
    const moreB = `<span class="fb"><button class="${nMore ? "set" : ""}" data-pop="__more" aria-expanded="${S.open === "__more"}">Mehr Filter${nMore ? `: <b>${nMore}</b>` : ""}</button>${S.open === "__more" ? `<div class="pop wide"><div class="poph"><b>Weitere Filter</b><button class="lnk" data-shut>fertig</button></div>${moreFilters(tab, f, "pop")}</div>` : ""}</span>`;
    const btn = (d) => `<span class="fb"><button class="${on(f[d.k]) ? "set" : ""}" data-pop="${d.k}" aria-expanded="${S.open === d.k}">${esc(d.l)}${on(f[d.k]) ? `: <b>${esc(String(short(d)).slice(0, 24))}</b>` : ""}</button>${S.open === d.k ? `<div class="pop"><div class="poph"><b>${esc(d.l)}</b><button class="lnk" data-shut>fertig</button></div>${optList(d, tab, f)}</div>` : ""}</span>`;
    const toks = [];
    for (const d of defs) { const v = f[d.k]; if (!on(v)) continue; if (d.t === "multi") v.forEach((x) => toks.push([d.k, x, `${d.l}: ${d.lab ? d.lab(x) : x}`])); else toks.push([d.k, "", `${d.l}: ${valTxt(d, v)}`]); }
    if (f.q) toks.unshift(["q", "", `Suche: „${f.q}“`]);
    const opt = (attr, val, cur, l) => `<label class="opt"><input type="radio" ${attr}="${val}" ${cur ? "checked" : ""}><span>${esc(l)}</span></label>`;
    const sortB = `<span class="fb"><button data-pop="__sort" aria-expanded="${S.open === "__sort"}">${esc((SORT_L[tab].find(([k]) => k === S.sort[tab]) || SORT_L[tab][0])[1])}${S.rev[tab] ? " (umgekehrt)" : ""}</button>${S.open === "__sort" ? `<div class="pop"><div class="poph"><b>Sortierung</b><button class="lnk" data-shut>fertig</button></div>${SORT_L[tab].map(([k, l]) => opt("data-srtpick", k, S.sort[tab] === k, l)).join("")}<h4>Reihenfolge</h4>${opt("data-srtdir", "0", !S.rev[tab], "wie genannt")}${opt("data-srtdir", "1", !!S.rev[tab], "umgekehrt")}</div>` : ""}</span>`;
    const viewL = tab === "sort" ? `${{ serie: "Serien", koll: "Kollektionen" }[S.grp] || "einzeln"} · ${S.view.sort === "kacheln" ? "Kacheln" : "Liste"}` : S.view.fund === "kacheln" ? "Kacheln" : "Liste";
    const viewB = `<span class="fb"><button data-pop="__view" aria-expanded="${S.open === "__view"}">Ansicht: ${esc(viewL)}</button>${S.open === "__view" ? `<div class="pop"><div class="poph"><b>Ansicht</b><button class="lnk" data-shut>fertig</button></div>${tab === "sort" ? `<h4>Zeilen</h4>${opt("data-grppick", "aus", S.grp !== "serie" && S.grp !== "koll", "einzeln")}${opt("data-grppick", "serie", S.grp === "serie", "Serien")}${opt("data-grppick", "koll", S.grp === "koll", "Kollektionen")}<h4>Darstellung</h4>` : ""}${opt("data-viewpick", "liste", S.view[tab] !== "kacheln", "Liste")}${opt("data-viewpick", "kacheln", S.view[tab] === "kacheln", "Kacheln")}</div>` : ""}</span>`;
    const search = `<span class="fb srch"><input type="search" id="${extra.qid || "q-" + tab}" data-q="${tab}" placeholder="Suchen" value="${esc(f.q || "")}" aria-label="Name oder Artikelnummer suchen"></span>`;
    if (tab === "fund" && toks.length && !extra.noSave) toks.push(["__save", "", ""]);
    return `<div class="fbar">${search}${defs.filter((d) => d.base).map(btn).join("")}${moreB}${sortB}${viewB}</div>${toks.length ? `<div class="toks">${toks.map(([k, v, l]) => (k === "__save" ? "" : `<button data-untok="${k}" data-v="${esc(v)}" title="entfernen">${esc(l)} <span aria-hidden="true">×</span></button>`)).join("")}<button class="lnk" data-clear>alle entfernen</button>${toks.some((t) => t[0] === "__save") ? `<button class="lnk" data-savesearch>als Suche merken</button>` : ""}</div>` : ""}`;
  }

  /* ================= Diagramme ================= */
  const X0 = () => ms(S.t0 || dIso(180)), X1 = () => ms(TODAY);
  const NARROW = () => innerWidth < 700, VW = () => (NARROW() ? 400 : 760);
  function axisMonths(x, h) { const out = [], t0 = new Date(X0()); for (let d = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + 1, 1)); +d <= X1(); d.setUTCMonth(d.getUTCMonth() + 1)) { const xx = x(d.toISOString().slice(0, 10)); out.push(`<line x1="${xx}" x2="${xx}" y1="0" y2="${h}" stroke="var(--rule)"/><text x="${xx + 4}" y="${h - 4}">${["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][d.getUTCMonth()]}</text>`); } return out.join(""); }
  function timeline(a, offs) {
    const W = VW(), pl = NARROW() ? 44 : 58, pr_ = NARROW() ? 44 : 16, h1 = 150, gap = 18, h2 = 46, H = h1 + gap + h2 + 22;
    const x = (d) => pl + (Math.min(Math.max(ms(d), X0()), X1()) - X0()) / Math.max(1, X1() - X0()) * (W - pl - pr_);
    const ph = a ? a.ph.map(([t, v]) => [day(t), v]).filter((p) => p[1] != null) : [];
    let line = "";
    if (ph.length) {
      const vs = ph.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), pad = Math.max((hi - lo) * 0.35, hi * 0.08), y = (v) => 10 + (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (h1 - 20);
      let d = ""; ph.forEach(([t, v], i) => { d += i ? `H${x(t).toFixed(1)}V${y(v).toFixed(1)}` : `M${x(t).toFixed(1)} ${y(v).toFixed(1)}`; }); d += `H${x(a.gone || TODAY).toFixed(1)}`;
      line = `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2"/>${ph.map(([t, v]) => `<circle cx="${x(t)}" cy="${y(v)}" r="3.5" fill="var(--ink)"/><text class="lab" x="${x(t) + 6}" y="${y(v) - 7}">${eur(v)}</text>`).join("")}`
        + (a.first ? `<line x1="${x(a.first)}" x2="${x(a.first)}" y1="0" y2="${h1}" stroke="var(--ink)" stroke-dasharray="2 3"/><text x="${x(a.first) + 4}" y="10">neu</text>` : `<text x="${pl}" y="${h1 + 4}">← schon vor Beginn der Erfassung im Sortiment</text>`)
        + (a.gone ? `<line x1="${x(a.gone)}" x2="${x(a.gone)}" y1="0" y2="${h1}" stroke="var(--red)" stroke-dasharray="2 3"/><text x="${x(a.gone) - 4}" y="10" text-anchor="end" style="fill:var(--red)">ausgelistet</text>` : "");
    } else line = `<text x="${pl}" y="${h1 / 2}">kein regulärer Preis bekannt</text>`;
    const fy = h1 + gap;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Preis und Fundgrube über die Zeit">${axisMonths(x, H)}${line}
      <text x="${pl - 8}" y="${fy + 14}" text-anchor="end">Fund-</text><text x="${pl - 8}" y="${fy + 27}" text-anchor="end">grube</text><line x1="${pl}" x2="${W - pr_}" y1="${fy + h2}" y2="${fy + h2}" stroke="var(--rule)"/>
      ${offs.map((o) => { const x1 = x(o.base ? S.t0 : o.start), x2 = x(o.end || TODAY), yy = fy + 6 + ((o.disc ?? 0) / 75) * (h2 - 12); return `<line x1="${x1}" x2="${Math.max(x2, x1 + 3)}" y1="${yy}" y2="${yy}" stroke="${isMine(o.mid) ? "var(--blue)" : "var(--blue2)"}" stroke-width="${isMine(o.mid) ? 5 : 3}" stroke-linecap="round"><title>${esc(o.market)}: ${eur(o.price)} (−${o.disc ?? "?"} %), ${o.base ? "seit Beginn" : fD(o.start)}${o.end ? " bis " + fD(o.end) : " bis heute"}</title></line>`; }).join("")}
    </svg><div class="legend"><span><i style="background:var(--ink)"></i>regulärer Preis</span><span><i style="background:var(--blue)"></i>Fundgrube in meinen Märkten</span><span><i style="background:var(--blue2)"></i>Fundgrube anderswo</span><span>je höher im Band, desto mehr Rabatt</span></div>`;
  }
  function lanes(list, cur, label) {      // HTML statt SVG: am Handy Name über der Bahn, immer lesbar
    const pc = (d) => ((Math.min(Math.max(ms(d), X0()), X1()) - X0()) / Math.max(1, X1() - X0()) * 100).toFixed(2);
    const months = []; const t0 = new Date(X0()); for (let d = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + 1, 1)); +d <= X1(); d.setUTCMonth(d.getUTCMonth() + 1)) months.push([pc(d.toISOString().slice(0, 10)), ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][d.getUTCMonth()]]);
    const axis = `<div class="lt ax">${months.map(([x, l]) => `<span style="left:${x}%">${l}</span>`).join("")}</div>`;
    return `<div class="lanes"><div class="ln"><div class="ll"></div>${axis}</div>${list.map((a) => { const s0 = a.first || S.t0, e = a.gone || TODAY; return `<div class="ln" data-go="#/artikel?id=${encodeURIComponent(a.id)}"><div class="ll" style="font-weight:${a.id === cur ? 700 : 500}">${esc(label(a))}</div><div class="lt">${months.map(([x]) => `<s style="left:${x}%"></s>`).join("")}<i class="${a.gone ? "g" : ""} ${a.first ? "" : "pre"}" style="left:${pc(s0)}%;width:${Math.max(0.8, pc(e) - pc(s0))}%"></i>${a.first ? `<b style="left:${pc(a.first)}%"></b>` : ""}${a.gone ? `<em>ausgelistet ${fS(a.gone)}</em>` : ""}</div></div>`; }).join("")}</div>
      <div class="legend"><span><i style="background:var(--ink)"></i>im Sortiment</span><span><i style="background:var(--mark);border:1px solid var(--ink);border-radius:50%"></i>neu erschienen</span><span><i style="background:var(--mut)"></i>ausgelistet</span><span>verblasst links: schon vor Beginn der Erfassung</span></div>`;
  }
  function bars(rows, { fmt = nf, hl = () => false, max, pre = () => "", go } = {}) { const mx = max || Math.max(...rows.map((r) => r[1]), 1); return `<table style="width:100%"><tbody>${rows.map(([l, v, extra]) => `<tr ${go ? `data-go="${esc(go(l))}" style="cursor:pointer"` : ""}><td style="width:38%;padding:4px 12px 4px 0;font-size:13px;border:0;${hl(l) ? "font-weight:700" : ""}">${pre(l)}${esc(l)}</td><td style="padding:4px 12px 4px 0;border:0"><div class="trk"><i class="${hl(l) ? "hl" : ""}" style="width:${Math.max(0, v / mx * 100).toFixed(1)}%"></i></div></td><td class="r tn" style="padding:4px 0;font-size:13px;width:90px;border:0">${fmt(v)}${extra ? ` <span class="kd">${extra}</span>` : ""}</td></tr>`).join("")}</tbody></table>`; }
  function thumbs(rows, fmt = nf) { const mx = Math.max(...rows.map((r) => r.v), 1); return rows.map((r) => `<div class="tb" data-go="${esc(r.go)}"><img src="${esc(r.img)}" alt="" loading="lazy"><span><b>${esc(r.l)}</b><br><span class="kd">${esc(r.s || "")}</span></span><div class="trk"><i style="width:${(r.v / mx * 100).toFixed(1)}%"></i></div><span class="r tn">${fmt(r.v)}</span></div>`).join(""); }
  function strip(groups) {
    const W = VW(), nar = NARROW(), pl = nar ? 96 : 190, pr_ = nar ? 92 : 150, rh = 32, top = 22, H = groups.length * rh + top + 22, ticks = nar ? [10, 100, 1000] : [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000], lo = Math.log10(2), hi = Math.log10(6000), x = (v) => pl + (Math.log10(Math.max(v, 2)) - lo) / (hi - lo) * (W - pl - pr_);
    const tk = (y) => ticks.map((t) => `<text x="${x(t)}" y="${y}" text-anchor="middle">${nf(t)} €</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Preise je Bereich">${ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 18}" stroke="var(--rule)"/>`).join("")}${tk(10)}${tk(H - 4)}
      <text x="${W}" y="10" text-anchor="end">Median · Spanne</text>
      ${groups.map((g, i) => { const y = top + i * rh + 12, ps = g.items.map((a) => a.price).filter((p) => p != null), med = qn(ps, 0.5), sample = g.items.length > 400 ? g.items.filter((_, j) => j % Math.ceil(g.items.length / 400) === 0) : g.items; return `<text x="0" y="${y + 4}" class="lab">${esc(nar ? g.l.slice(0, 13) : g.l.slice(0, 26))}</text>${sample.map((a, j) => `<circle cx="${x(a.price)}" cy="${y + ((j % 3) - 1) * 4}" r="2.4" fill="var(--mut)" fill-opacity=".35"/>`).join("")}${med != null ? `<line x1="${x(med)}" x2="${x(med)}" y1="${y - 10}" y2="${y + 10}" stroke="var(--ink)" stroke-width="2"/><text x="${W}" y="${y}" text-anchor="end" class="lab">${eur0(med)}</text><text x="${W}" y="${y + 12}" text-anchor="end">${eur0(Math.min(...ps))}–${eur0(Math.max(...ps))}</text>` : ""}`; }).join("")}</svg><div class="legend"><span><i style="background:var(--mut);opacity:.5;border-radius:50%"></i>ein Artikel</span><span><i style="background:var(--ink);width:2px"></i>Median (rechts als Zahl, darunter günstigster bis teuerster)</span><span>Achse logarithmisch</span></div>`;
  }
  function weekBars(up, down, labels, { a = "neu", b = "ausgelistet" } = {}) {
    const W = VW(), pl = 34, pr_ = 6, H = 190, mid = 90, n = up.length, bw = (W - pl - pr_) / n, mx = Math.max(...up, ...down, 1), sc = 78 / mx;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${a} und ${b}"><line x1="${pl}" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--ink)"/>
      ${up.map((v, i) => `<rect x="${pl + i * bw + 1}" y="${mid - v * sc}" width="${Math.max(1, bw - 2)}" height="${v * sc}" fill="var(--ink)"><title>${labels[i]}: ${v} ${a}</title></rect>${v && n <= (NARROW() ? 13 : 30) ? `<text x="${pl + i * bw + bw / 2}" y="${mid - v * sc - 4}" text-anchor="middle">${v}</text>` : ""}`).join("")}
      ${down.map((v, i) => `<rect x="${pl + i * bw + 1}" y="${mid + 1}" width="${Math.max(1, bw - 2)}" height="${v * sc}" fill="var(--red)"><title>${labels[i]}: ${v} ${b}</title></rect>${v && n <= (NARROW() ? 13 : 30) ? `<text x="${pl + i * bw + bw / 2}" y="${mid + v * sc + 12}" text-anchor="middle">${v}</text>` : ""}`).join("")}
      ${labels.map((l, i) => (i % Math.ceil(n / (NARROW() ? 5 : 9)) ? "" : `<text x="${pl + i * bw + 2}" y="${H - 2}">${l}</text>`)).join("")}<text x="${pl - 6}" y="${mid - 70}" text-anchor="end">${a}</text><text x="${pl - 6}" y="${mid + 78}" text-anchor="end">${b}</text></svg>`;
  }
  function areaDays(vals, labels) {
    const W = VW(), H = 170, pl = 40, mx = Math.max(...vals, 1), n = vals.length, x = (i) => pl + i / Math.max(1, n - 1) * (W - pl - 8), y = (v) => 10 + (1 - v / mx) * (H - 34), pts = vals.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("L");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Verlauf">${[0.5, 1].map((k) => `<line x1="${pl}" x2="${W}" y1="${y(mx * k)}" y2="${y(mx * k)}" stroke="var(--rule)"/><text x="${pl - 6}" y="${y(mx * k) + 4}" text-anchor="end">${nf(Math.round(mx * k))}</text>`).join("")}<path d="M${pts}L${x(n - 1)} ${H - 24}L${pl} ${H - 24}Z" fill="var(--blue)" fill-opacity=".08"/><path d="M${pts}" fill="none" stroke="var(--blue)" stroke-width="2"/>${labels.map((l, i) => (i % Math.ceil(n / (NARROW() ? 4 : 7)) ? "" : `<text x="${x(i)}" y="${H - 4}">${l}</text>`)).join("")}</svg>`;
  }
  const spark = (a) => { const W = 70, H = 18, t0 = X0(), t1 = X1(), xs = (d) => (Math.min(Math.max(ms(d), t0), t1) - t0) / Math.max(1, t1 - t0) * W, ph = a.ph.filter((p) => p[1] != null), vs = ph.map((p) => p[1]); if (!vs.length) return ""; const lo = Math.min(...vs), hi = Math.max(...vs), y = (v) => (hi === lo ? H / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (H - 4)); let d = ""; ph.forEach(([t, v], i) => { d += i ? `H${xs(t).toFixed(1)}V${y(v).toFixed(1)}` : `M${xs(t).toFixed(1)} ${y(v).toFixed(1)}`; }); d += `H${xs(a.gone || TODAY).toFixed(1)}`; const c = lastChg(a); return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${c ? (c.to < c.from ? "var(--green)" : "var(--red)") : "var(--mut)"}" stroke-width="1.5"/></svg>`; };

  /* ================= Bausteine ================= */
  const favBtn = (no, label) => (no ? `<button class="fav ${FAVS().has(no) ? "on" : ""}" data-fav="${esc(no)}" data-label="${esc(label)}" aria-pressed="${FAVS().has(no)}" aria-label="${FAVS().has(no) ? "gemerkt" : "merken"}">${HEART}</button>` : "");
  const ausOf = (a) => [a.col, a.measure].filter(Boolean).join(" · ");
  const colOf = (a) => (a && a.col) || "";            // in Listen und Kacheln nur die Farbe, keine Maße
  const VK = (k) => S.view[k] === "kacheln";
  const vsw = (k) => `<span class="vsw" role="group" aria-label="Darstellung"><button data-vk="${k}" data-vv="liste" aria-pressed="${!VK(k)}">Liste</button><button data-vk="${k}" data-vv="kacheln" aria-pressed="${VK(k)}">Kacheln</button></span>`;
  const artList = (list, k) => (VK(k) ? tiles(list, false) : rowsSort(list, "aus", false));
  const offList = (list, k, bund = true) => (VK(k) ? tiles(list, true, bund) : rowsFund(list, false, bund));
  // gleiche Artikel bündeln: Gruppen in der Reihenfolge des ersten Auftretens
  const bk = (o) => (o.art && o.art.pk) || o.no || o.id;     // gleiches Produkt (alle Farben/Größen) = eine Gruppe
  const groupsOf = (list) => { const g = new Map(), out = []; for (const o of list) { const k = bk(o); if (!g.has(k)) { g.set(k, []); out.push(g.get(k)); } g.get(k).push(o); } return out; };
  const mkList = (l) => { const ids = [...new Set(l.map((o) => o.mid))].sort((x, y) => isMine(y) - isMine(x)), nm = (m) => (isMine(m) ? `<b>${esc(nameOf(m))}</b>` : esc(nameOf(m))); return ids.slice(0, 3).map(nm).join(", ") + (ids.length > 3 ? ` +${ids.length - 3}` : ""); };
  function bundled(list, row, sum) { return groupsOf(list).map((l) => (l.length === 1 ? row(l[0]) : sum(l) + (S.more["b" + bk(l[0])] ? l.map((o) => row(o).replace("<tr ", '<tr class="bsub" ')).join("") : ""))).join(""); }
  function intlHint(a) {          // praktischer Hinweis auf Artikelseiten: klein, mobil eingeklappt
    if (!a || !S.intl) return "";
    const ab = abroad(a).filter((x) => x.eur != null).sort((x, y) => x.eur - y.eur); if (!ab.length) return "";
    const pc = (x) => (a.price ? Math.round((x.eur / a.price - 1) * 100) : null), cheap = ab.filter((x) => x.eur < a.price * 0.995), best = ab[0], d = pc(best);
    const sum = cheap.length ? `ab <b>${eur(best.eur)}</b> in ${esc(CN(best.c.cc))} <span class="dn">−${Math.abs(d)} %</span> · ${cheap.length} von ${ab.length} Ländern günstiger` : `in keinem von ${ab.length} Ländern günstiger`;
    return `<details class="ih" ${innerWidth >= 820 ? "open" : ""}><summary><span class="kd">Andere Länder</span> ${sum}</summary><div class="ihl">${ab.map((x) => { const p = pc(x); return `<span title="${esc(CN(x.c.cc))}${x.c.cur !== "EUR" ? `: ${esc(local(x.c, x.v))}` : ""}"><b>${esc(x.c.cc.toUpperCase())}</b> ${eur0(x.eur)} <i class="${p < 0 ? "dn" : p > 0 ? "up" : ""}">${p === 0 ? "gleich" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`}</i></span>`; }).join("")}<span class="kd">Preis in Euro (EZB-Kurs) · Abweichung zum Preis in Deutschland</span></div></details>`;
  }
  const img = (src, alt = "") => (src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">` : "");
  const fundHint = (a) => { const n = fundNow().get(a.no); return n ? `<span class="fh"><b>${n.length} ${n.length === 1 ? "Angebot" : "Angebote"}</b> ab ${eur(Math.min(...n.map((o) => o.price)))}</span>` : ""; };
  const mineB = (o) => (isMine(o.mid) ? `<b>${esc(o.market)}</b>` : esc(o.market));
  const shortKind = (o) => (o.art ? o.art.kind : String(o.product_description || "").split(",")[0].slice(0, 48));
  const offerName = (o) => `${nv(o)}${esc(o.art ? o.art.name : o.title)} <span style="font-weight:400">${esc(shortKind(o))}</span>`;
  function rowsFund(list, sortable = true, bund = false) {
    const th = (k, l, c = "") => (sortable ? `<th class="${c}" data-sortby="${k}" ${S.sort.fund === k ? `aria-sort="${S.rev.fund ? "ascending" : "descending"}"` : ""}>${l}</th>` : `<th class="${c}">${l}</th>`);
    const sum = (l) => { const o = l[0], ps = l.map((x) => x.price), ds = l.map((x) => x.disc).filter((x) => x != null), op = S.more["b" + bk(o)];
      return `<tr class="bsum" data-bund="${esc(bk(o))}"><td class="im">${img(o.thumb)}</td><td><div class="nm">${offerName(o)}</div><div class="loc"><b>${l.length} Angebote</b>${new Set(l.map((x) => x.no)).size > 1 ? ` in ${new Set(l.map((x) => x.no)).size} Farben/Größen` : ""} · ${mkList(l)}</div><div class="kd vh">${o.art ? esc(colOf(o.art)) + " · " : ""}<span class="lnk">${op ? "zuklappen" : "alle zeigen"}</span></div></td><td class="hide kd">${esc([...new Set(l.map((x) => x.condition).filter(Boolean))].join(", "))}</td><td class="hide tn">${l.some((x) => x.active && !x.base) ? ago(Math.min(...l.filter((x) => x.active && !x.base).map((x) => x.age))) : ""}</td><td class="r">${Math.min(...ps) === Math.max(...ps) ? pr(ps[0]) : `<span class="kd">ab</span> ${pr(Math.min(...ps))}`}<div class="kd"><s>${eur(o.orig)}</s></div></td><td class="r tn dn">${ds.length ? `${Math.min(...ds) === Math.max(...ds) ? "" : "bis "}−${Math.max(...ds)} %` : ""}</td><td>${favBtn(o.no, o.art ? o.art.name : o.title)}</td></tr>`; };
    const row = (o) => `<tr data-go="#/angebot?id=${encodeURIComponent(o.id)}"><td class="im">${img(o.thumb)}</td><td><div class="nm">${offerName(o)}</div><div class="loc">${mineB(o)}<span class="only-m"> · ${esc(o.condition || "")}</span></div>${o.art ? `<div class="kd vh">${esc(colOf(o.art))}${o.art.gone ? " · <span class='up'>ausgelistet</span>" : ""}</div>` : ""}</td><td class="hide">${esc(o.condition || "–")}<div class="kd">${esc(o.reason_discount || "")}</div></td><td class="hide tn">${o.base ? "seit Beginn" : o.active ? ago(o.age) : `${fS(o.start)}–${fS(o.end)}<div class="kd">${daysBetween(o.start, o.end)} Tage da</div>`}</td><td class="r">${pr(o.price)}<div class="kd"><s>${eur(o.orig)}</s></div></td><td class="r tn dn">${o.disc != null ? `−${o.disc} %` : ""}</td><td>${favBtn(o.no, o.art ? o.art.name : o.title)}</td></tr>`;
    return `<div class="tw"><table><thead><tr><th></th>${th("markt", "Artikel und Markt")}<th class="hide">Zustand</th>${th("neu", "eingestellt", "hide")}${th("preis", "Preis", "r")}${th("rabatt", "Rabatt", "r")}<th></th></tr></thead><tbody>${bund ? bundled(list, row, sum) : list.map(row).join("")}</tbody></table></div>`;
  }
  function rowsSort(list, grp = "aus", sortable = true) {
    const th = (k, l, c = "") => (sortable ? `<th class="${c}" data-sortby="${k}" ${S.sort.sort === k ? `aria-sort="${S.rev.sort ? "ascending" : "descending"}"` : ""}>${l}</th>` : `<th class="${c}">${l}</th>`);
    const head = `<thead><tr><th></th>${th("name", "Artikel")}<th class="hide">Bereich</th>${th("preis", "Preis", "r")}${th("chg", "Verlauf", "hide")}${S.rng ? th("verb", "Märkte", "hide") : ""}<th class="hide">Fundgrube</th><th></th></tr></thead>`;
    const r = (a) => { const c = lastChg(a); return `<tr data-go="#/artikel?id=${encodeURIComponent(a.id)}"><td class="im">${img(a.thumb)}</td><td><div class="nm">${esc(a.name)} <span style="font-weight:400">${esc(a.kind)}</span>${a.first && day(a.first) >= dIso(30) ? ` <span class="chip">neu</span>` : ""}${a.gone ? ` <span class="chip up">ausgelistet</span>` : ""}${a.last && !a.gone ? ` <span class="chip">letzte Chance</span>` : ""}</div><div class="kd vh">${esc(colOf(a))}</div></td><td class="hide kd">${esc(a.sub || a.top)}</td><td class="r">${pr(a.price)}${a.prev ? `<div class="kd"><s>${eur(a.prev)}</s></div>` : c ? `<div class="kd tn ${c.to < c.from ? "dn" : "up"}" title="am ${fD(c.d)}" style="white-space:nowrap">${c.to < c.from ? "−" : "+"}${Math.abs(Math.round((c.to / c.from - 1) * 100))} % <span class="hide">am ${fS(c.d)}</span></div>` : ""}</td><td class="hide">${spark(a)}</td>${S.rng ? `<td class="hide tn">${a.nMk != null ? `<span class="bar5"><i style="width:${a.nMk / Math.max(1, a.nKn) * 100}%"></i></span>${a.nMk}` : "–"}</td>` : ""}<td class="hide">${fundHint(a)}</td><td>${favBtn(a.no, a.name)}</td></tr>`; };
    const cols = S.rng ? 8 : 7;
    if (grp === "aus") return `<div class="tw"><table>${head}<tbody>${list.map(r).join("")}</tbody></table></div>`;
    if (grp === "koll") list = list.filter((a) => a.coll);
    if (!list.length) return `<div class="empty">Keine Kollektion in dieser Auswahl. Kollektionen erkennt die App am Jahr im Namen, z. B. IKEA PS 2026.</div>`;
    const byProd = (l) => { const m = new Map(); for (const a of l) { const k = a.pk; m.set(k, [...(m.get(k) || []), a]); } return [...m.values()]; };
    const prodRow = (vs) => {
      const a = vs.find((x) => !x.gone) || vs[0], ps = vs.map((x) => x.price), cols = [...new Set(vs.flatMap((x) => x.cols.slice(0, 1)))], sizes = new Set(vs.map((x) => x.measure).filter(Boolean)).size;
      const total = Math.max(vs.length, ...vs.map((x) => x.nvar || 0)), offers = vs.reduce((n, x) => n + (fundNow().get(x.no)?.length || 0), 0), mk = Math.max(...vs.map((x) => x.nMk ?? -1));
      return `<tr data-go="#/artikel?id=${encodeURIComponent(a.id)}"><td class="im">${img(a.thumb)}</td><td><div class="nm">${esc(a.name)} <span style="font-weight:400">${esc(a.kind)}</span>${vs.every((x) => x.gone) ? ` <span class="chip up">ausgelistet</span>` : ""}</div>
        <div class="kd vh">${cols.length ? `${cols.length} ${cols.length === 1 ? "Farbe" : "Farben"}` : ""}${sizes > 1 ? `${cols.length ? ", " : ""}${sizes} Größen` : ""}${total > vs.length ? ` · ${total - vs.length} weitere bei IKEA, hier noch nicht erfasst` : ""}</div></td>
        <td class="hide kd">${esc(a.sub || a.top)}</td><td class="r">${Math.min(...ps) === Math.max(...ps) ? pr(ps[0]) : `<span class="kd">ab</span> ${pr(Math.min(...ps))}<div class="kd">bis ${eur(Math.max(...ps))}</div>`}</td><td class="hide">${spark(a)}</td>${S.rng ? `<td class="hide tn">${mk >= 0 ? mk : "–"}</td>` : ""}<td class="hide">${offers ? `<span class="fh"><b>${offers} ${offers === 1 ? "Angebot" : "Angebote"}</b></span>` : ""}</td><td>${favBtn(a.no, a.name)}</td></tr>`;
    };
    if (grp === "prod") return `<div class="tw"><table>${head}<tbody>${byProd(list).map(prodRow).join("")}</tbody></table></div>`;
    const g = new Map(); for (const a of list) g.set(a.name, [...(g.get(a.name) || []), a]);
    return `<div class="tw"><table>${head}<tbody>${[...g.values()].map((l) => { const ps = l.map((a) => a.price), prods = byProd(l); return `<tr class="grp"><td colspan="${cols}">${esc(grp === "koll" ? `Kollektion ${l[0].name}` : `Serie ${l[0].name}`)} · ${prods.length} ${prods.length === 1 ? "Produkt" : "Produkte"}, ${l.length} Artikel · ${Math.min(...ps) === Math.max(...ps) ? eur(ps[0]) : `${eur(Math.min(...ps))} bis ${eur(Math.max(...ps))}`}</td></tr>${prods.map(prodRow).join("")}`; }).join("")}</tbody></table></div>`;
  }
  const mini = (list) => `<div class="tw"><table><tbody>${list.map((a) => `<tr data-go="#/artikel?id=${encodeURIComponent(a.id)}"><td class="im">${img(a.thumb)}</td><td><div class="nm">${esc(a.name)} <span style="font-weight:400">${esc(a.kind)}</span></div><div class="kd">${esc(colOf(a))}${a.nMk != null ? `${a.col ? " · " : ""}in ${a.nMk} Märkten` : ""}</div></td><td class="r">${pr(a.price)}</td></tr>`).join("")}</tbody></table></div>`;
  function tiles(list, fund, bund = false) {
    const sumT = (l) => { const o = l[0], a = o.art, ps = l.map((x) => x.price), ds = l.map((x) => x.disc).filter((x) => x != null); return `<div data-go="${new Set(l.map((x) => x.no)).size > 1 && a ? `#/artikel?id=${encodeURIComponent(a.id)}` : `#/produkt?art=${encodeURIComponent(o.no)}`}">${favBtn(o.no, a ? a.name : o.title)}${img(o.thumb)}<div class="n">${nv(o)}${esc(a ? a.name : o.title)}</div><div class="k">${esc(shortKind(o))}${a && a.col ? `<br>${esc(a.col)}` : ""}</div>
      <div class="p"><span class="kd">ab</span> ${pr(Math.min(...ps))}<s class="kd">${eur(o.orig)}</s>${ds.length ? `<span class="dn tn">bis −${Math.max(...ds)} %</span>` : ""}</div><div class="f"><b>${l.length} Angebote</b>${new Set(l.map((x) => x.no)).size > 1 ? ` in ${new Set(l.map((x) => x.no)).size} Farben/Größen` : ""} · <span class="loc">${mkList(l)}</span></div></div>`; };
    if (fund && bund) return `<div class="imgs">${groupsOf(list).map((l) => (l.length > 1 ? sumT(l) : tiles([l[0]], true).slice(18, -6))).join("")}</div>`;
    return `<div class="imgs">${list.map((o) => { const a = fund ? o.art : o, c = a ? lastChg(a) : null; return `<div data-go="${fund ? `#/angebot?id=${encodeURIComponent(o.id)}` : `#/artikel?id=${encodeURIComponent(o.id)}`}">${favBtn(o.no, a ? a.name : o.title)}${img(fund ? o.thumb : o.thumb)}<div class="n">${fund ? nv(o) : ""}${esc(a ? a.name : o.title)}</div><div class="k">${esc(fund ? shortKind(o) : a.kind)}${a && a.col ? `<br>${esc(a.col)}` : ""}</div>
      <div class="p">${pr(o.price)}${fund ? `<s class="kd">${eur(o.orig)}</s>${o.disc != null ? `<span class="dn tn">−${o.disc} %</span>` : ""}` : a.prev ? `<s class="kd">${eur(a.prev)}</s>` : c && c.d >= dIso(30) ? `<span class="tn ${c.to < c.from ? "dn" : "up"}">${c.to < c.from ? "−" : "+"}${Math.abs(Math.round((c.to / c.from - 1) * 100))} %</span>` : ""}</div>
      <div class="f">${fund ? `<span class="loc">${mineB(o)}</span> · ${esc(o.condition || "")} · ${o.active ? (o.base ? "seit Beginn" : ago(o.age)) : "weg"}` : `${o.nMk != null ? `${o.nMk} Märkte` : ""}${fundNow().has(o.no) ? `${o.nMk != null ? " · " : ""}<b>${fundNow().get(o.no).length} in der Fundgrube</b>` : ""}`}</div></div>`; }).join("")}</div>`;
  }
  // Kacheln mit Gruppierung: eine Kachel je Produkt (alle Farben und Größen zusammen), bei Serie/Kollektion mit Zwischenüberschrift
  function tilesGrouped(list, grp) {
    const prods = new Map(); for (const a of list) { const k = a.pk; prods.set(k, [...(prods.get(k) || []), a]); }
    let last = null, out = "";
    for (const vs of prods.values()) {
      const a = vs.find((x) => !x.gone) || vs[0], ps = vs.map((x) => x.price), cols = [...new Set(vs.flatMap((x) => x.cols.slice(0, 1)))], total = Math.max(vs.length, ...vs.map((x) => x.nvar || 0)), offers = vs.reduce((n, x) => n + (fundNow().get(x.no)?.length || 0), 0);
      if (grp !== "prod" && a.name !== last) { last = a.name; out += `<div class="tg">${esc(grp === "koll" ? "Kollektion " : "Serie ")}${esc(a.name)}</div>`; }
      out += `<div data-go="#/artikel?id=${encodeURIComponent(a.id)}">${favBtn(a.no, a.name)}${img(a.thumb)}<div class="n">${esc(a.name)}</div><div class="k">${esc(a.kind)}</div>
        <div class="p">${Math.min(...ps) === Math.max(...ps) ? pr(ps[0]) : `<span class="kd">ab</span> ${pr(Math.min(...ps))}`}</div>
        <div class="f vh">${vs.length} ${vs.length === 1 ? "Farbe/Größe" : "Farben/Größen"}${total > vs.length ? `, ${total - vs.length} weitere bei IKEA` : ""}${offers ? ` · <b>${offers} in der Fundgrube</b>` : ""}</div></div>`;
    }
    return `<div class="imgs">${out}</div>`;
  }
  const gTiles = (rows) => `<div class="imgs">${rows.map((r) => `<div data-go="${esc(r.go)}">${r.img ? img(r.img) : "<span></span>"}<div class="n">${esc(r.l)}</div><div class="k">${esc(r.s || "")}</div>${r.p ? `<div class="p">${r.p}</div>` : ""}</div>`).join("")}</div>`;
  const hV = (t, k = "ana") => `<div class="h"><h2>${t}</h2>${vsw(k)}</div>`;
  // Abschnitts-Sortierung: Auswahl + Richtung; kind "sort" (Artikel) oder "fund" (Angebote)
  const SS_L = { sort: [["chg", "letzte Änderung"], ["neu", "neueste"], ["preis", "Preis aufsteigend"], ["teuer", "Preis absteigend"], ["senk", "größte Preissenkung"], ["verb", "seltenste (Märkte)"], ["bew", "Bewertung"], ["name", "Name"]], fund: [["neu", "neueste"], ["preis", "Preis aufsteigend"], ["teuer", "Preis absteigend"], ["rabatt", "Rabatt"], ["spar", "Ersparnis in €"], ["zust", "Zustand"], ["markt", "Markt, meine zuerst"]] };
  const ssort = (list, key, kind, def) => { const c = S.ss[key] || {}, k = c.k || def; if (!k) return list; const out = list.slice().sort(SORTS[kind][k]); return c.rev ? out.reverse() : out; };
  const sortCtl = (key, kind, def) => { const c = S.ss[key] || {}, k = c.k || def || ""; return `<span class="ssel"><select data-ssel="${key}" aria-label="Sortierung">${k ? "" : `<option value="" selected>Sortierung …</option>`}${SS_L[kind].map(([v, l]) => `<option value="${v}" ${v === k ? "selected" : ""}>${l}</option>`).join("")}</select><button data-srev="${key}" title="Reihenfolge umkehren" aria-label="Reihenfolge umkehren">${c.rev ? "↑" : "↓"}</button></span>`; };
  // sortierbare Tabelle: cols [{k, l, num, fmt, cls, bar, v}], rows = Objekte; Kopf antippen sortiert, nochmal antippen kehrt um
  function stab(id, cols, rows, { def, go, lim = 0, hl, ra } = {}) {
    const c = S.ts[id] || { k: def || cols[1]?.k || cols[0].k, rev: false }, col = cols.find((x) => x.k === c.k) || cols[0], val = (r, x) => (x.v ? x.v(r) : r[x.k]);
    const sorted = rows.slice().sort((a, b) => { const va = val(a, col), vb = val(b, col); const r = col.num ? (vb ?? -Infinity) - (va ?? -Infinity) : String(va ?? "").localeCompare(String(vb ?? ""), "de"); return c.rev ? -r : r; });
    const mx = {}; cols.filter((x) => x.bar).forEach((x) => { mx[x.k] = Math.max(1, ...rows.map((r) => Math.abs(val(r, x)) || 0)); });
    const shown = lim && !S.more["t" + id] ? sorted.slice(0, lim) : sorted;
    return `<div class="tw"><table class="st"><thead><tr>${cols.map((x) => `<th class="${x.num ? "r" : ""} ${x.cls || ""}" data-ts="${id}|${x.k}" ${x.k === col.k ? `aria-sort="${(col.num ? !c.rev : c.rev) ? "descending" : "ascending"}"` : ""}>${x.l}</th>`).join("")}</tr></thead><tbody>${shown.map((r) => `<tr ${go ? `data-go="${esc(go(r))}"` : ""} ${ra ? ra(r) : ""} class="${hl && hl(r) ? "me" : ""}">${cols.map((x) => { const v = val(r, x); return `<td class="${x.num ? "r tn" : ""} ${x.cls || ""}">${x.bar && v ? `<span class="ib"><i style="width:${(Math.abs(v) / mx[x.k] * 100).toFixed(1)}%"></i></span>` : ""}${x.fmt ? x.fmt(v, r) : esc(v ?? "–")}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>${lim && sorted.length > lim ? `<button class="lnk" data-more="t${id}">${S.more["t" + id] ? "weniger" : `alle ${nf(sorted.length)} zeigen`}</button>` : ""}`;
  }
  const moreBtn = (n) => (n > S.shown ? `<p><button class="btn" data-showmore>${nf(Math.min(150, n - S.shown))} weitere zeigen (${nf(n - S.shown)} übrig)</button></p>` : "");

  /* ================= Seiten ================= */
  function pageStart() {
    const fa = FA(), searches = searchRules(), favNos = [...FAVS()], mine = MINE();
    const hitsS = searches.filter((r) => r.enabled !== false).map((r) => ({ r, l: ruleHits(r) }));
    const row = (o) => `<tr data-go="#/angebot?id=${encodeURIComponent(o.id)}"><td class="im">${img(o.thumb)}</td><td><div class="nm">${offerName(o)}</div><div class="loc">${mineB(o)} · ${esc(o.condition || "")} · ${o.base ? "seit Beginn" : ago(o.age)}</div></td><td class="r">${pr(o.price)}<div class="kd"><s>${eur(o.orig)}</s>${o.disc != null ? ` −${o.disc} %` : ""}</div></td></tr>`;
    const sum = (l) => { const o = l[0], op = S.more["b" + bk(o)]; return `<tr class="bsum" data-bund="${esc(bk(o))}"><td class="im">${img(o.thumb)}</td><td><div class="nm">${offerName(o)}</div><div class="loc"><b>${l.length} Angebote</b>${new Set(l.map((x) => x.no)).size > 1 ? ` in ${new Set(l.map((x) => x.no)).size} Farben/Größen` : ""} · ${mkList(l)} · <span class="lnk">${op ? "zuklappen" : "alle zeigen"}</span></div></td><td class="r"><span class="kd">ab</span> ${pr(Math.min(...l.map((x) => x.price)))}<div class="kd"><s>${eur(o.orig)}</s></div></td></tr>`; };
    const tv = VK("start"), LIM = 12;
    // 1) Treffer der Merkliste: je gemerktem Artikel und je Suche, gleiche Artikel gebündelt
    const favArts = favNos.map((no) => ({ no, a: S.kat.byNo.get(no), l: fa.filter((o) => o.no === no) })).filter((x) => x.l.length);
    const blocks = [...favArts.map((x) => ({ t: `Gemerkt: ${x.a ? `${x.a.name} ${x.a.kind}` : fNo(x.no)}`, l: ssort(x.l, "st-hit", "fund", "preis") })), ...hitsS.filter((x) => x.l.length).map((x) => ({ t: `Suche: ${ruleText(x.r)}`, l: ssort(x.l, "st-hit", "fund", "preis"), r: x.r }))];
    const hitsHtml = blocks.length ? (tv ? blocks.map((b) => `<div class="tg">${esc(b.t)} · ${b.l.length}${b.r ? ` <button class="lnk" data-runsearch="${esc(b.r.id)}">alle ansehen</button>` : ""}</div>${tiles(groupsOf(b.l).slice(0, LIM).flat(), true, true)}`).join("")
      : `<div class="tw"><table><tbody>${blocks.map((b) => { const gs = groupsOf(b.l); return `<tr class="grp"><td colspan="3">${esc(b.t)} · ${b.l.length} ${b.l.length === 1 ? "Angebot" : "Angebote"}${gs.length < b.l.length ? `, ${gs.length} Artikel` : ""}</td></tr>${bundled(gs.slice(0, 4).flat(), row, sum)}${gs.length > 4 && b.r ? `<tr><td colspan="3"><button class="lnk" data-runsearch="${esc(b.r.id)}">alle ${b.l.length} ansehen</button></td></tr>` : ""}`; }).join("")}</tbody></table></div>`)
      : `<p class="kd">${favNos.length || searches.length ? "Gerade passt kein Angebot zu deiner Merkliste." : "Noch nichts gemerkt: Herz an einem Artikel oder eine Suche in der Fundgrube merken."}</p>`;
    // 2) Neu in der Fundgrube (meine Märkte; ohne Märkte: alle), seit dem letzten Besuch bzw. 24 Stunden
    const fresh = (o) => !o.base && (S.prevVisit ? isNewV(o) : o.age < 1), newF = ssort(fa.filter((o) => (!mine.length || isMine(o.mid)) && fresh(o)), "st-new", "fund", "neu"), gF = groupsOf(newF);
    // 3) Neu im Sortiment und 4) Preisänderungen: je Produkt gebündelt
    const items = S.kat.items.filter((a) => !a.stub);
    const prodGroups = (l) => { const m = new Map(); for (const a of l) m.set(a.pk, [...(m.get(a.pk) || []), a]); return [...m.values()]; };
    const newS = prodGroups(ssort(items.filter((a) => a.first && day(a.first) >= dIso(30)), "st-sort", "sort", "neu"));
    const chgL = items.filter((a) => { const c = lastChg(a); return c && c.d >= dIso(30); });
    const chgS = prodGroups(ssort(chgL, "st-chg", "sort", "chg")).sort((x, y) => x.some((a) => FAVS().has(a.no)) === y.some((a) => FAVS().has(a.no)) ? 0 : x.some((a) => FAVS().has(a.no)) ? -1 : 1);
    const prodRowS = (vs, extra) => { const a = vs[0], ps = vs.map((x) => x.price); return `<tr data-go="#/artikel?id=${encodeURIComponent(a.id)}"><td class="im">${img(a.thumb)}</td><td><div class="nm">${esc(a.name)} <span style="font-weight:400">${esc(a.kind)}</span>${FAVS().has(a.no) ? ` <span class="kd">· gemerkt</span>` : ""}</div><div class="kd">${vs.length > 1 ? `${vs.length} Farben/Größen` : esc(colOf(a))}${extra ? ` · ${extra(a)}` : ""}</div></td><td class="r">${Math.min(...ps) === Math.max(...ps) ? pr(ps[0]) : `<span class="kd">ab</span> ${pr(Math.min(...ps))}`}</td></tr>`; };
    const chgTxt = (a) => { const c = lastChg(a); return `<span class="${c.to < c.from ? "dn" : "up"}">${c.to < c.from ? "gesenkt" : "erhöht"} ${Math.abs(Math.round((c.to / c.from - 1) * 100))} %</span> am ${fS(c.d)} (vorher ${eur(c.from)})`; };
    const prodBlock = (gs, extra) => (tv ? tilesGrouped(gs.slice(0, LIM).flat(), "prod") : `<div class="tw"><table><tbody>${gs.slice(0, LIM).map((vs) => prodRowS(vs, extra)).join("")}</tbody></table></div>`);
    const sec = (title, kd, ctl, body, more) => `<div class="sec"><div class="h"><h2>${title}</h2><span class="kd">${kd}</span>${ctl}${vsw("start")}</div>${body}${more || ""}</div>`;
    const learning = !S.kat.meta?.baseline_until;
    return `<div class="start">
      ${sec("Treffer der Merkliste", "aktuelle Angebote · gleiche Artikel gebündelt", sortCtl("st-hit", "fund", "preis"), hitsHtml)}
      ${sec(`Neu in der Fundgrube${mine.length ? " meiner Märkte" : ""}`, `${S.prevVisit ? `seit ${fDT(S.prevVisit)}` : "letzte 24 Stunden"} · ${nf(newF.length)} Angebote, ${nf(gF.length)} Artikel`, sortCtl("st-new", "fund", "neu"), gF.length ? offList(gF.slice(0, LIM).flat(), "start") : `<p class="kd">Nichts Neues.</p>`, gF.length > LIM ? `<p><button class="lnk" data-go="#/fundgrube" data-pre="newmine">alle ${nf(newF.length)} in der Fundgrube</button></p>` : "")}
      ${sec("Neu im Sortiment", learning ? "Anlernphase: bis alle Lücken geschlossen sind, zählt alles als Startbestand" : `letzte 30 Tage · ${nf(newS.length)} Produkte`, learning ? "" : sortCtl("st-sort", "sort", "neu"), newS.length ? prodBlock(newS) : `<p class="kd">${learning ? "Neuheiten erscheinen hier nach der Anlernphase." : "Keine Neuheiten."}</p>`, newS.length > LIM ? `<p><button class="lnk" data-go="#/sortiment" data-pre="${esc(JSON.stringify({ neu: "30" }))}">alle im Sortiment</button></p>` : "")}
      ${sec("Preisänderungen", `letzte 30 Tage · gemerkte zuerst · ${nf(chgS.length)} Produkte`, sortCtl("st-chg", "sort", "chg"), chgS.length ? prodBlock(chgS, chgTxt) : `<p class="kd">Keine.</p>`, chgS.length > LIM ? `<p><button class="lnk" data-go="#/sortiment" data-pre="${esc(JSON.stringify({ chg: "any" }))}">alle im Sortiment</button></p>` : "")}
    </div>`;
  }
  const SORTS = {
    fund: { neu: (a, b) => (b.base ? "" : b.first_seen || "").localeCompare(a.base ? "" : a.first_seen || ""), preis: (a, b) => a.price - b.price, teuer: (a, b) => b.price - a.price, rabatt: (a, b) => (b.disc ?? -1) - (a.disc ?? -1), spar: (a, b) => ((b.orig || 0) - b.price) - ((a.orig || 0) - a.price), zust: (a, b) => condRank(a) - condRank(b) || a.price - b.price, markt: (a, b) => (isMine(b.mid) - isMine(a.mid)) || a.market.localeCompare(b.market, "de") },
    sort: { senk: (a, b) => chgPct(a) - chgPct(b), red: (a, b) => redPct(b) - redPct(a), bewn: (a, b) => b.rcount - a.rcount, chg: (a, b) => (lastChg(b)?.d || day(b.first) || "").localeCompare(lastChg(a)?.d || day(a.first) || ""), preis: (a, b) => a.price - b.price, teuer: (a, b) => b.price - a.price, neu: (a, b) => (day(b.first) || "").localeCompare(day(a.first) || ""), verb: (a, b) => (a.nMk ?? 999) - (b.nMk ?? 999), bew: (a, b) => b.rating - a.rating || b.rcount - a.rcount, name: (a, b) => a.name.localeCompare(b.name, "de") || a.kind.localeCompare(b.kind, "de") },
  };
  const condRank = (o) => { const c = fold(o.condition || ""); return /neu|new/.test(c) ? 0 : /sehr gut/.test(c) ? 1 : /gut/.test(c) ? 2 : /ordnung|akzept/.test(c) ? 3 : 4; };
  const chgPct = (a) => { const c = lastChg(a); return c && c.from ? (c.to / c.from - 1) * 100 : 0; };
  const redPct = (a) => (a.prev ? (1 - a.price / a.prev) * 100 : 0);
  const SORT_L = { fund: [["neu", "neueste zuerst"], ["preis", "günstigste zuerst"], ["teuer", "teuerste zuerst"], ["rabatt", "höchster Rabatt in % zuerst"], ["spar", "größte Ersparnis in € zuerst"], ["zust", "bester Zustand zuerst"], ["markt", "nach Markt, meine zuerst"]], sort: [["chg", "letzte Änderung zuerst"], ["neu", "neueste zuerst"], ["senk", "größte Preissenkung zuerst"], ["red", "höchste Reduzierung zuerst"], ["preis", "günstigste zuerst"], ["teuer", "teuerste zuerst"], ["bew", "beste Bewertung zuerst"], ["bewn", "meiste Bewertungen zuerst"], ["verb", "seltenste zuerst (Märkte)"], ["name", "Name A–Z"]] };
  function pageList(tab, opts = {}) {
    if (S.grp === "prod") S.grp = "aus";
    const f = S.f[tab]; let list = apply(tab, f).sort(SORTS[tab][S.sort[tab]] || SORTS[tab][Object.keys(SORTS[tab])[0]]); if (S.rev[tab]) list.reverse();
    if (tab === "sort" && S.grp !== "aus") {          // Gruppen zusammenhalten, Reihenfolge nach erstem Auftreten in der gewählten Sortierung
      if (S.grp === "koll") list = list.filter((a) => a.coll);
      const key = (a) => (S.grp === "prod" ? a.pk : a.name), first = new Map(), idx = new Map();
      list.forEach((a, i) => { idx.set(a, i); if (!first.has(key(a))) first.set(key(a), i); });
      list.sort((a, b) => first.get(key(a)) - first.get(key(b)) || idx.get(a) - idx.get(b));
    }
    const gs = tab === "fund" ? groupsOf(list) : null, nUnits = gs ? gs.length : list.length;
    const tmBar0 = `<div class="tm">${S.asof ? `<b>Zeitmaschine:</b> so war es am ${fD(S.asof)}. Preise, Erscheinen und Auslisten sind rekonstruiert${tab === "sort" && S.rng ? "; Verfügbarkeit je Markt zeigt die jüngste Messung" : ""}. <button class="lnk" data-asof-off>zurück zu heute</button>` : `<span class="kd">Stand am</span>`} <input type="date" id="asof-${tab}" data-asof min="${S.t0 || ""}" max="${TODAY}" value="${S.asof || ""}" aria-label="Stand an einem früheren Tag"></div>`;
    const cnt = `${nf(list.length)} ${tab === "fund" ? "Angebote" : "Artikel"}${tab === "fund" && nUnits < list.length ? ` · ${nf(nUnits)} Artikel` : ""}`;
    const viewSeg = tab === "fund" ? `<button data-view="liste" aria-pressed="${S.view.fund !== "kacheln"}">Liste</button><button data-view="kacheln" aria-pressed="${S.view.fund === "kacheln"}">Kacheln</button>`
      : `<span class="lab">Ansicht</span><button data-grp="aus" aria-pressed="${S.grp !== "serie" && S.grp !== "koll"}">einzeln</button><button data-grp="serie" aria-pressed="${S.grp === "serie"}">Serien</button><button data-grp="koll" aria-pressed="${S.grp === "koll"}">Kollektionen</button><span class="lab">·</span><button data-view="liste" aria-pressed="${S.view.sort !== "kacheln"}">Liste</button><button data-view="kacheln" aria-pressed="${S.view.sort === "kacheln"}">Kacheln</button>`;
    const isCustom = Object.keys(f).some((k) => on(f[k]));
    const g = tab === "fund" && isCustom ? goodPrice(f) : null;
    const part = gs ? gs.slice(0, S.shown).flat() : list.slice(0, S.shown);
    const body = !list.length ? `<div class="empty">Kein ${tab === "fund" ? "Angebot" : "Artikel"} passt zu diesem Satz. Entferne eine Angabe.</div>` : S.view[tab] === "kacheln" ? (tab === "sort" && S.grp !== "aus" ? tilesGrouped(part, S.grp) : tiles(part, tab === "fund", tab === "fund")) : tab === "fund" ? rowsFund(part, true, true) : rowsSort(part, S.grp);
    if (opts.embedded) return `<div class="lay">${innerWidth >= 1000 ? sideFilters(tab, f) : ""}<div style="min-width:0">${filterBar(tab, f, { qid: "q-tm", noSave: true })}<p class="cnt">${cnt} am ${fD(S.asof)}</p>${body}${moreBtn(nUnits)}</div></div>`;
    return `<div class="lay" style="margin-top:14px">${innerWidth >= 1000 && !opts.noSide ? sideFilters(tab, f) : ""}<div style="min-width:0">${filterBar(tab, f)}<p class="cnt">${cnt}${tab === "sort" ? ` · von ${nf(S.kat.items.filter((a) => !a.stub && !a.gone).length)} erfassten` : ""}</p>
      ${g ? `<div class="gp"><b>Was ist ein guter Preis?</b> ${g.full ? "Seit Beginn der Erfassung" : "Unter den aktuellen Angeboten"} passten ${nf(g.n)} Angebote zu dieser Suche. Das günstigste Viertel lag unter <b>${eur(g.q1)}</b>, das günstigste bei ${eur(g.lo)}.${g.dw != null ? ` Ein Angebot war meist nach ${g.dw} Tagen weg.` : ""}</div>` : ""}
      ${body}${moreBtn(nUnits)}</div></div>`;
  }
  // Kern-Details eines Sortimentsartikels – auf jeder Artikel-, Angebots- und Produktseite gleich
  function coreFacts(a, extra = "") {
    if (!a) return extra ? `<dl class="kv">${extra}</dl>` : "";
    const D = S.details?.get(a.id), F = S.facets, dOk = D?.dv === "2", people = dOk ? F?.ppl.get(a.id) || (D.designer ? [D.designer] : []) : [];
    const missMine = S.rng ? MINE().filter((m) => carries(a, m) === false) : [];
    return `${D?.desc ? `<p class="kd" style="margin:12px 0 0;max-width:62ch;color:var(--ink2)">${esc(D.desc)}</p>` : ""}
      <dl class="kv">${extra}<dt>Design</dt><dd>${people.length && !IOS.test(people[0]) ? people.map((n) => `<button class="lnk" data-desfilter="${esc(n)}">${esc(n)}</button> ${followBtn("des", n)}`).join(", ") + (D?.designer && people.join("/") !== D.designer ? ` <span class="kd">(bei IKEA: ${esc(D.designer)})</span>` : "") : dOk ? "<span class='kd'>kein Name genannt (IKEA of Sweden)</span>" : D ? "<span class='kd'>wird neu geprüft</span>" : "<span class='kd'>noch nicht abgerufen</span>"}</dd>
        ${D?.material ? `<dt>Material</dt><dd>${esc(D.material)}</dd>` : ""}<dt>Farbe/Größe</dt><dd>${esc(ausOf(a) || "–")}${a.nvar > 1 ? ` <span class="kd">· ${a.nvar} Farben/Größen insgesamt</span>` : ""}</dd>${D && (D.w || D.h || D.d) ? `<dt>Maße</dt><dd>${esc([D.w && `B ${D.w}`, D.h && `H ${D.h}`, D.d && `T ${D.d}`].filter(Boolean).join(" · "))}</dd>` : ""}
        <dt>Kategorie</dt><dd><button class="lnk" data-crumb="${esc(JSON.stringify({ bereich: [a.top] }))}">${esc(a.top)}</button>${a.sub ? ` › <button class="lnk" data-crumb="${esc(JSON.stringify({ bereich: [a.top], sub: [a.sub] }))}">${esc(a.sub)}</button>` : ""}${a.sub2 ? ` › <button class="lnk" data-crumb="${esc(JSON.stringify({ bereich: [a.top], sub: [a.sub], sub2: [a.sub2] }))}">${esc(a.sub2)}</button>` : ""}</dd>
        <dt>Serie</dt><dd><button class="lnk" data-crumb="${esc(JSON.stringify({ q: seriesOf(a) }))}">${esc(seriesOf(a))}</button> ${followBtn("serie", seriesOf(a))}</dd>
        ${a.coll ? `<dt>Kollektion</dt><dd><button class="lnk" data-crumb="${esc(JSON.stringify({ coll: [a.coll], stand: "auch" }))}">${esc(a.coll)}</button> ${followBtn("koll", a.coll)}</dd>` : ""}
        <dt>Preis im Sortiment</dt><dd>${eur(a.price)}${a.prev ? ` <span class="kd">vorher ${eur(a.prev)}</span>` : ""}</dd>
        <dt>Bewertung</dt><dd>${a.rcount ? `${String(a.rating).replace(".", ",")} von 5 · ${nf(a.rcount)} Stimmen` : "–"}</dd><dt>Im Sortiment</dt><dd>${a.first ? `seit ${fD(day(a.first))}` : "schon vor Beginn der Erfassung"}${a.gone ? ` · <span class="up">ausgelistet am ${fD(day(a.gone))}</span>` : ""}${a.last && !a.gone ? " · <b>letzte Chance</b>" : ""}</dd>
        ${S.rng ? `<dt>Märkte</dt><dd>${a.nMk != null ? `${a.nMk} von ${a.nKn}` : "noch nicht gemessen"}${MINE().length ? (missMine.length ? ` · <span class="up">fehlt in ${esc(missMine.map(nameOf).join(", "))}</span>` : " · in deinen Märkten") : ""}</dd>` : ""}</dl>`;
  }
  // Serie auf der Artikelseite: Kacheln je Produkt (alle Farben/Größen), Zeitleiste nur für Varianten, die neu kamen oder gingen
  function serieTiles(a, serie, prods) {
    if (serie.length < 2) return "";
    const byKind = new Map(); for (const x of (S.ss["art-ser"]?.k ? ssort(serie, "art-ser", "sort") : serie.slice().sort((p, q) => (p.gone ? 1 : 0) - (q.gone ? 1 : 0) || p.price - q.price))) byKind.set(x.kind, [...(byKind.get(x.kind) || []), x]);
    const kinds = [...byKind].sort((p, q) => (q[0] === a.kind) - (p[0] === a.kind) || q[1].length - p[1].length);
    const tile = (x) => { const n = fundNow().get(x.no)?.length || 0; return `<div data-go="#/artikel?id=${encodeURIComponent(x.id)}" class="${x.id === a.id ? "cur" : ""}${x.gone ? " gone" : ""}">${img(x.thumb)}<div class="k">${esc(ausOf(x) || "–")}</div><div class="p">${pr(x.price)}</div><div class="f">${x.first ? `<span class="chip">neu ${fS(day(x.first))}</span> ` : ""}${x.gone ? `<span class="chip up">ausgelistet</span> ` : ""}${n ? `<b>${n} in der Fundgrube</b>` : ""}</div></div>`; };
    const chg = serie.filter((x) => x.first || x.gone);
    return `<div class="sec"><div class="h"><h2>${serie.length > prods.length ? `Serie ${esc(a.name)}` : "Farben und Größen"}</h2><span class="kd">${byKind.size} ${byKind.size === 1 ? "Produkt" : "Produkte"} · ${serie.length} Artikel${chg.length ? ` · ${chg.length} neu oder ausgelistet seit Beginn` : ""}</span>${sortCtl("art-ser", "sort")}</div>
      ${kinds.map(([k, l]) => `<div class="tg2">${esc(k)} <span class="kd">${l.length}</span></div><div class="imgs sm">${l.map(tile).join("")}</div>`).join("")}
      ${chg.length ? `<h2 style="margin-top:20px">Neu oder ausgelistet</h2>${lanes(chg.sort((p, q) => (day(q.first || q.gone) || "").localeCompare(day(p.first || p.gone) || "")).slice(0, 30), a.id, (x) => [x.kind, ausOf(x)].filter(Boolean).join(", "))}` : ""}</div>`;
  }
  function pageArticle(a) {
    const prods = S.kat.items.filter((x) => !x.stub && x.pk === a.pk), serie = S.kat.items.filter((x) => !x.stub && x.name === a.name);
    const now = fundNow().get(a.no) || [], all = fundAll().get(a.no) || [], c = lastChg(a), D = S.details?.get(a.id), F = S.facets;
    const people = D?.dv === "2" ? F?.ppl.get(a.id) || (D.designer ? [D.designer] : []) : [];
    const missMine = S.rng ? MINE().filter((m) => carries(a, m) === false) : [];
    const gallery = [...new Set([a.img, a.ctx, ...((D?.imgs || "").split("|"))].filter(Boolean))].slice(0, 8);
    const yes = S.rng ? S.rng.st.filter((s) => carries(a, s.id)) : [], no = S.rng ? S.rng.st.filter((s) => carries(a, s.id) === false) : [];
    const show = yes.length <= no.length ? ["nur in", yes] : ["fehlt in", no];
    return `<button class="back" data-back>← zurück</button>
      <div class="top2"><div><div class="big" id="bigimg">${img(a.img ? `${K_IMG}${a.img}?f=s` : "")}</div>${gallery.length > 1 ? `<div class="alts" role="group" aria-label="Fotos">${gallery.map((g2, i) => `<button data-gal="${esc(`${K_IMG}${g2}?f=s`)}" aria-pressed="${i === 0}" aria-label="Foto ${i + 1}">${img(`${K_IMG}${g2}?f=xxs`)}</button>`).join("")}</div>` : ""}</div><div>
        <div class="crumb"><button class="lnk" data-crumb="">Sortiment</button> › <button class="lnk" data-crumb="${esc(JSON.stringify({ bereich: [a.top] }))}">${esc(a.top)}</button>${a.sub ? ` › <button class="lnk" data-crumb="${esc(JSON.stringify({ bereich: [a.top], sub: [a.sub] }))}">${esc(a.sub)}</button>` : ""}${a.sub2 ? ` › <button class="lnk" data-crumb="${esc(JSON.stringify({ bereich: [a.top], sub: [a.sub], sub2: [a.sub2] }))}">${esc(a.sub2)}</button>` : ""} · Art. ${fNo(a.no)}${a.coll ? ` · <button class="lnk" data-crumb="${esc(JSON.stringify({ coll: [a.coll], stand: "auch" }))}">Kollektion ${esc(a.coll)}</button>` : ""}</div><h1>${esc(a.name)} ${favBtn(a.no, a.name)}</h1><div class="kd2">${esc(a.kind)}${a.measure ? `, ${esc(a.measure)}` : ""}</div>
        <div class="bigpr">${pr(a.price)}</div>${a.prev ? `<div class="dn">reduziert, vorher ${eur(a.prev)}${a.vto ? ` · gilt bis ${fD(a.vto)}` : ""}</div>` : c ? `<div class="${c.to < c.from ? "dn" : "up"}">${c.to < c.from ? "gesenkt" : "erhöht"} am ${fD(c.d)} von ${eur(c.from)}</div>` : `<div class="kd">Preis seit Beginn der Erfassung unverändert</div>`}
        ${prods.length > 1 ? `<div class="alts" role="group" aria-label="Farben und Größen">${prods.map((x) => `<button data-go="#/artikel?id=${encodeURIComponent(x.id)}" aria-pressed="${x.id === a.id}" title="${esc(ausOf(x))}">${img(x.thumb, ausOf(x))}</button>`).join("")}</div><div class="kd">${esc(ausOf(a))} · ${prods.length} von ${Math.max(prods.length, a.nvar || 0)} Farben/Größen erfasst</div>` : ""}
        ${now.length ? `<div class="hint"><b>Gerade ${now.length} ${now.length === 1 ? "Angebot" : "Angebote"} in der Fundgrube</b> ab ${eur(Math.min(...now.map((o) => o.price)))}${now.some((o) => isMine(o.mid)) ? `, davon ${now.filter((o) => isMine(o.mid)).length} in deinen Märkten` : ""}. <button data-scroll="fg">ansehen</button></div>` : all.length ? `<div class="hint" style="border-color:var(--rule)">Zuletzt in der Fundgrube am ${fD(all.filter((o) => o.end).sort((x, y) => y.end.localeCompare(x.end))[0]?.end)} · insgesamt ${all.length} Angebote</div>` : ""}
        ${intlHint(a)}
        ${coreFacts(a)}
        <div class="btns"><a class="btn" href="${K_P}${esc(a.slug)}/" target="_blank" rel="noopener">Bei IKEA ansehen ↗</a></div></div></div>
      <div class="sec"><div class="h"><h2>Preis und Fundgrube</h2><span class="kd">${a.ph.length - 1} Preisänderung${a.ph.length === 2 ? "" : "en"} · ${all.length} Fundgrube-Angebote${S.repo.archive ? "" : " (Archiv lädt)"}</span></div>${timeline(a, all)}</div>
      ${serieTiles(a, serie, prods)}
      <div class="sec"><div class="two"><div><div class="h2"><h2>Wo es den Artikel gibt</h2><span class="kd">${S.rng && a.nMk != null ? `${a.nMk} von ${a.nKn} Märkten` : "noch nicht gemessen"}</span></div>${S.rng && a.nMk != null ? `<p style="margin:6px 0 0;line-height:1.7"><span class="kd">${show[0]}:</span> ${show[1].map((s) => `<button class="${isMine(s.id) ? "lnk" : ""}" data-go="#/markt?id=${encodeURIComponent(s.id)}" style="${isMine(s.id) ? "" : "color:var(--ink2)"}">${isMine(s.id) ? "<b>" + esc(s.name) + "</b>" : esc(s.name)}</button>`).join(", ") || "keinem Markt"}</p>` : ""}</div>
        <div id="fg"><div class="h2"><h2>In der Fundgrube</h2></div><p class="sub">${now.length ? "aktuell, deine Märkte und günstigste zuerst" : "gerade kein Angebot"}</p>${now.length ? `${sortCtl("art-now", "fund", "markt")}${rowsFund(ssort(now, "art-now", "fund", "markt"), false)}` : ""}${all.length > now.length ? `<p class="kd" style="margin-top:8px">Früher: ${all.length - now.length} Angebote, ${eur(Math.min(...all.map((o) => o.price)))} bis ${eur(Math.max(...all.map((o) => o.price)))}, meist in ${[...all.reduce((m, o) => m.set(o.market, (m.get(o.market) || 0) + 1), new Map())].sort((x, y) => y[1] - x[1]).slice(0, 2).map((x) => esc(x[0])).join(" und ")}. <button class="lnk" data-go="#/produkt?art=${a.no}">alle ansehen</button></p>` : ""}</div></div></div>`;
  }
  function pageProduct(no) {   // Artikelnummer aus der Fundgrube, auch ohne Eintrag im Sortiment
    const a = S.kat.byNo.get(no), all = (fundAll().get(no) || []).slice().sort((x, y) => (x.active === y.active ? (y.first_seen || "").localeCompare(x.first_seen || "") : y.active - x.active)), ref = all[0];
    if (!ref && !a) return `<button class="back" data-back>← zurück</button><h1>Nichts gefunden</h1><p class="kd">Zur Artikelnummer ${fNo(no)} gibt es weder einen Sortimentseintrag noch ein Fundgrube-Angebot.</p>`;
    const nm = a ? a.name : ref.title, kd = a ? a.kind : ref.product_description;
    return `<button class="back" data-back>← zurück</button><div class="top2"><div class="big">${img(a ? `${K_IMG}${a.img}?f=s` : ref?.image ? `${ref.image}?f=s` : "")}</div><div><div class="crumb">${a ? "Sortiment" : "in den Sortimentsdaten noch nicht erfasst"} · Art. ${fNo(no)}</div><h1>${esc(nm)} ${favBtn(no, nm)}</h1><div class="kd2">${esc(kd || "")}</div>
      ${intlHint(a)}${coreFacts(a, "")}<dl class="kv"><dt>Fundgrube</dt><dd>${all.filter((o) => o.active).length} aktuell · ${all.length} insgesamt${S.repo.archive ? "" : " (Archiv lädt)"}</dd>${all.length ? `<dt>Preise</dt><dd>${eur(Math.min(...all.map((o) => o.price)))} bis ${eur(Math.max(...all.map((o) => o.price)))}</dd><dt>Märkte</dt><dd>${new Set(all.map((o) => o.mid)).size}</dd>` : ""}</dl>${a ? `<div class="btns"><button class="btn pri" data-go="#/artikel?id=${encodeURIComponent(a.id)}">Artikel im Sortiment</button></div>` : ""}</div></div>
      <div class="sec"><div class="h"><h2>Alle Angebote dieses Artikels</h2>${sortCtl("art-off", "fund")}${vsw("art")}</div>${timeline(a, all)}${offList(ssort(all, "art-off", "fund"), "art", false)}</div>`;
  }
  function pageOffer(o) {
    const a = o.art, all = (fundAll().get(o.no) || []).filter((x) => x.id !== o.id).sort((x, y) => (y.first_seen || "").localeCompare(x.first_seen || ""));
    const nm = a ? a.name : o.title;
    return `<button class="back" data-back>← zurück</button>
      <div class="top2"><div class="big">${img(o.image ? `${o.image}?f=s` : a ? `${K_IMG}${a.img}?f=s` : "")}</div><div>
        <div class="crumb">Fundgrube › <button class="lnk" data-go="#/markt?id=${encodeURIComponent(o.mid)}">${esc(o.market)}</button> · ${o.active ? (o.base ? "seit Beginn der Erfassung" : `eingestellt ${ago(o.age)}`) : `${o.base ? "seit Beginn" : fD(o.start)} bis ${fD(o.end)}, nicht mehr da`}</div><h1>${esc(nm)} ${favBtn(o.no, nm)}</h1><div class="kd2">${esc(a ? a.kind : o.product_description || "")}${a ? ` · ${esc(ausOf(a))}` : ""}</div>
        <div class="bigpr">${pr(o.price)}</div><div>regulär ${eur(o.orig)}${o.disc != null ? ` · <span class="dn">−${o.disc} %</span>` : ""}${a && Math.abs(a.price - (o.orig || 0)) > 0.01 ? ` · heute im Sortiment ${eur(a.price)}` : ""}</div>${intlHint(a)}
        <dl class="kv"><dt>Markt</dt><dd>${isMine(o.mid) ? "<b>" : ""}<button class="lnk" data-go="#/markt?id=${encodeURIComponent(o.mid)}">${esc(o.market)}</button>${isMine(o.mid) ? "</b> · einer deiner Märkte" : ""}</dd><dt>Zustand</dt><dd>${esc(o.condition || "–")}${o.condition_description ? `<div class="kd">${esc(o.condition_description)}</div>` : ""}</dd><dt>Grund</dt><dd>${esc(o.reason_discount || "–")}</dd>${o.offer_description ? `<dt>Beschreibung</dt><dd>${esc(o.offer_description)}</dd>` : ""}${o.additional_info ? `<dt>Hinweis</dt><dd>${esc(o.additional_info)}</dd>` : ""}<dt>Artikel</dt><dd>${fNo(o.no)}${!a ? ` · <span class="kd">${S.kat?.failed ? "Sortiment nicht geladen" : "in den Sortimentsdaten noch nicht erfasst"}</span>` : a.gone ? " · <span class='up'>ausgelistet</span>" : ""}</dd><dt>Angebot</dt><dd class="tn">${esc(o.offer_number || "")}</dd></dl>${a ? `<h2 style="margin-top:18px">Zum Artikel</h2>${coreFacts(a)}` : ""}
        <div class="btns">${a ? `<button class="btn pri" data-go="#/artikel?id=${encodeURIComponent(a.id)}">Artikel im Sortiment</button>` : ""}${o.link ? `<a class="btn" href="${esc(o.link)}" target="_blank" rel="noopener">Bei IKEA ansehen ↗</a>` : ""}</div></div></div>
      <div class="sec"><div class="h"><h2>Dieser Artikel in der Fundgrube</h2><span class="kd">${all.length + 1} Angebote · ${new Set([o, ...all].map((x) => x.mid)).size} Märkte${S.repo.archive ? "" : " · Archiv lädt"}</span>${all.length ? sortCtl("art-off", "fund") + vsw("art") : ""}</div>${timeline(a, [o, ...all])}${all.length ? offList(ssort(all, "art-off", "fund"), "art", false) : ""}</div>`;
  }
  function pageMarket(id) {
    const name = nameOf(id), fa = FA().filter((o) => o.mid === id), items = S.kat.items.filter((a) => !a.stub && !a.gone), R = S.rng, s = R?.byId[id];
    let top = "";
    if (s) {
      const carr = items.filter((a) => carries(a, id)), share = carr.length / Math.max(1, items.filter((a) => carries(a, id) !== null).length);
      const ranks = R.st.map((x) => [x.id, items.filter((a) => carries(a, x.id)).length]).sort((a, b) => b[1] - a[1]), rank = ranks.findIndex((r) => r[0] === id) + 1;
      const missing = items.filter((a) => carries(a, id) === false && a.nKn >= 10 && a.nMk / a.nKn >= 0.8).sort((a, b) => b.nMk - a.nMk), rare = items.filter((a) => carries(a, id) && a.nMk <= 3).sort((a, b) => a.nMk - b.nMk);
      const cmp = S.cmp && S.cmp !== id && R.byId[S.cmp] ? S.cmp : R.st.find((x) => x.id !== id)?.id;
      const onlyHere = items.filter((a) => carries(a, id) && carries(a, cmp) === false), onlyThere = items.filter((a) => carries(a, id) === false && carries(a, cmp));
      const tops = [...new Set(items.map((a) => a.top))];
      top = `<div class="nums"><div><b class="tn">${Math.round(share * 100)} %</b><span>des Sortiments (${nf(carr.length)} Artikel)</span></div><div><b class="tn">${rank}.</b><span>von ${R.st.length} Märkten nach Sortimentsbreite</span></div><div><b class="tn">${nf(fa.length)}</b><span>Angebote in der Fundgrube</span></div><div><b class="tn">${nf(fa.filter((o) => !o.base && o.age < 7).length)}</b><span>neue Angebote in 7 Tagen</span></div></div>
        <div class="sec"><div class="h"><h2>Bereiche</h2><span class="kd">Anteil der Artikel, die dieser Markt führt · Fundgrube aktuell</span></div>${stab("mkb", [{ k: "t", l: "Bereich" }, { k: "p", l: "führt", num: 1, bar: 1, fmt: (v) => `${v} %` }, { k: "n", l: "Artikel hier", num: 1, fmt: (v, r) => `${nf(v)} von ${nf(r.of)}`, cls: "hide" }, { k: "f", l: "Fundgrube", num: 1, fmt: nf }], tops.map((t) => { const l = items.filter((a) => a.top === t && carries(a, id) !== null), h = l.filter((a) => carries(a, id)).length; return { t, p: l.length ? Math.round(h / l.length * 100) : 0, n: h, of: l.length, f: fa.filter((o) => o.top === t).length }; }).filter((r) => r.of || r.f), { def: "p" })}</div>
        <div class="sec"><div class="h"><h2>Fehlt hier, gibt es fast überall</h2><span class="kd">${nf(missing.length)} Artikel · in mind. 80 % der Märkte</span>${sortCtl("mk-miss", "sort", "verb")}${vsw("markt")}</div>${missing.length ? artList(ssort(missing, "mk-miss", "sort").slice(0, 60), "markt") : `<p class="kd">Nichts.</p>`}</div>
        <div class="sec"><div class="h"><h2>Gibt es hier, aber kaum anderswo</h2><span class="kd">${nf(rare.length)} Artikel · höchstens 3 Märkte</span>${sortCtl("mk-rare", "sort", "verb")}${vsw("markt")}</div>${rare.length ? artList(ssort(rare, "mk-rare", "sort").slice(0, 60), "markt") : `<p class="kd">Nichts.</p>`}</div>
        <div class="sec"><div class="h"><h2>Vergleich mit <select id="cmp" data-cmp style="font:inherit;font-weight:700;border:0;border-bottom:2px solid var(--blue);color:var(--blue);background:none">${R.st.filter((x) => x.id !== id).sort((a, b) => a.name.localeCompare(b.name, "de")).map((x) => `<option value="${esc(x.id)}" ${x.id === cmp ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></h2><span class="kd">${nf(onlyHere.length)} nur hier · ${nf(onlyThere.length)} nur dort</span>${sortCtl("mk-cmp", "sort", "name")}${vsw("markt")}</div><div class="two"><div><p class="sub">nur in ${esc(name)}</p>${onlyHere.length ? (VK("markt") ? tiles(ssort(onlyHere, "mk-cmp", "sort").slice(0, 40), false) : mini(ssort(onlyHere, "mk-cmp", "sort").slice(0, 40))) : "<p class='kd'>–</p>"}</div><div><p class="sub">nur in ${esc(nameOf(cmp))}</p>${onlyThere.length ? (VK("markt") ? tiles(ssort(onlyThere, "mk-cmp", "sort").slice(0, 40), false) : mini(ssort(onlyThere, "mk-cmp", "sort").slice(0, 40))) : "<p class='kd'>–</p>"}</div></div></div>`;
    } else top = `<p class="kd">Sortiment dieses Markts noch nicht gemessen.</p>`;
    return `<button class="back" data-back>← zurück</button><h1>${esc(name)}${isMine(id) ? `<small>einer deiner Märkte</small>` : ""}</h1>${top}
      <div class="sec"><div class="h"><h2>Fundgrube hier</h2><button data-go="#/fundgrube" data-pre="markt:${esc(id)}">alle mit Filter öffnen</button>${sortCtl("mk-fund", "fund", "neu")}${vsw("markt")}</div>${offList(groupsOf(ssort(fa, "mk-fund", "fund", "neu")).slice(0, 12).flat(), "markt")}</div>`;
  }
  // Designer-Netzwerk: Personen als Punkte, Linie = gemeinsame Artikel (dicker = mehr). Anordnung einmal berechnet (Kräfte-Simulation).
  function netData() {
    if (memo.has("net")) return memo.get("net");
    const F = S.facets, pairs = new Map(), arts = new Map();
    for (const a of S.kat.items) { if (a.stub || a.gone) continue; const ps = F.ppl.get(a.id) || []; for (const n of ps) arts.set(n, (arts.get(n) || 0) + 1); if (ps.length < 2) continue;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const [x, y] = [ps[i], ps[j]].sort(), k = x + "\u0001" + y, e = pairs.get(k) || { a: x, b: y, n: 0, series: new Set(), colls: new Set(), ids: [] }; e.n++; e.series.add(a.name); if (a.coll) e.colls.add(a.coll); e.ids.push(a.id); pairs.set(k, e); } }
    const edges = [...pairs.values()].sort((p, q) => q.n - p.n), names = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
    // Kräfte-Simulation, deterministisch
    const N = names.length, ix = new Map(names.map((n, i) => [n, i])), P = names.map((_, i) => ({ x: Math.cos(i * 2.399) * (50 + i * 3), y: Math.sin(i * 2.399) * (50 + i * 3), vx: 0, vy: 0 }));
    for (let it = 0; it < 320; it++) {
      const al = 1 - it / 320;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d2 = Math.max(dx * dx + dy * dy, 25), f = 900 / d2 * al; P[i].vx += dx * f / Math.sqrt(d2); P[i].vy += dy * f / Math.sqrt(d2); P[j].vx -= dx * f / Math.sqrt(d2); P[j].vy -= dy * f / Math.sqrt(d2); }
      for (const e of edges) { const i = ix.get(e.a), j = ix.get(e.b), dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 60) * 0.02 * al * Math.min(3, 1 + Math.log(e.n)); P[i].vx += dx / d * f; P[i].vy += dy / d * f; P[j].vx -= dx / d * f; P[j].vy -= dy / d * f; }
      for (const q of P) { q.vx -= q.x * 0.004 * al; q.vy -= q.y * 0.004 * al; q.x += q.vx; q.y += q.vy; q.vx *= 0.55; q.vy *= 0.55; }
    }
    const out = { names, edges, P, ix, arts }; memo.set("net", out); return out;
  }
  function netSvg() {
    const D = netData(); if (!D.names.length) return `<p class="kd">Noch keine gemeinsamen Artikel erfasst.</p>`;
    const xs = D.P.map((q) => q.x), ys = D.P.map((q) => q.y), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, ww = Math.max(Math.max(...xs) - Math.min(...xs) + 180, NARROW() ? 420 : 760), hh = Math.max(Math.max(...ys) - Math.min(...ys) + 60, NARROW() ? 300 : 340), x0 = cx - ww / 2, x1 = cx + ww / 2, y0 = cy - hh / 2, y1 = cy + hh / 2;
    const sel = S.netSel && D.ix.has(S.netSel) ? S.netSel : null, nb = new Set(sel ? D.edges.filter((e) => e.a === sel || e.b === sel).flatMap((e) => [e.a, e.b]) : []);
    const mx = Math.max(...D.edges.map((e) => e.n)), w = (n) => 0.8 + 5 * Math.sqrt(n / mx), r = (n) => 3 + Math.sqrt(D.arts.get(n) || 1) * 0.9;
    const lines = D.edges.map((e) => { const p = D.P[D.ix.get(e.a)], q = D.P[D.ix.get(e.b)], on = sel && (e.a === sel || e.b === sel); return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="${on ? "var(--blue)" : "var(--ink)"}" stroke-opacity="${sel ? (on ? 0.9 : 0.06) : 0.25}" stroke-width="${w(e.n).toFixed(2)}"><title>${esc(e.a)} und ${esc(e.b)}: ${e.n} gemeinsame Artikel</title></line>`; }).join("");
    const nodes = D.names.map((n) => { const q = D.P[D.ix.get(n)], act = n === sel, dim = sel && !nb.has(n); return `<g class="nn" data-net="${esc(n)}" style="cursor:pointer" opacity="${dim ? 0.25 : 1}"><circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r(n).toFixed(1)}" fill="${act ? "var(--blue)" : "#fff"}" stroke="${act || nb.has(n) ? "var(--blue)" : "var(--ink)"}" stroke-width="1.5"/><text x="${(q.x + r(n) + 3).toFixed(1)}" y="${(q.y + 4).toFixed(1)}" class="${act ? "lab" : ""}">${esc(n)}</text><title>${esc(n)}: ${D.arts.get(n) || 0} Artikel</title></g>`; }).join("");
    let panel = `<p class="kd">Punkt antippen: Zusammenarbeiten dieser Person hervorheben. Linie: gemeinsame Artikel, dicker = mehr. Punktgröße: Zahl der Artikel.</p>`;
    if (sel) { const es = D.edges.filter((e) => e.a === sel || e.b === sel); panel = `<div class="netp"><b>${esc(sel)}</b> <span class="kd">${nf(D.arts.get(sel) || 0)} Artikel · ${es.length} Partner</span> <button class="lnk" data-desfilter="${esc(sel)}">im Sortiment</button> ${followBtn("des", sel)} <button class="lnk" data-net="">Auswahl aufheben</button>
      <div class="tw"><table><tbody>${es.map((e) => { const o = e.a === sel ? e.b : e.a; return `<tr><td><button class="lnk" data-net="${esc(o)}">${esc(o)}</button></td><td class="r tn">${e.n} gemeinsame Artikel</td><td class="kd">${[...e.series].slice(0, 4).map(esc).join(", ")}${e.colls.size ? ` · Kollektion ${[...e.colls].map(esc).join(", ")}` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`; }
    return `<div class="net"><svg viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}" width="100%" role="img" aria-label="Netzwerk der Designer">${lines}${nodes}</svg></div>${panel}`;
  }
  // Kompakte Erkenntnis-Karte: Titel, wenige konkrete Artikel, Link zu allen
  const card = (title, kd, rows, more) => (!rows.length ? "" : `<div class="card"><div class="ch"><b>${title}</b><span class="kd">${kd}</span></div>${rows.length ? rows.map((r) => `<div class="cr" data-go="${esc(r.go)}">${r.img ? img(r.img) : "<span></span>"}<span class="cn">${r.l}</span><span class="cv tn">${r.v}</span></div>`).join("") : `<p class="kd">Keine.</p>`}${more ? `<button class="lnk" ${more}>alle zeigen</button>` : ""}</div>`);
  function pageAna(b) {
    const items = S.kat.items.filter((a) => !a.stub), act = items.filter((a) => !a.gone), tops = [...new Set(items.map((a) => a.top))];
    const nav = [["uebersicht", "Überblick"], ["sortiment", "Sortiment"], ["preise", "Preise"], ["serien", "Serien"], ["kollektionen", "Kollektionen"], ["designer", "Designer"], ["maerkte", "Märkte"], ["fundgrube", "Fundgrube"], ["laender", "Länder"]];
    const weeks = Array.from({ length: 26 }, (_, i) => dIso((25 - i) * 7)), wl = weeks.map(fS), inWeek = (d, i) => d && day(d) > (i ? weeks[i - 1] : dIso(26 * 7)) && day(d) <= weeks[i];
    const learning = !S.kat.meta?.baseline_until, aGo = (a) => `#/artikel?id=${encodeURIComponent(a.id)}`, nm = (a) => `<b>${esc(a.name)}</b> ${esc(a.kind)}`;
    const chg30 = (dir) => items.filter((a) => { const c = lastChg(a); return c && c.d >= dIso(30) && (dir < 0 ? c.to < c.from : c.to > c.from); }).sort((x, y) => dir * (chgPct(y) - chgPct(x)));
    const pct = (v) => `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v))} %`;
    let body = "";
    if (b === "uebersicht") {
      const down = chg30(-1).reverse().sort((x, y) => chgPct(x) - chgPct(y)), up = chg30(1).sort((x, y) => chgPct(y) - chgPct(x)), last = act.filter((a) => a.last), gone = items.filter((a) => a.gone && day(a.gone) >= dIso(30)).sort((x, y) => y.gone.localeCompare(x.gone));
      const offs = FA().filter((o) => (!MINE().length || isMine(o.mid)) && o.disc != null).sort((x, y) => y.disc - x.disc), og = groupsOf(offs).slice(0, 5);
      const cheapAb = S.intl ? act.map((a) => { const e = abroad(a).map((x) => ({ ...x, d: x.eur != null && a.price ? (x.eur / a.price - 1) * 100 : null })).filter((x) => x.d != null).sort((p, q) => p.d - q.d)[0]; return e ? { a, e } : null; }).filter((x) => x && x.e.d <= -25 && x.a.price >= 20).sort((p, q) => (p.e.eur - p.a.price) - (q.e.eur - q.a.price)) : [];
      const newA = learning ? [] : act.filter((a) => a.first && day(a.first) >= dIso(30)).sort((x, y) => y.first.localeCompare(x.first));
      const useIkea = S.ovIkea && act.some((a) => a.hfb), lvl1 = (a) => (useIkea ? a.hfb || "ohne Angabe" : a.top), lvl2 = (a) => (useIkea ? a.pa || "ohne Angabe" : a.sub || "ohne Unterkategorie");
      const groups = [...act.reduce((m, a) => m.set(lvl1(a), [...(m.get(lvl1(a)) || []), a]), new Map())].sort((x, y) => y[1].length - x[1].length);
      const famChips = (l) => { const m = l.reduce((mm, a) => mm.set(a.name, (mm.get(a.name) || 0) + 1), new Map()); return [...m].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([n, c]) => `<button class="pill2" data-crumb="${esc(JSON.stringify({ q: n }))}">${esc(n)} <small>${c}</small></button>`).join("") + (m.size > 12 ? ` <span class="kd">+${m.size - 12}</span>` : ""); };
      body = `<div class="cards">
        ${card("Preis gesenkt", `30 Tage · ${nf(down.length)} Artikel`, down.slice(0, 5).map((a) => ({ go: aGo(a), img: a.thumb, l: nm(a), v: `<span class="dn">${pct(chgPct(a))}</span><div class="kd">${eur(a.price)}</div>` })), `data-go="#/sortiment" data-pre="${esc(JSON.stringify({ chg: "d30" }))}"`)}
        ${card("Preis erhöht", `30 Tage · ${nf(up.length)} Artikel`, up.slice(0, 5).map((a) => ({ go: aGo(a), img: a.thumb, l: nm(a), v: `<span class="up">${pct(chgPct(a))}</span><div class="kd">${eur(a.price)}</div>` })), `data-go="#/sortiment" data-pre="${esc(JSON.stringify({ chg: "u30" }))}"`)}
        ${card("Beste Rabatte in der Fundgrube", `${MINE().length ? "meine Märkte" : "alle Märkte"} · gebündelt`, og.map((l) => ({ go: l.length > 1 ? `#/produkt?art=${l[0].no}` : `#/angebot?id=${encodeURIComponent(l[0].id)}`, img: l[0].thumb, l: `${offerName(l[0])}<div class="kd">${l.length > 1 ? `${l.length} Angebote · ` : ""}${mkList(l)}</div>`, v: `<span class="dn">−${l[0].disc} %</span><div class="kd">${eur(l[0].price)}</div>` })), `data-go="#/fundgrube"`)}
        ${S.intl ? card("Im Ausland deutlich günstiger", "mind. 25 % · ab 20 € · größte Ersparnis in €", cheapAb.slice(0, 5).map(({ a, e }) => ({ go: aGo(a), img: a.thumb, l: `${nm(a)}<div class="kd">in ${esc(CN(e.c.cc))} ${eur(e.eur)} statt ${eur(a.price)}</div>`, v: `<span class="dn">${pct(e.d)}</span>` })), `data-go="#/sortiment" data-pre="${esc(JSON.stringify({ ausland: "25" }))}"`) : ""}
        ${card("Letzte Chance", `${nf(last.length)} Artikel laufen aus`, last.slice(0, 5).map((a) => ({ go: aGo(a), img: a.thumb, l: nm(a), v: eur(a.price) })), `data-go="#/sortiment" data-pre="${esc(JSON.stringify({ letzte: true }))}"`)}
        ${card("Ausgelistet", `30 Tage · ${nf(gone.length)} Artikel`, gone.slice(0, 5).map((a) => ({ go: aGo(a), img: a.thumb, l: nm(a), v: `<span class="kd">${fS(day(a.gone))}</span>` })), `data-go="#/sortiment" data-pre="${esc(JSON.stringify({ stand: "weg" }))}"`)}
        ${learning ? "" : card("Neu im Sortiment", `30 Tage · ${nf(newA.length)} Artikel`, newA.slice(0, 5).map((a) => ({ go: aGo(a), img: a.thumb, l: nm(a), v: eur(a.price) })), `data-go="#/sortiment" data-pre="${esc(JSON.stringify({ neu: "30" }))}"`)}
        </div>
        ${learning ? `<p class="kd">Anlernphase: Das Sortiment wird noch vervollständigt. Bis alle Lücken geschlossen sind, zählt alles als Startbestand; „neu“ gibt es erst danach.</p>` : ""}
        <div class="sec"><div class="h"><h2>Das Sortiment im Überblick</h2><span class="kd">${nf(act.length)} Artikel · ${nf(new Set(act.map((a) => a.name)).size)} Serien · antippen öffnet das Sortiment</span>${act.some((a) => a.hfb) ? `<span class="seg"><button data-ov="0" aria-pressed="${!useIkea}">Website</button><button data-ov="1" aria-pressed="${useIkea}">IKEA-Bereiche</button></span>` : ""}</div>
        ${groups.map(([g1, l]) => { const subs = [...l.reduce((m, a) => m.set(lvl2(a), [...(m.get(lvl2(a)) || []), a]), new Map())].sort((x, y) => y[1].length - x[1].length);
          return `<details class="ovd"><summary><b>${esc(g1)}</b> <span class="kd">${nf(l.length)} Artikel · ${nf(new Set(l.map((a) => a.name)).size)} Serien · ${eur0(qn(l.map((a) => a.price), 0.5))} im Median</span></summary><table class="ov"><tbody>${subs.map(([g2, l2]) => `<tr><td class="n"><button class="lnk" data-crumb="${esc(JSON.stringify(useIkea ? { q: "" } : { bereich: [g1], sub: [g2] }))}">${esc(g2)}</button><div class="kd">${nf(l2.length)} Artikel</div></td><td>${famChips(l2)}</td></tr>`).join("")}</tbody></table></details>`; }).join("")}</div>`;
    } else if (b === "sortiment") {
      const up = weeks.map((_, i) => items.filter((a) => inWeek(a.first, i)).length), down = weeks.map((_, i) => items.filter((a) => inWeek(a.gone, i)).length);
      const rows = tops.map((t) => { const l = items.filter((a) => a.top === t), la = l.filter((a) => !a.gone); return { t, n: la.length, ser: new Set(la.map((a) => a.name)).size, neu: learning ? null : l.filter((a) => a.first && day(a.first) >= dIso(90)).length, weg: l.filter((a) => a.gone).length, med: qn(la.map((a) => a.price), 0.5), sets: la.filter((a) => a.type === "SPR").length, last: la.filter((a) => a.last).length }; }).filter((r) => r.n);
      body = `<div class="nums"><div><b class="tn">${nf(act.length)}</b><span>Artikel im Sortiment</span></div><div><b class="tn">${nf(new Set(act.map((a) => a.name)).size)}</b><span>Serien</span></div><div><b class="tn">${learning ? "–" : "+" + nf(items.filter((a) => a.first).length)}</b><span>${learning ? "neu: erst nach der Anlernphase" : "neu seit Ende der Anlernphase"}</span></div><div><b class="tn">−${nf(items.filter((a) => a.gone).length)}</b><span>ausgelistet seit Beginn</span></div></div>
        <div class="sec"><div class="h"><h2>Bereiche</h2><span class="kd">Spalte antippen sortiert, nochmal antippen kehrt um</span></div>${stab("bereiche", [{ k: "t", l: "Bereich" }, { k: "n", l: "Artikel", num: 1, bar: 1, fmt: nf }, { k: "ser", l: "Serien", num: 1, fmt: nf }, { k: "med", l: "Median-Preis", num: 1, fmt: (v) => eur0(v) }, { k: "neu", l: "neu (90 T.)", num: 1, fmt: (v) => (v == null ? "–" : nf(v)), cls: "hide" }, { k: "weg", l: "ausgelistet", num: 1, fmt: nf, cls: "hide" }, { k: "last", l: "letzte Chance", num: 1, fmt: nf, cls: "hide" }, { k: "sets", l: "Sets", num: 1, fmt: nf, cls: "hide" }], rows, { def: "n", go: (r) => `#/sortiment?bereich=${encodeURIComponent(r.t)}` })}</div>
        <div class="sec"><h2>Zu- und Abgänge je Woche</h2><p class="sub">oben neu erschienene, unten ausgelistete Artikel${learning ? " · neu erst nach der Anlernphase" : ""}</p>${weekBars(up, down, wl)}</div>`;
    } else if (b === "preise") {
      const cuts = chg30(-1).filter((a) => lastChg(a).d >= dIso(14));
      const rows = tops.map((t) => { const ps = act.filter((a) => a.top === t).map((a) => a.price); return { t, n: ps.length, lo: ps.length ? Math.min(...ps) : null, q1: qn(ps, 0.25), med: qn(ps, 0.5), q3: qn(ps, 0.75), hi: ps.length ? Math.max(...ps) : null, d: items.filter((a) => a.top === t && lastChg(a)?.d >= dIso(30) && lastChg(a).to < lastChg(a).from).length, u: items.filter((a) => a.top === t && lastChg(a)?.d >= dIso(30) && lastChg(a).to > lastChg(a).from).length }; }).filter((r) => r.n);
      body = `<div class="nums"><div><b class="tn">${eur0(qn(act.map((a) => a.price), 0.5))}</b><span>Median-Preis aller Artikel</span></div><div><b class="tn">${nf(act.filter((a) => a.prev).length)}</b><span>mit Vorher-Preis (reduziert)</span></div><div><b class="tn">${nf(chg30(-1).length)}</b><span>Preissenkungen in 30 Tagen</span></div><div><b class="tn">${nf(chg30(1).length)}</b><span>Preiserhöhungen in 30 Tagen</span></div></div>
        <h2>Preise je Bereich</h2><p class="sub">jeder Punkt ein Artikel · Strich = Median · rechts Median und Spanne in Euro</p>${strip(tops.map((t) => ({ l: t, items: act.filter((a) => a.top === t) })).filter((g) => g.items.length).sort((a, b2) => qn(b2.items.map((x) => x.price), 0.5) - qn(a.items.map((x) => x.price), 0.5)))}
        <div class="sec"><div class="h"><h2>Preisstufen je Bereich</h2><span class="kd">ein Viertel der Artikel kostet weniger als „unteres Viertel“</span></div>${stab("preise", [{ k: "t", l: "Bereich" }, { k: "n", l: "Artikel", num: 1, fmt: nf, cls: "hide" }, { k: "lo", l: "ab", num: 1, fmt: eur0 }, { k: "q1", l: "unteres Viertel", num: 1, fmt: eur0, cls: "hide" }, { k: "med", l: "Median", num: 1, fmt: eur0 }, { k: "q3", l: "oberes Viertel", num: 1, fmt: eur0, cls: "hide" }, { k: "hi", l: "bis", num: 1, fmt: eur0 }, { k: "d", l: "gesenkt (30 T.)", num: 1, fmt: nf }, { k: "u", l: "erhöht (30 T.)", num: 1, fmt: nf }], rows, { def: "med", go: (r) => `#/sortiment?bereich=${encodeURIComponent(r.t)}` })}</div>
        <div class="sec"><h2>Preisänderungen je Woche</h2><p class="sub">oben gesenkt, unten erhöht · Zahl der Artikel</p>${weekBars(weeks.map((_, i) => items.filter((a) => a.ph.slice(1).some(([t, v], k) => inWeek(t, i) && v < a.ph[k][1])).length), weeks.map((_, i) => items.filter((a) => a.ph.slice(1).some(([t, v], k) => inWeek(t, i) && v > a.ph[k][1])).length), wl, { a: "gesenkt", b: "erhöht" })}</div>
        <div class="sec"><div class="h"><h2>Preissenkungen der letzten 14 Tage</h2><span class="kd">${nf(cuts.length)} Artikel</span>${sortCtl("an-cuts", "sort", "senk")}${vsw("ana")}</div>${cuts.length ? artList(ssort(cuts, "an-cuts", "sort", "senk").slice(0, 100), "ana") : "<p class='kd'>Keine.</p>"}</div>`;
    } else if (b === "serien") {
      const m = items.reduce((mm, a) => mm.set(a.name, [...(mm.get(a.name) || []), a]), new Map());
      const rows = [...m].map(([n, l]) => { const la = l.filter((a) => !a.gone), ps = la.map((a) => a.price); return { n, l, art: la.length, prod: new Set(la.map((a) => a.pk)).size, neu: l.filter((a) => a.first).length, weg: l.filter((a) => a.gone).length, lo: ps.length ? Math.min(...ps) : null, hi: ps.length ? Math.max(...ps) : null, top: la[0]?.top || l[0].top, img: (la.find((a) => a.thumb) || l[0]).thumb }; }).filter((r) => r.l.length > 1 || r.art);
      const moving = rows.filter((r) => r.neu + r.weg && r.l.length > 1).sort((a, b2) => b2.neu + b2.weg - (a.neu + a.weg)).slice(0, 6);
      body = `<p class="sub" style="font-size:14px;color:var(--ink2);max-width:70ch">Eine Serie sind alle Artikel mit demselben IKEA-Namen, etwa STOCKHOLM, auch über mehrere Kollektionen hinweg.</p>
        <div class="sec"><div class="h"><h2>Alle Serien</h2><span class="kd">${nf(rows.length)} Serien · Spalte antippen sortiert</span>${vsw("ana")}</div>${VK("ana") ? gTiles(rows.slice().sort((a, b2) => b2.art - a.art).slice(0, 60).map((r) => ({ l: r.n, s: `${nf(r.art)} Artikel · ${r.prod} Produkte`, img: r.img, go: `#/sortiment?q=${encodeURIComponent(r.n)}`, p: r.lo != null ? `${eur0(r.lo)}–${eur0(r.hi)}` : "" })))
          : stab("serien", [{ k: "n", l: "Serie", fmt: (v) => `<b>${esc(v)}</b>` }, { k: "art", l: "Artikel", num: 1, bar: 1, fmt: nf }, { k: "prod", l: "Produkte", num: 1, fmt: nf }, { k: "lo", l: "ab", num: 1, fmt: eur0 }, { k: "hi", l: "bis", num: 1, fmt: eur0, cls: "hide" }, { k: "neu", l: "neu", num: 1, fmt: nf, cls: "hide" }, { k: "weg", l: "ausgelistet", num: 1, fmt: nf, cls: "hide" }, { k: "top", l: "Bereich", cls: "hide" }], rows, { def: "art", lim: 40, go: (r) => `#/sortiment?q=${encodeURIComponent(r.n)}` })}</div>
        ${moving.map((x) => `<div class="sec"><div class="h"><h2>Serie ${esc(x.n)}</h2><span class="kd">${x.prod} Produkte · ${x.l.length} Artikel · ${x.neu} neu · ${x.weg} ausgelistet</span></div>${lanes(x.l.sort((p, q) => p.kind.localeCompare(q.kind, "de") || (p.col || "").localeCompare(q.col || "", "de")).slice(0, 30), null, (p) => [p.kind, p.col].filter(Boolean).join(", "))}</div>`).join("")}`;
    } else if (b === "kollektionen") {
      const m = items.filter((a) => a.coll).reduce((mm, a) => mm.set(a.coll, [...(mm.get(a.coll) || []), a]), new Map()), ks = [...m].sort((a, b2) => b2[0].localeCompare(a[0], "de"));
      const rows = ks.map(([n, l]) => { const la = l.filter((a) => !a.gone), ps = l.map((a) => a.price); return { n, l, art: la.length, weg: l.length - la.length, prod: new Set(l.map((a) => a.kind)).size, lo: Math.min(...ps), hi: Math.max(...ps), ber: [...new Set(l.map((a) => a.top))].join(", "), img: (la.find((a) => a.thumb) || l[0]).thumb }; });
      body = `<p class="sub" style="font-size:14px;color:var(--ink2);max-width:72ch">Kollektionen tragen ein Jahr im Namen, etwa IKEA PS 2026 oder STOCKHOLM 2025, und mischen ganz verschiedene Produkte.</p>
        ${ks.length ? `<div class="sec"><div class="h"><h2>Kollektionen</h2><span class="kd">${ks.length}</span>${vsw("ana")}</div>${VK("ana") ? gTiles(rows.map((r) => ({ l: r.n, s: `${nf(r.art)} Artikel${r.weg ? ` · ${r.weg} ausgelistet` : ""}`, img: r.img, go: `#/sortiment?coll=${encodeURIComponent(r.n)}`, p: `${eur0(r.lo)}–${eur0(r.hi)}` })))
          : stab("koll", [{ k: "n", l: "Kollektion", fmt: (v) => `<b>${esc(v)}</b>` }, { k: "art", l: "im Sortiment", num: 1, bar: 1, fmt: nf }, { k: "weg", l: "ausgelistet", num: 1, fmt: nf }, { k: "prod", l: "Produkte", num: 1, fmt: nf, cls: "hide" }, { k: "lo", l: "ab", num: 1, fmt: eur0 }, { k: "hi", l: "bis", num: 1, fmt: eur0 }, { k: "ber", l: "Bereiche", cls: "hide" }], rows, { def: "n", go: (r) => `#/sortiment?coll=${encodeURIComponent(r.n)}` })}</div>
        ${ks.map(([n, l]) => `<div class="sec"><div class="h"><h2>${esc(n)}</h2><span class="kd">${new Set(l.map((a) => a.kind)).size} Produkte · ${l.length} Artikel</span></div>${lanes(l.sort((p, q) => p.kind.localeCompare(q.kind, "de") || (p.col || "").localeCompare(q.col || "", "de")).slice(0, 40), null, (p) => [p.kind, p.col].filter(Boolean).join(", "))}</div>`).join("")}` : "<p class='kd'>Keine Kollektion im Sortiment gefunden.</p>"}`;
    } else if (b === "laender") {
      const I = S.intl;
      if (!I) body = `<p class="kd">Noch keine Länderdaten. Die Messung läuft wöchentlich je Land.</p>`;
      else {
        const rows = I.countries.map((c) => { const col = I.p[c.cc] || [], common = [], cheaper = []; let n = 0, only = 0;
          I.ids.forEach((id, i) => { const v = col[i]; if (v == null) return; n++; const a = S.kat.byId.get(id); if (!a || a.stub || a.gone) { only++; return; } const e = toEur(c, v); if (e != null && a.price) { common.push(e / a.price); if (e < a.price * 0.95) cheaper.push(1); } });
          return { c, land: CN(c.cc), n, only, common: common.length, idx: qn(common, 0.5), cheaper: common.length ? Math.round(cheaper.length / common.length * 100) : null, upd: c.updated }; });
        const sel = S.intlCc && I.p[S.intlCc] ? S.intlCc : I.countries[0].cc, col = I.p[sel] || [], cSel = I.countries.find((c) => c.cc === sel);
        const onlyThere = I.ids.map((id, i) => [id, col[i]]).filter(([id, v]) => v != null && !(S.kat.byId.get(id) && !S.kat.byId.get(id).stub && !S.kat.byId.get(id).gone)).slice(0, 200);
        body = `<p class="sub" style="font-size:14px;color:var(--ink2);max-width:72ch">Dieselben IKEA-Listen in anderen Ländern, je Land einmal pro Woche erfasst. Preise in Euro nach EZB-Kurs. Preisniveau: mittleres Verhältnis zum deutschen Preis bei Artikeln, die es in beiden Ländern gibt (100 % = gleich teuer).${learning ? " „Nur dort“ ist zu hoch, solange das deutsche Sortiment noch vervollständigt wird." : ""}</p>
          ${stab("laender", [{ k: "land", l: "Land", fmt: (v, r) => `<b>${esc(v)}</b> <span class="kd">${esc(r.c.cur)}</span>` }, { k: "n", l: "Artikel", num: 1, fmt: nf }, { k: "common", l: "auch in DE", num: 1, fmt: nf, cls: "hide" }, { k: "only", l: "nur dort", num: 1, fmt: nf }, { k: "idx", l: "Preisniveau", num: 1, fmt: (v) => (v == null ? "–" : `<span class="${v < 1 ? "dn" : "up"}">${Math.round(v * 100)} %</span>`) }, { k: "cheaper", l: "günstiger als DE", num: 1, fmt: (v) => (v == null ? "–" : `${v} % der Artikel`) }, { k: "upd", l: "Stand", cls: "hide", fmt: (v) => fD(day(v)) }], rows, { def: "idx", ra: (r) => `data-intl="${esc(r.c.cc)}" style="cursor:pointer"`, hl: (r) => r.c.cc === sel })}
          <p class="kd" style="margin-top:6px">Zeile antippen zeigt unten die Artikel, die es nur dort gibt.</p>
          <div class="sec"><div class="h"><h2>Nur in ${esc(CN(sel))}, nicht in Deutschland</h2><span class="kd">${nf(rows.find((r) => r.c.cc === sel)?.only || 0)} Artikel${onlyThere.length === 200 ? " · die ersten 200" : ""}</span>${vsw("ana")}</div>
          ${VK("ana") ? `<div class="imgs">${onlyThere.map(([id, v]) => { const x = I.x[id] || ["", "", "", "", "", ""]; return `<div ${x[4] ? `data-href="${esc(x[4])}"` : ""}>${x[2] ? img(`${x[2]}?f=xs`) : "<span></span>"}<div class="n">${esc(x[0])}</div><div class="k">${esc(x[1])}</div><div class="p">${local(cSel, v)}${toEur(cSel, v) != null && cSel.cur !== "EUR" ? ` <span class="kd">${eur(toEur(cSel, v))}</span>` : ""}</div></div>`; }).join("")}</div>`
            : `<div class="tw"><table><tbody>${onlyThere.map(([id, v]) => { const x = I.x[id] || ["", "", "", "", "", ""]; return `<tr><td class="im">${x[2] ? img(`${x[2]}?f=xs`) : ""}</td><td><div class="nm">${esc(x[0])} <span style="font-weight:400">${esc(x[1])}</span></div><div class="kd">${esc((x[5] || "").split(" › ").slice(0, 2).join(" › "))}</div></td><td class="r tn">${local(cSel, v)}${toEur(cSel, v) != null && cSel.cur !== "EUR" ? `<div class="kd">${eur(toEur(cSel, v))}</div>` : ""}</td><td>${x[4] ? `<a class="lnk" href="${esc(x[4])}" target="_blank" rel="noopener">bei IKEA</a>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`}</div>`;
      }
    } else if (b === "designer") {
      const F = S.facets;
      if (!F) body = `<p class="kd">Details (Designer, Material) sind noch nicht abgerufen.</p>`;
      else {
        const withD = act.filter((a) => F.by.has(a.id)), named = withD.filter((a) => F.ppl.has(a.id)), unres = F.persons.filter((p) => !p.resolved), D = netData();
        const partners = new Map(); for (const e of D.edges) { partners.set(e.a, (partners.get(e.a) || 0) + 1); partners.set(e.b, (partners.get(e.b) || 0) + 1); }
        const rows = F.persons.map((p) => { const l = act.filter((a) => (F.ppl.get(a.id) || []).includes(p.name)), ps = l.map((a) => a.price), tc = [...l.reduce((m, a) => m.set(a.top, (m.get(a.top) || 0) + 1), new Map())].sort((x, y) => y[1] - x[1]); return { name: p.name, n: l.length, ser: new Set(l.map((a) => a.name)).size, med: qn(ps, 0.5), lo: ps.length ? Math.min(...ps) : null, hi: ps.length ? Math.max(...ps) : null, top: tc[0]?.[0] || "", par: partners.get(p.name) || 0, img: l.find((a) => a.thumb)?.thumb, res: p.resolved }; });
        body = `<div class="nums"><div><b class="tn">${nf(F.persons.length)}</b><span>Personen</span></div><div><b class="tn">${withD.length ? Math.round(named.length / withD.length * 100) : 0} %</b><span>der Artikel mit Details nennen eine Person</span></div><div><b class="tn">${nf(D.edges.length)}</b><span>Paare, die zusammengearbeitet haben</span></div><div><b class="tn">${nf(F.n)}</b><span>Artikel mit abgerufenen Details</span></div></div>
          <div class="sec"><div class="h"><h2>Personen</h2><span class="kd">Artikel im Sortiment · Preise in Euro · antippen filtert das Sortiment</span>${vsw("ana")}</div>${VK("ana") ? gTiles(rows.slice().sort((a, b2) => b2.n - a.n).map((r) => ({ l: r.name, s: `${nf(r.n)} Artikel · Median ${eur0(r.med)}`, img: r.img, go: `#/sortiment?des=${encodeURIComponent(r.name)}` })))
            : stab("pers", [{ k: "name", l: "Person", fmt: (v) => `<b>${esc(v)}</b>` }, { k: "n", l: "Artikel", num: 1, bar: 1, fmt: nf }, { k: "ser", l: "Serien", num: 1, fmt: nf, cls: "hide" }, { k: "med", l: "Median-Preis", num: 1, fmt: eur0 }, { k: "lo", l: "ab", num: 1, fmt: eur0, cls: "hide" }, { k: "hi", l: "bis", num: 1, fmt: eur0, cls: "hide" }, { k: "par", l: "Partner", num: 1, fmt: nf }, { k: "top", l: "meist im Bereich", cls: "hide" }], rows, { def: "n", lim: 30, go: (r) => `#/sortiment?des=${encodeURIComponent(r.name)}` })}</div>
          <div class="sec"><div class="h"><h2>Wer arbeitet mit wem?</h2><span class="kd">Netzwerk aus gemeinsamen Artikeln</span></div>${netSvg()}</div>
          <div class="sec"><div class="h"><h2>Häufigste Zusammenarbeiten</h2><span class="kd">gemeinsame Artikel im Sortiment</span></div>${stab("paare", [{ k: "a", l: "Person" }, { k: "b", l: "mit" }, { k: "n", l: "gemeinsame Artikel", num: 1, bar: 1, fmt: nf }, { k: "s", l: "Serien", v: (e) => [...e.series].slice(0, 4).join(", "), cls: "hide" }, { k: "c", l: "Kollektionen", v: (e) => [...e.colls].join(", "), cls: "hide" }], D.edges, { def: "n", lim: 15, ra: (e) => `data-net="${esc(e.a)}" style="cursor:pointer"` })}</div>
          ${unres.length ? `<p class="kd" style="margin-top:20px">Noch nicht ausgeschrieben (nur Kürzel bekannt): ${unres.map((p) => esc(p.name)).join(", ")}. Namen ergänzt die App, sobald ein Artikel sie ausgeschrieben nennt.</p>` : ""}`;
      }
    } else if (b === "maerkte") {
      const R = S.rng, fa = FA(), past = FALL().filter((o) => !o.base && !o.active);
      const mrows = storeList().map((s) => { const l = fa.filter((o) => o.mid === s.id), dw = past.filter((o) => o.mid === s.id).map((o) => daysBetween(o.start, o.end)), known = R ? act.filter((a) => carries(a, s.id) !== null) : []; return { id: s.id, m: s.name, n: l.length, neu: l.filter((o) => !o.base && o.age < 7).length, disc: qn(l.map((o) => o.disc).filter((x) => x != null), 0.5), dw: dw.length >= 5 ? qn(dw, 0.5) : null, share: known.length ? known.filter((a) => carries(a, s.id)).length / known.length : null }; });
      let heat = "";
      if (R) {
        const cats = tops.filter((t) => act.some((a) => a.top === t)), rows = R.st.map((s) => { const known = act.filter((a) => carries(a, s.id) !== null); return { id: s.id, m: s.name, all: known.length ? known.filter((a) => carries(a, s.id)).length / known.length : 0, c: cats.map((t) => { const l = known.filter((a) => a.top === t); return l.length ? l.filter((a) => carries(a, s.id)).length / l.length : 0; }) }; });
        rows.sort(S.heatSort === "name" ? (a, b2) => a.m.localeCompare(b2.m, "de") : (a, b2) => b2.all - a.all);
        const colr = (v) => `color-mix(in srgb, var(--ink) ${Math.round(v * 55)}%, #fff)`;
        heat = `<div class="sec"><div class="h"><h2>Welcher Markt führt wie viel?</h2><span class="kd">Anteil der Artikel je Bereich in % · dunkler = mehr</span><span class="seg"><button data-heat="anteil" aria-pressed="${S.heatSort !== "name"}">nach Anteil</button><button data-heat="name" aria-pressed="${S.heatSort === "name"}">nach Name</button></span></div>
          <div class="tw"><table class="heat"><thead><tr><th>Markt</th><th>gesamt</th>${cats.map((t) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr data-go="#/markt?id=${encodeURIComponent(r.id)}" class="${isMine(r.id) ? "me" : ""}"><td class="n">${esc(r.m)}</td><td class="c" style="background:${colr(r.all)};color:${r.all > 0.75 ? "#fff" : "var(--ink2)"}">${Math.round(r.all * 100)}</td>${r.c.map((v) => `<td class="c" style="background:${colr(v)};color:${v > 0.75 ? "#fff" : "var(--ink2)"}">${Math.round(v * 100)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <p class="kd">Verbreitung: ${nf(act.filter((a) => a.nMk >= 1 && a.nMk <= 3).length)} Artikel nur in 1–3 Märkten · ${nf(act.filter((a) => a.nMk > 40).length)} in mehr als 40 · ${nf(act.filter((a) => a.nMk === 0).length)} in keinem gemessenen.</p></div>`;
      }
      body = `<div class="sec"><div class="h"><h2>Märkte</h2><span class="kd">Fundgrube aktuell · Sortimentsanteil laut letzter Messung · deine Märkte fett</span></div>${stab("mk", [{ k: "m", l: "Markt", fmt: (v, r) => (isMine(r.id) ? `<b>${esc(v)}</b>` : esc(v)) }, { k: "n", l: "Angebote", num: 1, bar: 1, fmt: nf }, { k: "neu", l: "neu (7 T.)", num: 1, fmt: nf }, { k: "disc", l: "Rabatt Median", num: 1, fmt: (v) => (v == null ? "–" : `${Math.round(v)} %`), cls: "hide" }, { k: "dw", l: "Tage bis weg", num: 1, fmt: (v) => (v == null ? "–" : Math.round(v)), cls: "hide" }, { k: "share", l: "Sortiment", num: 1, fmt: (v) => (v == null ? "–" : `${Math.round(v * 100)} %`) }], mrows, { def: "n", go: (r) => `#/markt?id=${encodeURIComponent(r.id)}`, hl: (r) => isMine(r.id) })}</div>${heat}`;
    } else {
      const all = FALL().filter((o) => !o.base), past = all.filter((o) => !o.active), dw = past.map((o) => daysBetween(o.start, o.end)), every = FALL();
      const days = Array.from({ length: 60 }, (_, i) => dIso(59 - i));
      const live = days.map((d) => every.filter((o) => (o.base ? true : o.start <= d) && (!o.end || o.end >= d)).length);
      const newD = days.map((d) => all.filter((o) => o.start === d).length), goneD = days.map((d) => every.filter((o) => o.end === d).length);
      const by = (key) => [...every.reduce((m, o) => { const k = key(o); return m.set(k, [...(m.get(k) || []), o]); }, new Map())].map(([k, l]) => { const d = l.filter((o) => !o.base && !o.active).map((o) => daysBetween(o.start, o.end)); return { k, n: l.length, akt: l.filter((o) => o.active).length, disc: qn(l.map((o) => o.disc).filter((x) => x != null), 0.5), dw: d.length >= 3 ? qn(d, 0.5) : null }; });
      const cols = (l1) => [{ k: "k", l: l1 }, { k: "n", l: "Angebote seit Beginn", num: 1, bar: 1, fmt: nf }, { k: "akt", l: "aktuell", num: 1, fmt: nf, cls: "hide" }, { k: "disc", l: "Rabatt Median", num: 1, fmt: (v) => (v == null ? "–" : `${Math.round(v)} %`) }, { k: "dw", l: "Tage bis weg (Median)", num: 1, fmt: (v) => (v == null ? "–" : Math.round(v)) }];
      const most = [...every.reduce((m, o) => (o.no ? m.set(o.no, [...(m.get(o.no) || []), o]) : m), new Map())].sort((a, b2) => b2[1].length - a[1].length).slice(0, 12);
      body = `${S.repo.archive ? "" : `<p class="wait">Archiv lädt …</p>`}<div class="nums"><div><b class="tn">${nf(FA().length)}</b><span>Angebote gerade in allen Märkten</span></div><div><b class="tn">${nf(all.filter((o) => o.age < 7).length)}</b><span>neu eingestellt in 7 Tagen</span></div><div><b class="tn">${dw.length ? Math.round(qn(dw, 0.5)) + " Tage" : "–"}</b><span>bis ein Angebot weg ist (Median)</span></div><div><b class="tn">${Math.round(qn(every.map((o) => o.disc), 0.5) || 0)} %</b><span>Rabatt im Median</span></div></div>
        <h2>Angebote in der Fundgrube, Tag für Tag</h2><p class="sub">alle Märkte · letzte 60 Tage · Zahl der Angebote</p>${areaDays(live, days.map(fS))}
        <div class="sec"><h2>Neu eingestellt und weg, je Tag</h2><p class="sub">oben neu, unten verschwunden · ohne Startbestand</p>${weekBars(newD, goneD, days.map(fS), { a: "neu", b: "weg" })}</div>
        <div class="sec"><div class="h"><h2>Nach Zustand</h2></div>${stab("fz", cols("Zustand"), by((o) => o.condition || "ohne Angabe"), { def: "n" })}</div>
        <div class="sec"><div class="h"><h2>Nach Grund</h2><span class="kd">wie IKEA den Rabatt begründet</span></div>${stab("fg", cols("Grund"), by((o) => o.reason_discount || "ohne Angabe"), { def: "n", lim: 10 })}</div>
        <div class="sec"><div class="h"><h2>Nach Bereich</h2></div>${stab("fb", cols("Bereich"), by((o) => o.top || "–"), { def: "n", lim: 12 })}</div>
        <div class="sec"><div class="h"><h2>Am häufigsten in der Fundgrube</h2><span class="kd">Angebote je Artikel seit Beginn</span>${vsw("ana")}</div>${(() => { const rs = most.map(([no, l]) => { const a = S.kat.byNo.get(no); return { go: a ? `#/artikel?id=${encodeURIComponent(a.id)}` : `#/produkt?art=${no}`, img: l[0].thumb, l: a ? `${a.name} ${a.kind}` : l[0].title, s: a ? colOf(a) : l[0].product_description, v: l.length }; }); return VK("ana") ? gTiles(rs.map((r) => ({ ...r, s: `${r.v} Angebote${r.s ? " · " + r.s : ""}` }))) : thumbs(rs); })()}</div>`;
    }
    return `<div class="anav" role="group" aria-label="Bereich">${nav.map(([k, l]) => `<button data-go="#/analyse?b=${k}" aria-pressed="${b === k}">${l}</button>`).join("")}</div>${body}`;
  }
  function md(text) {           // kleine Markdown-Darstellung (Überschriften, Listen, Tabellen, Fett, Code)
    const inl = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
    const lines = String(text || "").split("\n"), out = []; let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\|/.test(l)) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) { if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim())); i++; } out.push(`<div class="tw"><table>${rows.map((r, k) => `<tr>${r.map((c) => (k ? `<td>${inl(c)}</td>` : `<th>${inl(c)}</th>`)).join("")}</tr>`).join("")}</table></div>`); continue; }
      if (/^[-*] |^\d+\. /.test(l)) { const ol = /^\d/.test(l), it = []; while (i < lines.length && /^[-*] |^\d+\. /.test(lines[i])) { it.push(lines[i].replace(/^[-*] |^\d+\. /, "")); i++; } out.push(`<${ol ? "ol" : "ul"} class="mdl">${it.map((x) => `<li>${inl(x)}</li>`).join("")}</${ol ? "ol" : "ul"}>`); continue; }
      const h = l.match(/^(#{1,3}) (.*)/); if (h) out.push(`<h${h[1].length + 1} class="mdh">${inl(h[2])}</h${h[1].length + 1}>`); else if (l.trim()) out.push(`<p class="mdp">${inl(l)}</p>`);
      i++;
    }
    return out.join("");
  }
  async function pageDaten() {
    const meta = S.repo.meta, km = S.kat.meta;
    if (meta && !S.repo.runs) S.repo.runs = (await soft(getBin("runs.bin", meta.updated))) || [];
    if (S.state === undefined) S.state = await soft(getBin("state.bin", meta?.updated));
    const runs = (S.repo.runs || []).filter((r) => r.ts).slice(-25), gaps = runs.slice(1).map((r, i) => Math.round((new Date(r.ts) - new Date(runs[i].ts)) / 60000));
    const sent = (S.state?.sent || []).slice(-10).reverse();
    if (S.hb === undefined) S.hb = await soft(getBin("handbuch.bin"));
    const docs = S.hb?.docs || {}, names = Object.keys(docs), cur = names.includes(S.hbDoc) ? S.hbDoc : names[0];
    const hbHtml = `<div class="sec"><div class="h"><h2>Handbuch</h2><span class="kd">App-Version ${APP_VERSION}</span></div>${names.length ? `<div class="seg" style="margin:0 0 10px -12px">${names.map((n) => `<button data-hbdoc="${esc(n)}" aria-pressed="${n === cur}">${esc(n)}</button>`).join("")}</div><div class="md">${md(docs[cur])}</div>` : `<p class="kd">Noch nicht veröffentlicht.</p>`}</div>`;
    return `      <div class="nums"><div><b class="tn">${meta ? fDT(meta.updated) : "–"}</b><span>letzter Fundgrube-Abruf${meta ? `, ${meta.last_run.stores_ok} von ${meta.last_run.stores_total} Märkten` : ""}</span></div><div><b class="tn">${km ? fDT(km.updated) : "–"}</b><span>Sortiment zuletzt aktualisiert</span></div><div><b class="tn">${S.rng ? fDT(S.rng.updated) : "–"}</b><span>Verfügbarkeit je Markt gemessen</span></div><div><b class="tn">${S.facets ? nf(S.facets.n) : "–"}</b><span>Artikel mit Details (Designer, Text, Bilder)</span></div></div>
      <div class="two"><div><h2>Abruf-Takt</h2><p class="sub">Abstände der letzten Fundgrube-Abrufe in Minuten · rot: über 90</p><div class="runs">${gaps.map((v) => `<i class="${v > 90 ? "late" : ""}" style="height:${Math.min(34, Math.max(3, v / 4))}px" title="${v} Min."></i>`).join("")}</div>
        <dl class="dl2"><dt>Fundgrube</dt><dd>alle 15 Min. versucht, mind. 50 Min. Abstand${gaps.length ? ` · zuletzt im Median ${Math.round(qn(gaps, 0.5))} Min.` : ""}</dd><dt>Letzter Lauf</dt><dd>${meta ? `${nf(meta.last_run.new || 0)} neu · ${nf(meta.last_run.gone || 0)} weg · ${nf(meta.last_run.price_change || 0)} Preisänderungen` : "–"}</dd><dt>Erfasst insgesamt</dt><dd>${meta ? `${nf(meta.total_offers)} Fundgrube-Angebote` : "–"}</dd>
        ${km ? `<dt>Sortiment</dt><dd>${nf(km.last_run?.active)} Artikel · ${nf(km.last_run?.categories)} Kategorien${km.last_run?.failed ? ` · <span class="up">${km.last_run.failed} fehlgeschlagen</span>` : ""}</dd>${km.gaps ? `<dt>Lücken</dt><dd>${nf(km.gaps.only_sitemap)} Artikel nur in der Sitemap${km.gaps.filled != null ? ` · zuletzt ${nf(km.gaps.filled)} nachgeholt` : ""}</dd>` : ""}` : ""}
        ${meta?.last_run?.errors ? `<dt>Hinweise</dt><dd class="kd">${esc(meta.last_run.errors)}</dd>` : ""}</dl></div>
        <div><h2>Zuletzt per Telegram gemeldet</h2><p class="sub">Einstellungen im Reiter Einstellungen</p><div class="feed">${sent.map((m) => `<div style="grid-template-columns:96px minmax(0,1fr);cursor:default"><span class="kd tn">${fDT(m.ts)}</span><span style="font-size:13px">${esc(String(m.text || "").replace(/<[^>]+>/g, "")).replace(/\n/g, "<br>")}</span></div>`).join("") || "<p class='kd'>Noch nichts gemeldet.</p>"}</div>${S.state?.outbox?.length ? `<p class="kd">${S.state.outbox.length} Nachrichten warten auf den Versand.</p>` : ""}</div></div>
      <div class="sec"><div class="h"><h2>Märkte</h2><span class="kd">${storeList().length}</span></div><div class="tw"><table><thead><tr><th>Markt</th><th class="r">aktiv</th><th>zuletzt ok</th><th class="hide">Fehler</th></tr></thead><tbody>${storeList().map((s) => `<tr data-go="#/markt?id=${encodeURIComponent(s.id)}"><td>${isMine(s.id) ? `<b>${esc(s.name)}</b>` : esc(s.name)}</td><td class="r tn">${nf(s.active)}</td><td class="tn">${rel(s.last_ok)}</td><td class="hide kd">${esc(s.error || s.last_error || "")}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="sec"><div class="h"><h2>Begriffe</h2></div><dl class="dl2"><dt>Sortiment</dt><dd>alle Artikel, die IKEA Deutschland regulär verkauft</dd><dt>Bereich</dt><dd>oberste Kategorie, z. B. „Sofas & Sessel“</dd><dt>Serie</dt><dd>alle Artikel mit demselben IKEA-Namen, z. B. STOCKHOLM, über alle Jahre und Kollektionen</dd><dt>Kollektion</dt><dd>Reihe mit Jahr im Namen, z. B. STOCKHOLM 2025; kann mehrere Jahre laufen</dd><dt>Produkt</dt><dd>Serie plus Art, z. B. VIMLE 3er-Sofa</dd><dt>Farbe/Größe</dt><dd>ein Produkt in einer bestimmten Farbe oder Größe, mit eigener Artikelnummer</dd><dt>Set</dt><dd>mehrere Artikel, die IKEA unter einer Nummer zusammen verkauft</dd><dt>Angebot</dt><dd>ein einzelnes Teil in einer Fundgrube, mit eigenem Preis, Zustand und Markt</dd><dt>Startbestand</dt><dd>was beim Beginn der Erfassung schon da war; zählt nie als „neu“, hat kein Einstelldatum</dd><dt>Tage bis weg</dt><dd>vom ersten bis zum letzten Tag, an dem ein Angebot gelistet war</dd><dt>Verschwunden</dt><dd>erst wenn ein Angebot in zwei erfolgreichen Abrufen seines Markts fehlt</dd></dl>
        ${hbHtml}
        <p class="kd" style="margin-top:12px">Alle Daten liegen verschlüsselt und werden erst in diesem Browser geöffnet. Nichts wird automatisch gelöscht. IKEA liefert kein Einstelldatum; alle Zeitangaben sind Beobachtungen der Abrufe. Die alte Ansicht bleibt unter <a class="lnk" href="alt.html">alt.html</a> erreichbar.</p></div>`;
  }
  async function pageEinst() {
    let status = "";
    if (worker.url && AUTH.pw) { try { const st = await worker.call("GET", null, { path: "/api/status" }); const miss = Object.entries(st.config || {}).filter(([, v]) => !v).map(([k]) => k); status = miss.length ? `<span class="up">Im Hilfsdienst fehlen: ${esc(miss.join(", "))}</span>` : `<span class="ok">Hilfsdienst verbunden</span>${st.telegram?.ts ? ` · Telegram zuletzt ${rel(st.telegram.ts)}` : ""}`; } catch (e) { status = `<span class="up">Hilfsdienst nicht erreichbar (${esc(e.message)})</span>`; } }
    else status = `<span class="up">Kein Hilfsdienst eingetragen</span>`;
    if (S.server.ok && !S.hist) S.hist = await worker.call("GET", null, { path: "/api/history" }).catch(() => []);
    const rs = allRules(), sq = S.sq.mk || "";
    return `      <div class="two"><div><h2>Meine Märkte</h2><p class="sub">bestimmen Start, den Filter „meine Märkte“ und die Hervorhebungen</p><input class="inp" type="search" id="sq-einst-mk" data-sq="mk" placeholder="Markt suchen" value="${esc(sq)}" aria-label="Markt suchen" style="margin-bottom:8px">
        <div style="columns:2 170px;column-gap:20px">${storeList().filter((s) => !sq || fold(s.name).includes(fold(sq))).map((s) => `<label class="opt" style="break-inside:avoid"><input type="checkbox" data-minepick="${esc(s.id)}" ${isMine(s.id) ? "checked" : ""}><span>${isMine(s.id) ? `<b>${esc(s.name)}</b>` : esc(s.name)}</span></label>`).join("")}</div></div>
        <div><h2>Benachrichtigungen per Telegram</h2><p class="sub">${status}</p><p class="kd" style="margin:0 0 8px">Gemeldet wird, wenn ein Angebot zu einem Eintrag neu erscheint, wieder auftaucht oder billiger wird.</p>
          ${rs.map((r) => `<div class="rulebox"><div class="s" style="font-size:14px">${isFavRule(r) ? `Gemerkt: <b>${esc(S.kat.byNo.get(ZC.normArticle(r.article_numbers[0]))?.name || r.name)}</b> <span class="kd">${fNo(r.article_numbers[0])}</span>` : esc(ruleText(r))}</div><span style="display:flex;gap:10px;align-items:center"><button class="sw" role="switch" aria-checked="${r.notify !== false && r.enabled !== false}" data-notify="${esc(r.id)}" aria-label="Benachrichtigung"></button>${S.rules.some((x) => x.id === r.id) ? `<button class="lnk" style="font-size:12.5px;color:var(--red)" data-delrule="${esc(r.id)}">entfernen</button>` : ""}</span></div>`).join("") || "<p class='kd'>Noch keine Einträge.</p>"}
          <form id="wurl" style="margin-top:16px"><label class="kd" for="wurl-i">Adresse des Hilfsdienstes (nur nötig, wenn sie nicht automatisch ankommt)</label><input class="inp" id="wurl-i" name="u" placeholder="https://…workers.dev" value="${esc(lsGet(LS.workerUrl, "") || "")}"></form></div></div>
      <div class="sec two"><div><h2>Merkliste: frühere Stände</h2><p class="sub">jede Änderung bleibt erhalten · Wiederherstellen fragt zweimal nach</p>${S.server.ok ? `<div class="feed">${(S.hist || []).slice(0, 12).map((h) => `<div style="grid-template-columns:120px minmax(0,1fr) auto;cursor:default"><span class="tn">${fDT(h.ts)}</span><span class="kd">${h.count ?? "?"} Einträge</span><button class="lnk" style="font-size:13px" data-restore="${esc(h.id)}">wiederherstellen</button></div>`).join("") || "<p class='kd'>Noch keine früheren Stände.</p>"}</div>` : `<p class="kd">Erst verfügbar, wenn der Hilfsdienst verbunden ist.</p>`}</div>
        <div>${S.intl ? `<h2>Länder im Preisvergleich</h2><p class="sub">welche Länder Artikelseiten und der Filter „Andere Länder“ zeigen · die Auswertung zeigt immer alle</p><div style="columns:3 110px;column-gap:16px;margin-bottom:22px">${S.intl.countries.slice().sort((x, y) => CN(x.cc).localeCompare(CN(y.cc), "de")).map((c) => `<label class="opt" style="break-inside:avoid"><input type="checkbox" data-intloff="${esc(c.cc)}" ${lsGet(LS.intlOff, []).includes(c.cc) ? "" : "checked"}><span>${esc(CN(c.cc))}</span></label>`).join("")}</div>` : ""}<h2>Backup und Export</h2><p class="sub">alle Rohdaten entschlüsselt als JSON, dazu Fundgrube, Sortiment und Preisverläufe als CSV und das Handbuch – eine ZIP-Datei</p><div class="btns" style="margin-top:0"><button class="btn pri" data-backup>Komplett-Backup herunterladen</button></div><p class="kd" id="bk" style="margin-top:8px"></p>
          <h2 style="margin-top:24px">Zugang</h2><p class="sub">Passwort nur in diesem Browser gespeichert</p><div class="btns" style="margin-top:0"><button class="btn" data-logout>Abmelden</button><a class="btn" href="alt.html">Alte Ansicht</a></div></div></div>`;
  }

  /* ================= Komplett-Backup: alle Rohdaten (entschlüsselt) + lesbare Tabellen, als ZIP ================= */
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function deflateRaw(u8) { if (!window.CompressionStream) return null; try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); } catch { return null; } }
  async function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const [name, text] of files) {
      const data = enc.encode(text), nm = enc.encode(name), crc = crc32(data), comp = await deflateRaw(data), method = comp ? 8 : 0, body = comp || data;
      const lh = new DataView(new ArrayBuffer(30)); [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, method, 2], [12, 0x21, 2], [14, crc, 4], [18, body.length, 4], [22, data.length, 4], [26, nm.length, 2]].forEach(([o, v, n]) => (n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true)));
      const ch = new DataView(new ArrayBuffer(46)); [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, method, 2], [14, 0x21, 2], [16, crc, 4], [20, body.length, 4], [24, data.length, 4], [28, nm.length, 2], [42, off, 4]].forEach(([o, v, n]) => (n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true)));
      parts.push(new Uint8Array(lh.buffer), nm, body); central.push(new Uint8Array(ch.buffer), nm); off += 30 + nm.length + body.length;
    }
    const cd = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }
  const csvOf = (rows, cols) => { const cell = (v) => { if (v == null) return ""; if (typeof v === "object") v = JSON.stringify(v); const t = String(v); return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }; return "\ufeff" + [cols.join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\n"); };
  const DERIVED = new Set(["art", "thumb", "top", "base", "active", "mid", "market", "start", "end", "age", "disc", "orig", "sub", "sub2", "cols", "first", "gone", "stub", "pk", "varsKnown", "ri", "nMk", "nKn", "coll"]);
  const rawCols = (list, skip = []) => { const set = new Set(); for (const o of list.slice(0, 2000)) for (const k of Object.keys(o)) if (!k.startsWith("_") && !DERIVED.has(k) && !skip.includes(k)) set.add(k); return [...set]; };
  async function backup() {
    const st = (t) => { const el = $("#bk"); if (el) el.textContent = t; };
    st("Lade Dateiverzeichnis …");
    let list = null; try { const r = await fetch("files.json", { cache: "no-cache" }); if (r.ok) list = (await r.json()).files; } catch { /* älterer Stand ohne Verzeichnis */ }
    if (!list) list = ["d/meta.bin", "d/current.bin", "d/runs.bin", "d/state.bin", "d/watchlist.bin", ...(S.repo.meta?.archive_months || []).map((m) => `d/a-${m}.bin`), "k/meta.bin", "k/items.bin", "k/gaps.bin", "k/range.bin", "k/details.bin", "k/facets.bin", "k/intl.bin", "k/intl-index.bin", "k/subsent.bin"];
    const files = [], ok = [], failed = [];
    for (let i = 0; i < list.length; i++) {
      st(`Rohdaten ${i + 1} von ${list.length}: ${list[i]}`);
      try { files.push([`rohdaten/${list[i].replace(/\.bin$/, ".json")}`, JSON.stringify(await openFile(list[i]))]); ok.push(list[i]); } catch (e) { if (e instanceof AuthError) throw e; failed.push(list[i]); }
    }
    st("Tabellen erstellen …");
    await loadArchive().catch(() => {});
    const offers = FALL(), items = S.kat?.items || [];
    files.push(["tabellen/fundgrube.csv", csvOf(offers, rawCols(offers, ["no"]))]);
    files.push(["tabellen/sortiment.csv", csvOf(items, rawCols(items))]);
    const ph = []; for (const a of items) for (const [t, v] of a.ph || []) ph.push({ id: a.id, artikelnummer: a.no, name: a.name, art: a.kind, datum: day(t), preis: v });
    files.push(["tabellen/preisverlauf.csv", csvOf(ph, ["id", "artikelnummer", "name", "art", "datum", "preis"])]);
    files.push(["tabellen/merkliste.json", JSON.stringify({ rules: allRules().map(({ _repo, ...r }) => r), maerkte_meine: MINE() }, null, 1)]);
    const hb = await soft(getBin("handbuch.bin"));
    for (const [n, t] of Object.entries(hb?.docs || {})) files.push([`handbuch/${n}.md`, t]);
    files.push(["LIESMICH.txt", `Zweite Chance – Komplett-Backup vom ${new Date().toLocaleString("de-DE")}\n\nrohdaten/: jede Datendatei entschlüsselt als JSON, genau so, wie sie gespeichert ist (Quelle der Wahrheit).\ntabellen/: daraus abgeleitete, lesbare Tabellen (Auswertung, jederzeit neu erzeugbar).\nhandbuch/: Datenstandard, Changelog und Regeln.\n\nEnthalten: ${ok.length} Dateien${failed.length ? `\nNicht lesbar: ${failed.join(", ")}` : ""}\n`]);
    st("ZIP packen …");
    const blob = await makeZip(files), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `zweite-chance-backup_${TODAY}.zip`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    st(`Fertig: ${ok.length} Dateien, ${Math.round(blob.size / 1e6)} MB${failed.length ? ` · nicht lesbar: ${failed.join(", ")}` : ""}`);
  }

  /* ================= Rahmen, Wege, Ereignisse ================= */
  const TABS = [["start", "Start"], ["fundgrube", "Fundgrube"], ["sortiment", "Sortiment"], ["timemachine", "Time Machine"], ["analyse", "Analyse"], ["daten", "Daten"], ["einstellungen", "Einstellungen"]];
  // Time Machine: Tage mit Änderungen im Sortiment, je Tag die wichtigsten Änderungen, darunter das Sortiment an diesem Tag
  function tmDays() {
    if (memo.has("tmd")) return memo.get("tmd");
    const items = S.kat.items.filter((a) => !a.stub), m = new Map(), put = (d, k, a, x) => { d = day(d); if (!d || d > TODAY) return; const e = m.get(d) || { neu: [], var: [], down: [], up: [], gone: [] }; e[k].push(x ? { a, ...x } : { a }); m.set(d, e); };
    const firstOfPk = new Map(); for (const a of items) { const f0 = a.first ? day(a.first) : ""; const cur = firstOfPk.get(a.pk); if (cur === undefined || f0 < cur) firstOfPk.set(a.pk, f0); }
    for (const a of items) {
      if (a.first) put(a.first, firstOfPk.get(a.pk) < day(a.first) ? "var" : "neu", a);
      a.ph.forEach(([t, v], i) => { if (i && v != null && a.ph[i - 1][1] != null && v !== a.ph[i - 1][1]) put(t, v < a.ph[i - 1][1] ? "down" : "up", a, { from: a.ph[i - 1][1], to: v }); });
      if (a.gone) put(a.gone, "gone", a);
    }
    const out = [...m].map(([d, e]) => ({ d, e, n: e.neu.length + e.var.length + e.down.length + e.up.length + e.gone.length })).filter((x) => x.n).sort((x, y) => y.d.localeCompare(x.d));
    memo.set("tmd", out); return out;
  }
  function pageTM() {
    const days = tmDays();
    if (!days.length) return `<p class="kd">Noch keine Änderungen seit Beginn der Erfassung.</p>`;
    const sel = days.find((x) => x.d === S.tmDay) || days[0]; S.tmDay = sel.d; S.asof = sel.d < TODAY ? sel.d : null;
    const wd = (d) => ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(d + "T12:00:00Z").getUTCDay()];
    const strip_ = days.map((x) => { const pics = [...x.e.neu, ...x.e.var, ...x.e.down, ...x.e.up, ...x.e.gone].map((y) => y.a).filter((a) => a.thumb).slice(0, 4);
      const parts = [x.e.neu.length && `${x.e.neu.length} neu`, x.e.var.length && `${x.e.var.length} Varianten`, (x.e.down.length + x.e.up.length) && `${x.e.down.length + x.e.up.length} Preise`, x.e.gone.length && `${x.e.gone.length} weg`].filter(Boolean);
      return `<button class="tmd ${x.d === sel.d ? "on" : ""}" data-tmday="${x.d}"><span class="tmh">${wd(x.d)} ${fS(x.d)}</span><span class="tmp">${pics.map((a) => img(a.thumb)).join("")}</span><span class="tmc">${parts.join(" · ")}</span></button>`; }).join("");
    const block = (title, arr, fmt) => (arr.length ? `<div class="sec"><div class="h"><h2>${title}</h2><span class="kd">${arr.length}</span>${sortCtl("tm-s", "sort")}${vsw("tm")}</div>${(arr = S.ss["tm-s"]?.k ? (() => { const m = new Map(arr.map((y) => [y.a, y])); return ssort(arr.map((y) => y.a), "tm-s", "sort").map((a) => m.get(a)); })() : arr, "")}${VK("tm") ? tiles(arr.slice(0, S.more["tm" + title] ? 500 : 12).map((y) => y.a), false) : `<div class="tw"><table><tbody>${arr.slice(0, S.more["tm" + title] ? 500 : 12).map((y) => `<tr data-go="#/artikel?id=${encodeURIComponent(y.a.id)}"><td class="im">${img(y.a.thumb)}</td><td><div class="nm">${esc(y.a.name)} <span style="font-weight:400">${esc(y.a.kind)}</span></div><div class="kd vh">${esc(colOf(y.a))}</div></td><td class="r tn">${fmt(y)}</td><td>${favBtn(y.a.no, y.a.name)}</td></tr>`).join("")}</tbody></table></div>`}${arr.length > 12 ? `<button class="lnk" data-more="tm${esc(title)}">${S.more["tm" + title] ? "weniger" : `alle ${arr.length} zeigen`}</button>` : ""}</div>` : "");
    const e = sel.e, big = (y) => Math.abs((y.to / y.from - 1) * 100);
    return `<p class="kd" style="margin:0 0 10px">Jeder Tag, an dem sich im Sortiment etwas geändert hat. Seitlich wischen, Tag antippen.</p>
      <div class="tmstrip">${strip_}</div>
      <h2 style="margin-top:18px;font-size:15px;text-transform:none;letter-spacing:0">Änderungen am ${wd(sel.d)}, ${fD(sel.d)}</h2>
      ${block("Neue Produkte", e.neu, (y) => pr(y.a.price))}
      ${block("Neue Farben und Größen", e.var, (y) => pr(y.a.price))}
      ${block("Preis gesenkt", e.down.slice().sort((x, y) => big(y) - big(x)), (y) => `<span class="dn">${eur(y.from)} → ${eur(y.to)}</span><div class="kd">−${Math.round(big(y))} %</div>`)}
      ${block("Preis erhöht", e.up.slice().sort((x, y) => big(y) - big(x)), (y) => `<span class="up">${eur(y.from)} → ${eur(y.to)}</span><div class="kd">+${Math.round(big(y))} %</div>`)}
      ${block("Ausgelistet", e.gone, (y) => pr(y.a.price))}
      <div class="sec"><div class="h"><h2>Sortiment am ${fD(sel.d)}</h2><span class="kd">rekonstruiert aus Preisverlauf, Erscheinen und Auslisten</span></div>${pageList("sort", { embedded: true })}</div>`;
  }
  function parseHash() {
    let h = location.hash.replace(/^#\/?/, "") || "start"; const [name, qs] = h.split("?"); const p = new URLSearchParams(qs || "");
    const map = { aktuell: "fundgrube", archiv: "fundgrube", gemerkt: "start", katalog: "sortiment", katalogstat: "analyse", statistik: "analyse", maerkte: "analyse", merkliste: "start" };
    return { name: map[name] || name, orig: name, p };
  }
  let rendering = false, again = false;
  async function render() {
    if (rendering) { again = true; return; }
    rendering = true;
    try {
      const { name, orig, p } = parseHash(), app = $("#app"), y = scrollY;
      const tab = ["start", "fundgrube", "sortiment", "timemachine", "analyse", "daten", "einstellungen"].includes(name) ? name : ["artikel", "produkt"].includes(name) ? "sortiment" : ["angebot"].includes(name) ? "fundgrube" : name === "markt" ? "analyse" : "start";
      // alte Links übernehmen
      if (orig === "archiv") S.f.fund = { ...S.f.fund, zeit: "weg" };
      if ((orig === "aktuell" || orig === "archiv") && p.get("s")) S.f.fund = { ...S.f.fund, markt: [p.get("s")] };
      if (orig === "maerkte") p.set("b", "maerkte");
      if (orig === "sortiment" && p.get("markt")) { location.replace(`#/markt?id=${encodeURIComponent(p.get("markt"))}`); return; }
      if (name === "sortiment") { if (p.get("bereich")) { S.f.sort = { bereich: [p.get("bereich")] }; history.replaceState(null, "", "#/sortiment"); } if (p.get("des")) { S.f.sort = { des: [p.get("des")] }; history.replaceState(null, "", "#/sortiment"); } if (p.get("q")) { S.f.sort = { q: p.get("q") }; history.replaceState(null, "", "#/sortiment"); } if (p.get("coll")) { S.f.sort = { coll: [p.get("coll")], stand: "auch" }; S.grp = "prod"; history.replaceState(null, "", "#/sortiment"); } }
      if (!keepScroll) app.innerHTML = frame(tab, `<p class="wait">lädt …</p>`);
      const katNow = await loadKatalog();
      if (katNow.failed) { S.kat = katNow; for (const o of FALL()) linkOffer(o); } else if (S.kat?.failed) S.kat = katNow;
      const detailPage = ["artikel", "angebot", "produkt"].includes(name);
      const needR = ["sortiment", "timemachine", "markt", "analyse", "start"].includes(name) || detailPage, needF = ["sortiment", "timemachine", "analyse", "start"].includes(name) || detailPage;
      const needI = ["sortiment", "artikel", "angebot", "produkt", "einstellungen"].includes(name) || (name === "analyse" && p.get("b") === "laender");
      await Promise.all([needR ? loadRange() : null, needF ? loadFacets() : null, detailPage ? loadDetails() : null, needI ? loadIntl() : null]);
      const needArch = (name === "fundgrube" && S.f.fund.zeit) || ["artikel", "produkt", "angebot"].includes(name) || (name === "analyse" && p.get("b") === "fundgrube") || (name === "start" && !S.repo.archive);
      if (needArch && !S.repo.archive) loadArchive().then(() => { memo.clear(); for (const o of FALL()) linkOffer(o); render(); }).catch((e) => console.warn(e));
      let page;
      if (name === "artikel") { const a = S.kat.byId.get(p.get("id")); page = a ? pageArticle(a) : `<button class="back" data-back>← zurück</button><h1>Artikel nicht gefunden</h1>`; }
      else if (name === "produkt") page = pageProduct(ZC.normArticle(p.get("art")));
      else if (name === "angebot") { const o = FALL().find((x) => x.id === p.get("id")); page = o ? pageOffer(o) : S.repo.archive ? `<button class="back" data-back>← zurück</button><h1>Angebot nicht gefunden</h1>` : `<p class="wait">Archiv lädt …</p>`; }
      else if (name === "markt") page = pageMarket(p.get("id"));
      else if (tab === "start") page = pageStart();
      else if (tab === "fundgrube") { if (S.asof) { S.asof = null; memo.clear(); } page = pageList("fund"); }
      else if (tab === "sortiment") { if (S.asof) { S.asof = null; memo.clear(); } page = pageList("sort"); }
      else if (tab === "timemachine") page = pageTM();
      else if (tab === "analyse") page = pageAna(p.get("b") || "uebersicht");
      else if (tab === "daten") page = await pageDaten();
      else page = await pageEinst();
      if (S.kat?.failed) page = `<div class="err">Die Sortimentsdaten konnten nicht geladen werden (Verbindung?). Ohne sie fehlen Sortiment, Artikeldetails und die Zuordnung der Fundgrube-Angebote. <button class="lnk" data-retry>Erneut versuchen</button></div>` + page;
      app.innerHTML = frame(tab, page);
      document.title = { start: "Start", fundgrube: "Fundgrube", sortiment: "Sortiment", timemachine: "Time Machine", analyse: "Analyse", daten: "Daten", einstellungen: "Einstellungen" }[tab] + " · Zweite Chance";
      const want = keepScroll ? y : scrollMem.get(location.hash); scrollTo(0, want != null ? want : 0); if (keepScroll) requestAnimationFrame(() => scrollTo(0, y)); keepScroll = false;
    } catch (e) { console.error(e); $("#app").innerHTML = frame("start", `<div class="err"><b>Fehler beim Anzeigen:</b> ${esc(e.message || e)}</div>`); }
    finally { rendering = false; if (again) { again = false; keepScroll = true; render(); } }
  }
  const scrollMem = new Map(); let keepScroll = false;
  function frame(tab, page) {
    const meta = S.repo.meta, age = meta ? (Date.now() - new Date(meta.updated)) / 36e5 : 99;
    return `<header class="wx"><div class="hd"><div class="brand">Zweite Chance</div><nav class="tabs" aria-label="Hauptnavigation">${TABS.map(([k, l]) => `<button data-go="#/${k}" ${tab === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav><div class="mine">${meta ? `<span class="${age > 3 ? "up" : ""}">Stand ${rel(meta.updated)}</span>` : "keine Daten"}</div></div></header><main class="wx">${page}</main>`;
  }
  const rerender = () => { keepScroll = true; render(); };
  let rzW = innerWidth, rzT; addEventListener("resize", () => { if (Math.abs(innerWidth - rzW) < 30) return; clearTimeout(rzT); rzT = setTimeout(() => { rzW = innerWidth; rerender(); }, 250); });
  const setF = (tab, k, v) => { S.f[tab] = { ...S.f[tab], [k]: v }; S.shown = 150; };
  const tabKey = () => (["sortiment", "timemachine"].includes(parseHash().name) ? "sort" : "fund");
  function exportCSV(tab) {
    const list = apply(tab, S.f[tab]);
    const cols = tab === "fund" ? [["Artikel", (o) => o.art ? o.art.name : o.title], ["Beschreibung", (o) => o.product_description], ["Artikelnummer", (o) => fNo(o.no)], ["Markt", (o) => o.market], ["Zustand", (o) => o.condition], ["Grund", (o) => o.reason_discount], ["Preis", (o) => o.price], ["Regulär", (o) => o.orig], ["Rabatt %", (o) => o.disc], ["eingestellt", (o) => (o.base ? "" : o.start)], ["weg", (o) => o.end || ""]]
      : [["Name", (a) => a.name], ["Produkt", (a) => a.kind], ["Farbe/Größe", (a) => ausOf(a)], ["Artikelnummer", (a) => fNo(a.no)], ["Bereich", (a) => a.top], ["Preis", (a) => a.price], ["Vorher", (a) => a.prev || ""], ["neu seit", (a) => day(a.first) || ""], ["ausgelistet", (a) => day(a.gone) || ""], ["Märkte", (a) => a.nMk ?? ""], ["Bewertung", (a) => a.rating || ""]];
    const cell = (v) => { const s = String(v ?? ""); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = "﻿" + [cols.map((c) => c[0]).join(";"), ...list.map((o) => cols.map((c) => cell(c[1](o))).join(";"))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = `zweite-chance_${tab === "fund" ? "fundgrube" : "sortiment"}_${TODAY}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button,[data-go],[data-runsearch],th[data-sortby],th[data-ts],label[data-addk],[data-intl],[data-bund],[data-href],[data-net]");
    if (S.open && !e.target.closest(".pop") && !(t && t.dataset.pop)) { S.open = null; S.sq = {}; if (!t) return rerender(); }
    if (!t || t.tagName === "A") return;
    const d = t.dataset, tab = tabKey();
    if (d.fav) { e.stopPropagation(); e.preventDefault(); return toggleFav(d.fav, d.label || d.fav); }
    if (d.go) {
      e.preventDefault();
      if (d.go === "#treffer") { $("#treffer")?.scrollIntoView({ behavior: "smooth" }); return; }
      if (d.pre === "newmine") S.f.fund = { markt: [...MINE()], besuch: true };
      if (d.pre === "favchg") S.f.sort = { gemerkt: true, chg: "any" };
      if (d.pre?.startsWith("markt:")) S.f.fund = { markt: [d.pre.slice(6)] };
      if (d.pre?.startsWith("{")) { S.f.sort = JSON.parse(d.pre); if (S.f.sort.coll) S.grp = "prod"; }
      scrollMem.set(location.hash, scrollY);
      if (location.hash === d.go) return render();
      location.hash = d.go; return;
    }
    if (d.back !== undefined) { history.length > 1 ? history.back() : (location.hash = "#/start"); return; }
    if (d.runsearch) { const r = allRules().find((x) => x.id === d.runsearch); if (!r) return; S.f.fund = r.ui ? JSON.parse(JSON.stringify(r.ui)) : { q: (r.keywords || []).join(" ") || (r.article_numbers || []).join(" "), ...(r.stores?.length ? { markt: r.stores.filter((s) => storeList().some((x) => x.id === s)) } : {}), ...(r.max_price ? { preis: { max: String(r.max_price) } } : {}) }; location.hash = "#/fundgrube"; return; }
    if (d.sortby) { if (S.sort[tab] === d.sortby) S.rev[tab] = !S.rev[tab]; else { S.sort[tab] = d.sortby; S.rev[tab] = false; } return rerender(); }
    if (d.srev) { const c = S.ss[d.srev] || {}; S.ss[d.srev] = { ...c, rev: !c.rev }; return rerender(); }
    if (d.ts) { const [id, k] = d.ts.split("|"), c = S.ts[id] || {}; S.ts[id] = c.k === k ? { k, rev: !c.rev } : { k, rev: false }; return rerender(); }
    if (d.pop) { S.open = S.open === d.pop ? null : d.pop; S.sq = {}; return rerender(); }
    if (d.addk) { S.open = d.addk; return rerender(); }
    if (d.shut !== undefined) { S.open = null; return rerender(); }
    if (d.untok) { if (d.untok === "q") setF(tab, "q", ""); else { const cur = S.f[tab][d.untok]; setF(tab, d.untok, Array.isArray(cur) ? cur.filter((x) => x !== d.v) : null); } return rerender(); }
    if (d.reset) { setF(tab, d.reset, null); S.open = null; return rerender(); }
    if (d.more) { S.more[d.more] = !S.more[d.more]; return rerender(); }
    if (d.net !== undefined) { S.netSel = d.net || null; return rerender(); }
    if (d.bund) { S.more["b" + d.bund] = !S.more["b" + d.bund]; return rerender(); }
    if (d.vk) { S.view[d.vk] = d.vv; lsSet(LS.view, S.view); return rerender(); }
    if (d.gal) { const b = $("#bigimg img"); if (b) b.src = d.gal; t.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === t)); return; }
    if (d.href) { window.open(d.href, "_blank", "noopener"); return; }
    if (d.clear !== undefined) { S.f[tab] = {}; S.shown = 150; return rerender(); }
    if (d.showmore !== undefined) { S.shown += 150; return rerender(); }
    if (d.view) { S.view[tab] = d.view; lsSet(LS.view, S.view); return rerender(); }
    if (d.grp) { S.grp = d.grp; return rerender(); }
    if (d.ov) { S.ovIkea = d.ov === "1"; return rerender(); }
    if (d.hbdoc) { S.hbDoc = d.hbdoc; return rerender(); }
    if (d.tmday) { S.tmDay = d.tmday; memo.clear(); return rerender(); }
    if (d.intl) { S.intlCc = d.intl; return rerender(); }
    if (d.heat) { S.heatSort = d.heat; return rerender(); }
    if (d.scroll) { document.getElementById(d.scroll)?.scrollIntoView({ behavior: "smooth" }); return; }
    if (d.export) return exportCSV(d.export);
    if (d.follow) {
      const { k, v } = JSON.parse(d.follow), mine = S.rules.filter((r) => r.sub && r.sub.k === k && r.sub.v === v);
      if (allRules().some((r) => r.sub && r.sub.k === k && r.sub.v === v)) {
        if (!mine.length) { toast("Dieser Eintrag stammt aus der Sicherung und ist erst mit verbundenem Hilfsdienst änderbar."); return; }
        if (!confirmTwice(`${subLabel({ k, v })} nicht mehr folgen?`)) return;
        S.rules = S.rules.filter((r) => !mine.includes(r)); await persistRules(true); toast("Nicht mehr gefolgt. Früherer Stand bleibt wiederherstellbar.");
      } else {
        S.rules.push({ id: newId(), name: `Folgen: ${subLabel({ k, v })}`, enabled: true, notify: true, sub: { k, v, raw: k === "des" ? S.facets?.praw.get(v) || [v] : undefined }, stores: MINE() });
        if (await persistRules()) toast(`Du folgst ${esc(subLabel({ k, v }))}. Telegram meldet Neuheiten, Auslistungen, Preisänderungen und Fundgrube-Angebote in deinen Märkten.`);
      }
      memo.clear(); return rerender();
    }
    if (d.crumb !== undefined) { S.f.sort = d.crumb ? JSON.parse(d.crumb) : {}; S.grp = d.crumb && JSON.parse(d.crumb).coll ? "prod" : S.grp; location.hash = "#/sortiment"; return; }
    if (d.desfilter) { S.f.sort = { des: [d.desfilter] }; location.hash = "#/sortiment"; return; }
    if (d.savesearch !== undefined) {
      const f = JSON.parse(JSON.stringify(S.f.fund)), name = sentence("fund", f).replace(/^Zeige aktuelle /, "");
      S.rules.push({ id: newId(), name: name.slice(0, 120), enabled: true, notify: true, ui: f, keywords: f.q ? [f.q] : [], stores: f.markt || [], conditions: f.zust || [], min_price: f.preis?.min ? +f.preis.min : null, max_price: f.preis?.max ? +f.preis.max : null, min_discount_pct: f.rabatt ? +f.rabatt : null });
      if (await persistRules()) toast("Suche gemerkt. Telegram meldet neue Treffer."); memo.clear(); return rerender();
    }
    if (d.notify) { const r = S.rules.find((x) => x.id === d.notify); if (!r) { toast("Dieser Eintrag stammt aus der Sicherung und ist erst mit verbundenem Hilfsdienst änderbar."); return; } const onNow = r.notify !== false && r.enabled !== false; r.notify = !onNow; r.enabled = true; await persistRules(); memo.clear(); return rerender(); }
    if (d.delrule) { const r = S.rules.find((x) => x.id === d.delrule); if (!r || !confirmTwice(`„${isFavRule(r) ? r.name : ruleText(r)}“ entfernen?`)) return; S.rules = S.rules.filter((x) => x.id !== r.id); await persistRules(true); memo.clear(); toast("Entfernt. Früherer Stand bleibt wiederherstellbar."); return rerender(); }
    if (d.restore) { if (!confirmTwice("Diesen früheren Stand der Merkliste wiederherstellen?")) return; try { const snap = await worker.call("GET", null, { path: `/api/history?id=${encodeURIComponent(d.restore)}` }); S.rules = ZC.dedupeRules(snap.rules || []).map(withId); S.hist = null; await persistRules(true); memo.clear(); toast("Früherer Stand wiederhergestellt."); rerender(); } catch (err) { toast(`Nicht möglich: ${esc(err.message)}`); } return; }
    if (d.asofOff !== undefined) { S.asof = null; memo.clear(); return rerender(); }
    if (d.retry !== undefined) { S.kat = null; memo.clear(); return render(); }
    if (d.backup !== undefined) { t.disabled = true; backup().catch((err) => { const el = $("#bk"); if (el) el.textContent = `Fehler: ${err.message || err}`; }).finally(() => { t.disabled = false; }); return; }
    if (d.logout !== undefined) { lsSet(LS.key, null); lsSet(LS.pw, null); location.reload(); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target, d = t.dataset, tab = tabKey();
    if (d.k) { const def = DEF[tab].find((x) => x.k === d.k); if (def.t === "multi") { const cur = S.f[tab][d.k] || []; setF(tab, d.k, t.checked ? [...cur, d.v] : cur.filter((x) => x !== d.v)); } else { setF(tab, d.k, d.v); S.open = null; } return rerender(); }
    if (d.mine) { setF(tab, d.mine, t.checked ? [...MINE()] : []); return rerender(); }
    if (d.tg) { setF(tab, d.tg, t.checked); S.open = null; return rerender(); }
    if (d.range) { const cur = S.f[tab][d.range] || {}; setF(tab, d.range, { ...cur, [d.side]: t.value }); return rerender(); }
    if (d.asof !== undefined) { S.asof = t.value && t.value < TODAY ? t.value : null; memo.clear(); S.shown = 150; if (S.asof && !S.repo.archive) loadArchive().then(() => { memo.clear(); for (const o of FALL()) linkOffer(o); rerender(); }); return rerender(); }
    if (d.srt) { S.sort[d.srt] = t.value; return rerender(); }
    if (d.srtpick) { S.sort[tab] = d.srtpick; S.rev[tab] = false; return rerender(); }
    if (d.srtdir) { S.rev[tab] = d.srtdir === "1"; S.open = null; return rerender(); }
    if (d.ssel) { S.ss[d.ssel] = { k: t.value, rev: false }; return rerender(); }
    if (d.grppick) { S.grp = d.grppick; return rerender(); }
    if (d.viewpick) { S.view[tab] = d.viewpick; lsSet(LS.view, S.view); return rerender(); }
    if (d.cmp !== undefined) { S.cmp = t.value; return rerender(); }
    if (d.intloff) { const off = lsGet(LS.intlOff, []); lsSet(LS.intlOff, t.checked ? off.filter((x) => x !== d.intloff) : [...new Set([...off, d.intloff])]); memo.clear(); return rerender(); }
    if (d.minepick) { const m = MINE(); lsSet(LS.mine, t.checked ? [...new Set([...m, d.minepick])] : m.filter((x) => x !== d.minepick)); memo.clear(); return rerender(); }
  });
  document.addEventListener("toggle", (e) => { const d = e.target.dataset; if (d && d.fd) S.fo[d.fd] = e.target.open; }, true);
  document.addEventListener("submit", (e) => { if (e.target.id === "wurl") { e.preventDefault(); lsSet(LS.workerUrl, new FormData(e.target).get("u").trim()); toast("Gespeichert, lade neu …"); setTimeout(() => location.reload(), 600); } });
  let qt;
  document.addEventListener("input", (e) => {
    const d = e.target.dataset, id = e.target.id;
    const refocus = () => { const i = document.getElementById(id); if (i) { i.focus(); i.setSelectionRange?.(i.value.length, i.value.length); } };
    if (d.sq) { S.sq[d.sq] = e.target.value; clearTimeout(qt); qt = setTimeout(async () => { keepScroll = true; await render(); refocus(); }, 150); return; }
    if (d.q) { clearTimeout(qt); const v = e.target.value; qt = setTimeout(async () => { setF(d.q, "q", v); keepScroll = true; await render(); refocus(); }, 300); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset?.range) { e.preventDefault(); const tb = tabKey(), dd = e.target.dataset, cur = S.f[tb][dd.range] || {}; setF(tb, dd.range, { ...cur, [dd.side]: e.target.value }); S.open = null; rerender(); return; } if (e.key === "Escape" && S.open) { S.open = null; rerender(); } if (e.key === "Enter" && e.target.matches?.("tr[data-go],div[data-go]")) e.target.click(); });
  window.addEventListener("hashchange", () => { S.open = null; render(); });

  /* ================= Start ================= */
  function loginForm(message) {
    return new Promise((resolve) => {
      const box = $("#login"); box.hidden = false; $("#app").hidden = true;
      const form = $("#login-form"), msg = $("#login-msg"), pw = $("#login-pw");
      msg.textContent = message || ""; pw.focus();
      form.onsubmit = async (e) => {
        e.preventDefault(); msg.textContent = "Prüfe …"; form.querySelector("button").disabled = true;
        try {
          const b64 = await ZC.deriveKeyB64(pw.value); AUTH.key = await ZC.importKey(b64); AUTH.pw = pw.value;
          await loadRepo(); lsSet(LS.key, b64); lsSet(LS.pw, pw.value);
          box.hidden = true; $("#app").hidden = false; resolve();
        } catch (err) { msg.textContent = err instanceof AuthError ? "Passwort stimmt nicht." : `Fehler: ${err.message || err}`; form.querySelector("button").disabled = false; pw.select(); }
      };
    });
  }
  async function unlock() {
    const k = lsGet(LS.key, null);
    if (k) { try { AUTH.key = await ZC.importKey(k); AUTH.pw = lsGet(LS.pw, null); await loadRepo(); return; } catch (e) { if (!(e instanceof AuthError)) throw e; lsSet(LS.key, null); } }
    await loginForm();
  }
  async function refresh() {
    const m = await getBin("meta.bin").catch(() => null);
    if (!m || m.updated === S.repo.meta?.updated) return;
    await loadRepo().catch(() => {});
    { S.kat = null; S.rng = undefined; S.facets = undefined; S.details = undefined; S.state = undefined; S.repo.runs = null; memo.clear(); await loadKatalog(); toast("Neue Daten geladen."); rerender(); }
  }
  async function init() {
    await unlock();
    document.body.classList.remove("locked");
    render();
    setTimeout(() => lsSet(LS.lastVisit, new Date().toISOString()), 60000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) lsSet(LS.lastVisit, new Date().toISOString()); else refresh(); });
    setInterval(refresh, 10 * 60 * 1000);
  }
  window.ZCApp = { state: S, render };
  init().catch((e) => { $("#app").innerHTML = `<div class="err wx"><b>Start fehlgeschlagen:</b> ${esc(e.message || e)}</div>`; });
})();

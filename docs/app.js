/* Zweite-Chance-Monitor – Web-App (ohne Build, ohne Abhängigkeiten). */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $("#view");
  const TZ = "Europe/Berlin";
  const LS = { rules: "zc.rules", lastVisit: "zc.lastVisit", prevVisit: "zc.prevVisit", source: "zc.source", layout: "zc.layout", notify: "zc.notify", seenHits: "zc.seenHits", key: "zc.k", pw: "zc.p", savedSort: "zc.ss", workerUrl: "zc.w" };

  /* ---------- Formatierung ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = (v) => v === null || v === undefined ? "–" : `${nf2.format(v)} €`;
  const eur0 = (v) => v === null || v === undefined ? "–" : `${nf0.format(Math.round(v))} €`;
  const pct = (v) => v === null || v === undefined ? "–" : `${nf0.format(Math.round(v))} %`;
  const dtf = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const df = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  const dayFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }), dayMemo = new Map();
  // Berliner Tag; je volle Stunde nur einmal berechnet (Zeitzonen-Versatz ist stundengenau)
  const dayKey = (ts) => { if (typeof ts !== "string") return dayFmt.format(new Date(ts)); const h = ts.slice(0, 13); let d = dayMemo.get(h); if (!d) dayMemo.set(h, d = dayFmt.format(new Date(ts))); return d; };
  const fmtDT = (ts) => ts ? dtf.format(new Date(ts)) : "–";
  const fmtD = (ts) => ts ? df.format(new Date(ts)) : "–";
  function rel(ts) {
    if (!ts) return "–";
    const s = (Date.now() - new Date(ts)) / 1000;
    if (s < 90) return "gerade eben";
    if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
    if (s < 86400 * 1.5) return `vor ${Math.round(s / 3600)} Std.`;
    if (s < 86400 * 60) return `vor ${Math.round(s / 86400)} Tagen`;
    return fmtD(ts);
  }
  const days = (a, b) => a && b ? (new Date(b) - new Date(a)) / 864e5 : null;
  const dur = (d) => d === null ? "–" : d < 1 ? `${Math.max(1, Math.round(d * 24))} Std.` : `${nf0.format(Math.round(d))} Tag${Math.round(d) === 1 ? "" : "e"}`;
  const median = (a) => { const s = a.filter((x) => x !== null && !Number.isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  function toast(msg, ms = 4200) { const t = document.createElement("div"); t.className = "toast"; t.innerHTML = msg; $("#toasts").appendChild(t); setTimeout(() => t.remove(), ms); }
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat-Modus */ } };

  function csvCell(v) { if (v === null || v === undefined) return ""; if (Array.isArray(v)) v = v.join("|"); const s = String(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function download(name, text, type = "text/csv;charset=utf-8") {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([type.startsWith("text/csv") ? "\ufeff" + text : text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function toCSV(rows, cols) { return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n"); }
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const [h, ...rest] = rows; return h ? rest.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))) : [];
  }

  /* ---------- Datenhaltung ---------- */
  const S = {
    repo: { meta: null, current: [], archive: {}, watch: [], runs: null, history: null },
    archiveMonth: null,
    local: { db: {}, events: [], runs: [], updated: null, stores: [] },
    source: lsGet(LS.source, "auto"),
    rules: ZC.dedupeRules(lsGet(LS.rules, [])),
    prevVisit: null,
    filters: {},
    layout: lsGet(LS.layout, "list"),
    savedSort: lsGet(LS.savedSort, "treffer"),
    shown: 120,
  };

  async function getText(url, cache = "no-cache") { const r = await fetch(url, { cache }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }

  // IndexedDB (lokaler Bestand aus Lesezeichen-Importen)
  const idb = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open("zweite-chance", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async get(k) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  };
  async function loadLocal() { try { const v = await idb.get("state"); if (v) S.local = v; } catch (e) { console.warn("IndexedDB nicht verfügbar", e); } }
  const saveLocal = () => idb.set("state", S.local);
  const hasLocal = () => Object.keys(S.local.db).length > 0;
  const hasRepo = () => !!S.repo.meta;

  /* ---------- Zugang: alle Daten liegen verschlüsselt auf dem Server ---------- */
  class AuthError extends Error {}
  const AUTH = { key: null, pw: null };
  async function getBin(name, version) {
    const r = await fetch(`d/${name}${version ? "?v=" + encodeURIComponent(version) : ""}`, { cache: version ? "force-cache" : "no-cache" });
    if (!r.ok) throw new Error(`${r.status} ${name}`);
    try { return await ZC.openBlob(await r.arrayBuffer(), AUTH.key); }
    catch (e) { throw new AuthError("Passwort stimmt nicht"); }
  }
  const storeIndex = () => Object.fromEntries((S.repo.meta?.stores || []).map((s) => [s.id, s]));
  const unpack = (d) => ZC.unpackOffers(d, storeIndex(), Object.fromEntries((S.repo.meta?.stores || []).map((s) => [s.id, s.last_ok])), S.repo.meta?.updated);

  const worker = {
    // Adresse kommt aus dem Abruf (GitHub-Secret WORKER_URL); notfalls hier im Browser eingetragen (Daten-Seite)
    get url() { const u = (S.repo.meta?.worker || lsGet(LS.workerUrl, "") || "").trim().replace(/\/+$/, ""); return u ? (/^https?:\/\//i.test(u) ? u : "https://" + u) : null; },
    async call(method, body, { path = "/api/watchlist", confirmDelete = false } = {}) {
      const r = await fetch(`${this.url}${path}`, { method, headers: { "x-key": AUTH.pw, "content-type": "application/json", ...(confirmDelete ? { "x-confirm-delete": "2" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(`Worker ${r.status}`);
      return r.json();
    },
  };
  async function loadRules() {
    S.server = { ok: false, groups: {} };
    if (worker.url && AUTH.pw) {
      try {
        const w = await worker.call("GET");
        S.server = { ok: true, groups: w.groups || {}, dupFix: ZC.dedupeRules(w.rules || []).length < (w.rules || []).length };
        const old = lsGet(LS.rules, []);                       // frühere, nur lokal gespeicherte Regeln einmalig übernehmen
        let base = w.rules || [], seed = false;
        if (!base.length) {                                    // Server noch leer: mit der letzten Sicherung befüllen, nichts geht verloren
          const saved = await getBin("watchlist.bin").catch((e) => { if (e instanceof AuthError) throw e; return { rules: [] }; });
          base = saved.rules || []; seed = base.length > 0;
        }
        const merged = ZC.dedupeRules([...base, ...old]);
        S.rules = merged.map(withId); S.repo.watch = []; resetRules();
        if ((old.length || seed) && await persistRules() && old.length) lsSet(LS.rules, []);
        return;
      } catch (e) { console.warn("Merkliste vom Server nicht lesbar", e); }
    }
    const saved = await getBin("watchlist.bin").catch((e) => { if (e instanceof AuthError) throw e; return { rules: [] }; });
    S.repo.watch = ZC.dedupeRules((saved.rules || []).map((r, i) => ({ ...r, name: r.name || `Regel ${i + 1}`, _repo: true }))).map(withId);
    S.rules = S.rules.map(withId); resetRules();
  }
  // Entfernen nur nach doppelter Bestätigung; der Server behält jeden früheren Stand.
  const confirmTwice = (what) => confirm(`${what}\n\nBestätigung 1 von 2.`) && confirm(`Wirklich? ${what}\n\nBestätigung 2 von 2 – danach ist es aus der Liste entfernt (früherer Stand bleibt wiederherstellbar).`);
  async function persistRules(confirmDelete = false) {
    S.rules = ZC.dedupeRules(S.rules); resetRules();
    if (S.server?.ok) {
      try { await worker.call("PUT", { rules: S.rules.map(withId).map(({ _localIndex, _repo, ...r }) => r), groups: S.server.groups }, { confirmDelete: confirmDelete || S.server.dupFix }); S.server.dupFix = false; return true; }
      catch (e) { toast(`<b>Merkliste nicht gespeichert:</b> ${esc(e.message)}`, 7000); return false; }
    }
    lsSet(LS.rules, S.rules); return true;
  }

  async function loadRepo() {
    let meta;
    try { meta = await getBin("meta.bin"); }
    catch (e) { if (e instanceof AuthError) throw e; S.repo.meta = null; return; }
    S.repo.meta = meta;
    S.repo.current = unpack(await getBin("current.bin", meta.current_version).catch((e) => { if (e instanceof AuthError) throw e; return null; }));
    await loadRules();
  }
  // Archiv: je Monat eine Datei, nur bei Bedarf geladen (Standard: der neueste Monat)
  const archiveMonths = () => (S.repo.meta?.archive_months || []).slice().sort();
  async function loadArchive(months) {
    if (!hasRepo()) return;
    const want = (months || archiveMonths()).filter((m) => !(m in S.repo.archive));
    const parts = await Promise.all(want.map((m) => getBin(`a-${m}.bin`, (S.repo.meta.archive_hash || {})[m] || S.repo.meta.updated).then(unpack)));
    want.forEach((m, i) => { S.repo.archive[m] = parts[i]; });
  }
  const archiveFullyLoaded = () => archiveMonths().every((m) => m in S.repo.archive);

  function activeSource() { if (S.source === "repo" && hasRepo()) return "repo"; if (S.source === "local" && hasLocal()) return "local"; if (S.source === "both" && hasRepo() && hasLocal()) return "both"; return hasRepo() ? (hasLocal() && S.source === "auto" ? "both" : "repo") : hasLocal() ? "local" : "none"; }
  function allOffers(includeArchive) {
    const src = activeSource(); const map = new Map();
    const put = (o) => { const p = map.get(o.id); if (!p || (o.last_seen || "") > (p.last_seen || "")) map.set(o.id, o); };
    if (src === "repo" || src === "both") { S.repo.current.forEach(put); if (includeArchive) Object.values(S.repo.archive).flat().forEach(put); }
    if (src === "local" || src === "both") Object.values(S.local.db).forEach((o) => { if (includeArchive || o.status === "active") put(o); });
    return [...map.values()];
  }
  function stores() {
    const m = new Map();
    for (const s of S.repo.meta?.stores || []) m.set(s.id, s);
    for (const s of S.local.stores || []) if (!m.has(s.id)) m.set(s.id, s);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
  const updatedAt = () => [S.repo.meta?.updated, S.local.updated].filter(Boolean).sort().pop() || null;
  // Lokal bearbeitete Fassung ersetzt die gleichnamige (gleiche ID) aus der Sicherung
  const allRules = () => { const own = new Set(S.rules.map((r) => r.id)); return ZC.dedupeRules([...S.repo.watch.filter((r) => !own.has(r.id)), ...S.rules]); };
  // Stabile Kennung je gemerkter Suche (bleibt beim Bearbeiten erhalten)
  const hashStr = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const withId = (r) => (r.id ? r : { ...r, id: "r" + hashStr(ZC.ruleKey(r)) });
  const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  let rulesMemo = null, savedMemo = null;                 // vorbereitete Regeln; bei jeder Änderung verwerfen
  const resetRules = () => { rulesMemo = null; savedMemo = null; };
  // "Merkliste"-Markierung und Telegram: nur aktive Suchen mit Benachrichtigung
  const compiledRules = () => rulesMemo || (rulesMemo = allRules().filter((r) => r.enabled !== false && r.notify !== false).map((r) => ({ r, f: ZC.compileRule(r) })));
  // Alle gemerkten Suchen (auch pausierte / ohne Telegram) mit Trefferzahlen
  function savedSearches() {
    if (savedMemo) return savedMemo;
    const act = allOffers(false).filter((o) => o.status === "active");
    savedMemo = allRules().map((r) => {
      const f = ZC.compileRule({ ...r, enabled: true });
      let n = 0, nNew = 0;
      for (const o of act) if (f(o)) { n++; if (isNew(o)) nNew++; }
      return { r, f, n, nNew, editable: S.rules.some((x) => x.id === r.id) };
    });
    return savedMemo;
  }
  const savedById = (id) => savedSearches().find((x) => x.r.id === id);
  const SAVED_SORT = { treffer: ["Meiste Treffer", (a, b) => b.n - a.n], neu: ["Neue Treffer", (a, b) => b.nNew - a.nNew || b.n - a.n], name: ["Name", (a, b) => (a.r.name || "").localeCompare(b.r.name || "", "de")] };
  const isNew = (o) => S.prevVisit && o.first_seen > S.prevVisit;
  function hitRules(o) { const out = []; for (const { r, f } of compiledRules()) if (f(o)) out.push(r); return out; }

  /* ---------- Filter ---------- */
  const SORTS = {
    neu: ["Neueste zuerst", (a, b) => (b.first_seen || "").localeCompare(a.first_seen || "")],
    rabattpct: ["Höchster Rabatt (%)", (a, b) => (b.discount_pct ?? -1) - (a.discount_pct ?? -1)],
    rabatteur: ["Höchster Rabatt (€)", (a, b) => (b.discount_eur ?? -1) - (a.discount_eur ?? -1)],
    preis: ["Preis aufsteigend", (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9)],
    preisab: ["Preis absteigend", (a, b) => (b.price ?? -1) - (a.price ?? -1)],
    weg: ["Zuletzt verschwunden", (a, b) => (b.gone_at || b.last_seen || "").localeCompare(a.gone_at || a.last_seen || "")],
    dauer: ["Längste Verweildauer", (a, b) => (days(b.first_seen, b.gone_at || b.last_seen) ?? 0) - (days(a.first_seen, a.gone_at || a.last_seen) ?? 0)],
    markt: ["Markt A–Z", (a, b) => (a.store || "").localeCompare(b.store || "", "de") || (a.title || "").localeCompare(b.title || "", "de")],
    titel: ["Produkt A–Z", (a, b) => (a.title || "").localeCompare(b.title || "", "de")],
  };
  const F_KEYS = ["m", "q", "s", "c", "r", "pmin", "pmax", "dmin", "neu", "sort", "von", "bis", "art"];
  function parseQuery(qs) {
    const p = new URLSearchParams(qs || ""); const f = {};
    for (const k of F_KEYS) if (p.get(k)) f[k] = p.get(k);
    if (p.get("hit") && !f.m) f.m = "all";                 // alte Links ("Nur Merklisten-Treffer")
    return f;
  }
  function writeQuery(route, f) { const p = new URLSearchParams(); for (const k of F_KEYS) if (f[k]) p.set(k, f[k]); const qs = p.toString(); history.replaceState(null, "", `#/${route}${qs ? "?" + qs : ""}`); }
  const setOf = (v) => new Set((v || "").split("~").filter(Boolean));

  function applyFilters(list, f, mode) {
    const q = ZC.fold(f.q || "").trim(); const terms = q.split(/\s+/).filter(Boolean);
    const S_ = setOf(f.s), C_ = setOf(f.c), R_ = setOf(f.r);
    const pmin = f.pmin ? Number(f.pmin) : null, pmax = f.pmax ? Number(f.pmax) : null, dmin = f.dmin ? Number(f.dmin) : null;
    const art = f.art ? ZC.normArticle(f.art) : "";
    const mf = !f.m ? null : f.m === "all" ? (o) => hitRules(o).length > 0 : (savedById(f.m)?.f || (() => false));
    return list.filter((o) => {
      if (mode === "archiv" && o.status !== "gone") return false;
      if (mode === "aktuell" && o.status !== "active") return false;
      if (S_.size && !S_.has(o.store_id)) return false;
      if (C_.size && !C_.has(o.condition || "–")) return false;
      if (R_.size && !R_.has(o.reason_discount || "–")) return false;
      if (pmin !== null && (o.price ?? 0) < pmin) return false;
      if (pmax !== null && (o.price ?? 1e9) > pmax) return false;
      if (dmin !== null && (o.discount_pct ?? -1) < dmin) return false;
      if (art && !(o.article_numbers || [o.article_number]).includes(art)) return false;
      if (f.neu && !isNew(o)) return false;
      if (mf && !mf(o)) return false;
      if (mode === "archiv") { if (f.von && dayKey(o.gone_at) < f.von) return false; if (f.bis && dayKey(o.gone_at) > f.bis) return false; }
      if (terms.length) {
        const hay = o._hay || (o._hay = ZC.fold([o.title, o.product_description, o.offer_description, o.article_number, ZC.fmtArticle(o.article_number), o.offer_number, o.condition, o.reason_discount, o.additional_info, o.store].join(" ")));
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }
  function counts(list, key) { const m = new Map(); for (const o of list) { const k = o[key] || "–"; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); }


  /* ---------- Bausteine ---------- */
  function img(o, cls = "offer__img") { return o.image ? `<img class="${cls}" src="${esc(o.image)}?f=xs" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=&quot;${cls} offer__img--none&quot;>▢</div>'">` : `<div class="${cls} offer__img--none" aria-hidden="true">▢</div>`; }
  function badges(o) {
    let b = "";
    if (o.status === "gone") b += `<span class="badge badge--gone">weg</span>`;
    else if (isNew(o)) b += `<span class="badge badge--new">neu</span>`;
    if (o.reappear_count > 0 && o.status === "active") b += ` <span class="badge badge--back" title="War schon einmal verschwunden">wieder da</span>`;
    const ph = o.price_history || []; if (ph.length > 1 && ph[ph.length - 1][1] < ph[0][1]) b += ` <span class="badge badge--drop">billiger</span>`;
    if (hitRules(o).length) b += ` <span class="badge badge--hit">Merkliste</span>`;
    return b;
  }
  function offerRow(o) {
    const life = o.status === "gone" ? `weg seit ${fmtD(o.gone_at)} · ${dur(days(o.first_seen, o.gone_at))} gelistet` : `seit ${rel(o.first_seen)}`;
    return `<li class="offer" tabindex="0" role="button" data-id="${esc(o.id)}" aria-label="${esc(o.title)} – ${esc(eur(o.price))}, ${esc(o.store)}">
      ${img(o)}
      <div style="min-width:0">
        <div class="offer__t">${esc(o.title)} ${badges(o)}</div>
        <div class="offer__d">${esc(o.product_description)}</div>
        <div class="offer__why">${o.condition ? `<span class="chip chip--cond">${esc(o.condition)}</span>` : ""}${o.reason_discount ? `<span class="chip" title="${esc(o.reason_discount)}">${esc(o.reason_discount)}</span>` : ""}</div>
      </div>
      <div class="offer__meta"><b>${esc(o.store)}</b><br>${life}<br><span class="mono">${esc(ZC.fmtArticle(o.article_number))} · #${esc(o.offer_number)}</span></div>
      <div class="offer__price"><div class="price">${esc(eur(o.price))}</div>${o.original_price ? `<div class="was">${esc(eur(o.original_price))}</div>` : ""}${o.discount_pct !== null && o.discount_pct !== undefined ? `<span class="tag">−${esc(pct(o.discount_pct))}</span>` : ""}</div>
    </li>`;
  }
  function offerCard(o) {
    return `<li class="card" tabindex="0" role="button" data-id="${esc(o.id)}">${img(o)}
      <div class="offer__t" style="font-size:14.5px">${esc(o.title)} ${badges(o)}</div>
      <div class="offer__d" style="white-space:normal;font-size:13px">${esc(o.product_description)}</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto"><div><div class="price">${esc(eur(o.price))}</div><div class="was">${esc(eur(o.original_price))}</div></div>${o.discount_pct != null ? `<span class="tag">−${esc(pct(o.discount_pct))}</span>` : ""}</div>
      <div class="muted" style="font-size:12.5px">${esc(o.store)} · ${o.status === "gone" ? "weg " + fmtD(o.gone_at) : rel(o.first_seen)}</div></li>`;
  }
  const EXPORT_COLS = ["id", "offer_uuid", "offer_number", "status", "store_id", "store", "title", "product_description", "offer_description", "article_number", "condition", "condition_description", "reason_discount", "additional_info", "price", "original_price", "discount_eur", "discount_pct", "first_seen", "last_seen", "gone_at", "reappear_count", "link"];

  function checkList(name, entries, selected, labelFn = (k) => k) {
    if (!entries.length) return `<p class="muted" style="font-size:13px;margin:4px 0">Keine Werte</p>`;
    return `<div class="checks">${entries.map(([k, n]) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(k)}" ${selected.has(k) ? "checked" : ""}><span title="${esc(labelFn(k))}">${esc(labelFn(k))}</span><small>${nf0.format(n)}</small></label>`).join("")}</div>`;
  }

  /* ---------- Ansicht: Aktuell / Archiv ---------- */
  async function renderList(mode, query) {
    const f = S.filters = parseQuery(query);
    if (!f.sort) f.sort = mode === "archiv" ? "weg" : "neu";
    if (mode === "archiv" && hasRepo()) {
      const ms = archiveMonths();
      if (!S.archiveMonth || (S.archiveMonth !== "alle" && !ms.includes(S.archiveMonth))) S.archiveMonth = ms[ms.length - 1] || "alle";
      view.innerHTML = `<div class="toolbar"><h2>Archiv</h2></div>${'<div class="skeleton"></div>'.repeat(5)}`;
      await loadArchive(S.archiveMonth === "alle" ? ms : [S.archiveMonth]);
    }
    const inView = (o) => mode !== "archiv" || S.archiveMonth === "alle" || (o.gone_at || "").slice(0, 7) === S.archiveMonth;
    const base = allOffers(mode === "archiv").filter(inView);
    const scoped = base.filter((o) => mode === "archiv" ? o.status === "gone" : o.status === "active");
    if (activeSource() === "none") return renderOnboarding();
    const st = stores();
    const nameOf = Object.fromEntries(st.map((s) => [s.id, s.name]));
    const newCount = mode === "aktuell" && S.prevVisit ? scoped.filter(isNew).length : 0;

    view.innerHTML = `
      <div class="layout">
        <form class="filters" id="filters" role="search" aria-label="Filter">
          <label class="sr" for="f-q">Suche</label>
          <input id="f-q" class="inp search" name="q" type="search" placeholder="Produkt, Artikelnr., Mangel …" value="${esc(f.q || "")}" autocomplete="off">
          <button type="button" class="btn mobile-filter-toggle" id="filter-toggle" aria-expanded="false">Filter</button>
          ${savedCard(f)}
          <fieldset><legend>Markt</legend>
            <input class="inp" id="store-find" placeholder="Markt suchen" style="min-height:30px;padding:4px 8px;font-size:13px" aria-label="Märkte durchsuchen">
            <div id="store-checks">${checkList("s", counts(scoped, "store_id").sort((a, b) => (nameOf[a[0]] || a[0]).localeCompare(nameOf[b[0]] || b[0], "de")), setOf(f.s), (k) => nameOf[k] || k)}</div>
            <button type="button" class="linkbtn" data-clear="s">Auswahl aufheben</button>
          </fieldset>
          <fieldset><legend>Preis &amp; Rabatt</legend>
            <div class="row"><input class="inp" name="pmin" type="number" min="0" inputmode="decimal" placeholder="ab €" value="${esc(f.pmin || "")}" aria-label="Preis ab"><input class="inp" name="pmax" type="number" min="0" inputmode="decimal" placeholder="bis €" value="${esc(f.pmax || "")}" aria-label="Preis bis"></div>
            <label class="muted" style="font-size:12.5px;display:block;margin-top:8px">Rabatt mindestens <b id="dmin-v">${esc(f.dmin || 0)} %</b>
              <input name="dmin" type="range" min="0" max="90" step="5" value="${esc(f.dmin || 0)}" style="width:100%;accent-color:var(--blue)"></label>
          </fieldset>
          <fieldset><legend>Zustand</legend>${checkList("c", counts(scoped, "condition"), setOf(f.c))}</fieldset>
          <fieldset><legend>Grund für den Rabatt</legend>${checkList("r", counts(scoped, "reason_discount").slice(0, 60), setOf(f.r))}</fieldset>
          ${mode === "archiv" ? `<fieldset><legend>Verschwunden zwischen</legend><div class="row"><input class="inp" type="date" name="von" value="${esc(f.von || "")}" aria-label="von"><input class="inp" type="date" name="bis" value="${esc(f.bis || "")}" aria-label="bis"></div></fieldset>` : ""}
          <fieldset><legend>Markierungen</legend>
            ${mode === "aktuell" ? `<label class="switch"><input type="checkbox" name="neu" value="1" ${f.neu ? "checked" : ""} ${S.prevVisit ? "" : "disabled"}> Nur neu seit letztem Besuch</label>` : ""}
            ${f.art ? `<label class="switch"><input type="checkbox" name="art" value="${esc(f.art)}" checked> Artikel ${esc(ZC.fmtArticle(f.art))}</label>` : ""}
          </fieldset>
          <button type="button" class="btn" id="reset" style="width:100%">Alle Filter zurücksetzen</button>
          <button type="button" class="btn btn--primary filters__done" id="filter-done">Ergebnisse anzeigen</button>
        </form>
        <section aria-labelledby="list-h">
          <div class="toolbar">
            <h2 id="list-h">${mode === "archiv" ? "Archiv" : f.m === "all" ? "Gemerkt" : f.m ? esc(savedById(f.m)?.r.name || "Gemerkte Suche") : "Aktuelle Angebote"} <small id="list-count"></small></h2>
            ${mode === "archiv" ? `<label class="sr" for="arch-month">Monat</label><select id="arch-month" class="inp" style="width:auto">${archiveMonths().slice().reverse().map((m) => `<option value="${m}" ${S.archiveMonth === m ? "selected" : ""}>${m}</option>`).join("")}<option value="alle" ${S.archiveMonth === "alle" ? "selected" : ""}>Alle Monate (lädt mehr)</option></select>` : ""}
            <div class="toolbar__r">
              <label class="sr" for="sort">Sortierung</label>
              <select id="sort" class="inp" style="width:auto">${Object.entries(SORTS).filter(([k]) => mode === "archiv" || !["weg"].includes(k)).map(([k, [l]]) => `<option value="${k}" ${f.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
              <div class="seg" role="group" aria-label="Darstellung"><button type="button" data-layout="list" aria-pressed="${S.layout === "list"}">Liste</button><button type="button" data-layout="grid" aria-pressed="${S.layout === "grid"}">Kacheln</button></div>
              <button type="button" class="btn" id="csv" title="Gefilterte Angebote als CSV">⤓ CSV</button>
              ${mode === "aktuell" ? `<button type="button" class="btn btn--primary" id="save-search" title="Aktuelle Suche und Filter merken">☆ Merken</button>` : ""}
            </div>
          </div>
          ${mode === "aktuell" ? chipBar(f) : ""}
          ${newCount && !f.neu ? `<div class="notice"><span><b>${nf0.format(newCount)} neue Angebote</b> seit deinem letzten Besuch (${fmtDT(S.prevVisit)}).</span><button class="btn" id="show-new">Nur neue zeigen</button></div>` : ""}
          <div id="results"></div>
        </section>
      </div>`;

    const form = $("#filters");
    let current = [];
    const filterToggle = $("#filter-toggle");
    const nActive = () => F_KEYS.filter((k) => k !== "sort" && k !== "m" && S.filters[k]).length;
    const setOpen = (open) => {
      form.classList.toggle("filters--open", open);
      document.body.classList.toggle("filters-open", open);
      filterToggle.setAttribute("aria-expanded", String(open));
      filterToggle.textContent = open ? "Schließen" : `Filter${nActive() ? ` (${nActive()})` : ""}`;
      if (open) form.scrollTop = 0;
    };
    filterToggle.addEventListener("click", () => setOpen(!form.classList.contains("filters--open")));
    $("#filter-done").addEventListener("click", () => { setOpen(false); window.scrollTo({ top: 0 }); });
    document.body.classList.remove("filters-open");
    filterToggle.textContent = `Filter${nActive() ? ` (${nActive()})` : ""}`;
    const draw = () => {
      const res = applyFilters(scoped, S.filters, mode);
      current = res;
      const visible = ZC.topSorted(res, SORTS[S.filters.sort]?.[1] || SORTS.neu[1], Math.min(S.shown, res.length));
      const sumDisc = res.reduce((a, o) => a + (o.discount_eur || 0), 0);
      $("#filter-done").textContent = `${nf0.format(res.length)} Ergebnisse anzeigen`;
      if (!form.classList.contains("filters--open")) filterToggle.textContent = `Filter${nActive() ? ` (${nActive()})` : ""}`;
      $("#list-count").textContent = `${nf0.format(res.length)} von ${nf0.format(scoped.length)} · Ersparnis gesamt ${eur0(sumDisc)}`;
      const box = $("#results");
      if (!res.length) { box.innerHTML = `<div class="empty"><h3>Keine Angebote gefunden</h3><p>Filter lockern oder <button class="linkbtn" id="reset2">alle zurücksetzen</button>.</p></div>`; $("#reset2")?.addEventListener("click", reset); return; }
      box.innerHTML = (S.layout === "grid" ? `<ul class="grid">${visible.map(offerCard).join("")}</ul>` : `<ul class="offers">${visible.map(offerRow).join("")}</ul>`)
        + (res.length > S.shown ? `<div class="more"><button class="btn" id="more">${nf0.format(Math.min(240, res.length - S.shown))} weitere laden (${nf0.format(res.length - S.shown)} übrig)</button></div>` : "");
      $("#more")?.addEventListener("click", () => { S.shown += 240; draw(); });
    };
    const sync = () => {
      const fd = new FormData(form); const nf = { sort: S.filters.sort };
      for (const k of ["q", "pmin", "pmax", "von", "bis"]) { const v = (fd.get(k) || "").toString().trim(); if (v) nf[k] = v; }
      const d = Number(fd.get("dmin") || 0); if (d) nf.dmin = String(d); $("#dmin-v").textContent = `${d} %`;
      for (const k of ["s", "c", "r"]) { const v = fd.getAll(k); if (v.length) nf[k] = v.join("~"); }
      if (fd.get("neu")) nf.neu = "1"; if (fd.get("art")) nf.art = fd.get("art"); if (S.filters.m) nf.m = S.filters.m;
      S.filters = nf; S.shown = 120; writeQuery(mode, nf); draw();
    };
    const reset = () => { const keep = { sort: S.filters.sort, ...(S.filters.m ? { m: S.filters.m } : {}) }; S.filters = keep; writeQuery(mode, keep); renderList(mode, new URLSearchParams(keep).toString()); };
    form.addEventListener("input", debounce(sync, 140));
    form.addEventListener("submit", (e) => e.preventDefault());
    $("#store-find").addEventListener("input", (e) => { const q = ZC.fold(e.target.value); $$("#store-checks .check").forEach((l) => { l.hidden = q && !ZC.fold(l.textContent).includes(q); }); e.stopPropagation(); });
    $$("[data-clear]").forEach((b) => b.addEventListener("click", () => { $$(`input[name=${b.dataset.clear}]`, form).forEach((i) => (i.checked = false)); sync(); }));
    $("#reset").addEventListener("click", reset);
    $("#arch-month")?.addEventListener("change", (e) => { S.archiveMonth = e.target.value; renderList(mode, query); });
    $("#sort").addEventListener("change", (e) => { S.filters.sort = e.target.value; writeQuery(mode, S.filters); draw(); });
    $$("[data-layout]").forEach((b) => b.addEventListener("click", () => { S.layout = b.dataset.layout; lsSet(LS.layout, S.layout); $$("[data-layout]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
    $("#show-new")?.addEventListener("click", () => { $("input[name=neu]", form).checked = true; sync(); });
    $("#save-search")?.addEventListener("click", () => openRuleDialog(null, ruleFromFilters(S.filters)));
    bindSaved(view, mode);
    $("#csv").addEventListener("click", () => {
      const cmp = SORTS[S.filters.sort]?.[1] || SORTS.neu[1];
      download(`zweite-chance_${mode}_${dayKey(Date.now())}.csv`, toCSV(current.slice().sort(cmp), EXPORT_COLS));
    });
    draw();
  }

  /* ---------- Detail ---------- */
  const EV_LABEL = { new: "Erstmals gesehen", reappeared: "Wieder aufgetaucht", price_change: "Preis geändert", changed: "Angaben geändert", gone: "Nicht mehr gelistet" };
  function sparkline(ph) {
    const pts = (ph || []).filter((p) => p[1] !== null); if (pts.length < 2) return "";
    const W = 300, H = 60, t0 = +new Date(pts[0][0]), t1 = Math.max(+new Date(), t0 + 1);
    const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), sp = hi - lo || 1;
    const x = (t) => ((+new Date(t) - t0) / (t1 - t0)) * (W - 8) + 4, y = (v) => H - 6 - ((v - lo) / sp) * (H - 16);
    let d = `M${x(pts[0][0])},${y(pts[0][1])}`; for (let i = 1; i < pts.length; i++) d += `H${x(pts[i][0])}V${y(pts[i][1])}`; d += `H${W - 4}`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Preisverlauf von ${eur(vs[0])} bis ${eur(vs[vs.length - 1])}"><path d="${d}" fill="none" stroke="var(--blue)" stroke-width="2"/><text x="4" y="10" font-size="10" fill="var(--muted)">${eur(hi)}</text><text x="4" y="${H - 0}" font-size="10" fill="var(--muted)">${eur(lo)}</text></svg>`;
  }
  async function openDetail(id) {
    const all = allOffers(true); let o = all.find((x) => x.id === id);
    if (!o && !archiveFullyLoaded()) { await loadArchive(); o = allOffers(true).find((x) => x.id === id); }
    if (!o) { toast("Angebot nicht gefunden."); return; }
    const dlg = $("#detail");
    const siblings = allOffers(true).filter((x) => x.id !== o.id && o.article_number && (x.article_numbers || [x.article_number]).includes(o.article_number))
      .sort((a, b) => (a.status === b.status ? (a.price ?? 0) - (b.price ?? 0) : a.status === "active" ? -1 : 1));
    const hits = hitRules(o);
    const listed = days(o.first_seen, o.gone_at || o.last_seen);
    dlg.innerHTML = `<button class="dlg__close" aria-label="Schließen" data-close>×</button>
      <div class="dlg">
        <div class="dlg__img">${o.image ? `<img src="${esc(o.image)}?f=m" alt="${esc(o.title)}">` : `<span class="muted">kein Bild</span>`}</div>
        <div class="dlg__body">
          <div>${badges(o)}</div>
          <h2 id="detail-title">${esc(o.title)}</h2>
          <div class="muted">${esc(o.product_description)}</div>
          <div class="priceblock">
            <div><div class="price">${esc(eur(o.price))}</div><div class="was">statt ${esc(eur(o.original_price))}</div></div>
            ${o.discount_eur != null ? `<div><span class="tag" style="font-size:16px">−${esc(pct(o.discount_pct))}</span><div class="muted" style="font-size:13px;margin-top:4px">${esc(eur(o.discount_eur))} gespart</div></div>` : ""}
            <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
              <a class="btn btn--blue" href="${esc(o.link)}" target="_blank" rel="noopener">Bei IKEA ansehen / reservieren ↗</a>
            </div>
          </div>
          <dl class="kv">
            <dt>Zustand</dt><dd>${esc(o.condition || "–")}${o.condition_description ? `<br><span class="muted">${esc(o.condition_description)}</span>` : ""}</dd>
            <dt>Grund / Mangel</dt><dd>${esc(o.reason_discount || "–")}</dd>
            ${o.offer_description ? `<dt>Angebotstext</dt><dd>${esc(o.offer_description)}</dd>` : ""}
            ${o.additional_info ? `<dt>Zusatzinfo</dt><dd>${esc(o.additional_info)}</dd>` : ""}
            <dt>Markt</dt><dd>${esc(o.store)} <span class="muted mono">(ID ${esc(o.store_id)})</span> · <a href="${marktHref(o.store_id)}" data-close>Markt-Statistik</a></dd>
            <dt>Artikelnummer</dt><dd class="mono">${esc(ZC.fmtArticle(o.article_number) || "–")}${(o.article_numbers || []).length > 1 ? ` <span class="muted">(+${o.article_numbers.length - 1} weitere: ${esc(o.article_numbers.slice(1).map(ZC.fmtArticle).join(", "))})</span>` : ""}</dd>
            <dt>Angebotsnummer</dt><dd class="mono">${esc(o.offer_number || "–")}</dd>
            <dt>Tracker-ID</dt><dd class="mono">${esc(o.id)}</dd>
            <dt>Erstmals gesehen</dt><dd>${esc(fmtDT(o.first_seen))}</dd>
            <dt>Zuletzt gesehen</dt><dd>${esc(fmtDT(o.last_seen))}${o.status === "gone" ? ` · <b>nicht mehr gelistet</b>` : ""}</dd>
            <dt>Gelistet</dt><dd>${esc(dur(listed))}${o.reappear_count ? ` · ${o.reappear_count}× wieder aufgetaucht` : ""}${o.missing_runs ? ` · im letzten Abruf nicht gelistet` : ""}</dd>
            ${hits.length ? `<dt>Merkliste</dt><dd>${hits.map((r) => esc(r.name)).join(", ")}</dd>` : ""}
          </dl>
          ${(o.price_history || []).length > 1 ? `<div class="section"><h3>Preisverlauf</h3>${sparkline(o.price_history)}</div>` : ""}
          <div class="section"><h3>Verlauf</h3><ul class="timeline" id="tl"><li class="muted">lädt …</li></ul></div>
          <div class="section"><h3>Gleicher Artikel (${nf0.format(siblings.length)})</h3>
            ${siblings.length ? `<ul class="minilist">${siblings.slice(0, 12).map((x) => `<li><a href="#" data-open="${esc(x.id)}">${esc(x.store)} · ${esc(x.condition || "")}</a><span class="mono">${esc(eur(x.price))} ${x.status === "gone" ? `<span class="badge badge--gone">weg</span>` : ""}</span></li>`).join("")}</ul>` : `<p class="muted" style="font-size:13.5px">Kein weiteres Angebot dieses Artikels erfasst.</p>`}
          </div>
          <div class="section" style="display:flex;gap:8px;flex-wrap:wrap">
            ${o.article_number ? `<a class="btn btn--primary" href="${prodHref(o.article_number)}" data-close>Produkt-Statistik</a><button class="btn" data-watch-art>＋ Artikel auf die Merkliste</button><a class="btn" href="#/archiv?art=${esc(o.article_number)}" data-close>Artikel im Archiv</a>` : ""}
            <button class="btn" data-copy>Daten kopieren (JSON)</button>
          </div>
        </div>
      </div>`;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector(".dlg__body").scrollTop = 0;
    $$("[data-close]", dlg).forEach((b) => b.addEventListener("click", () => dlg.close()));
    $$("[data-open]", dlg).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openDetail(a.dataset.open); }));
    $("[data-copy]", dlg)?.addEventListener("click", () => { const clean = Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_"))); navigator.clipboard?.writeText(JSON.stringify(clean, null, 2)).then(() => toast("JSON kopiert.")); });
    $("[data-watch-art]", dlg)?.addEventListener("click", async () => {
      const r = { id: newId(), name: `${o.title} ${ZC.fmtArticle(o.article_number)}`, enabled: true, article_numbers: [ZC.fmtArticle(o.article_number)] };
      if (ZC.dedupeRules([...S.repo.watch, ...S.rules]).some((x) => ZC.ruleKey(x) === ZC.ruleKey(r))) {
        toast("Der Artikel steht bereits auf deiner Merkliste.");
      } else {
        S.rules.push(r); await persistRules();
        toast(S.server?.ok ? `„${esc(o.title)}“ steht auf der Merkliste.` : `„${esc(o.title)}“ beobachtet (nur in diesem Browser).`);
      }
      updateBadges();
    });
    // Verlauf aus dem Angebot selbst (Preisverlauf, erstes/letztes Sehen) + lokale Importe
    const ph = o.price_history || [];
    let evs = [{ ts: o.first_seen, type: "new" }];
    for (let i = 1; i < ph.length; i++) evs.push({ ts: ph[i][0], type: "price_change", old_price: ph[i - 1][1], new_price: ph[i][1] });
    const LOGTYPE = { gone: "gone", back: "reappeared", chg: "changed" };
    for (const [ts, k, fields] of o.log || []) evs.push({ ts, type: LOGTYPE[k] || k, fields, detected: true });
    if (o.gone_at && !(o.log || []).some((l) => l[1] === "gone")) evs.push({ ts: o.gone_at, type: "gone" });
    evs.push(...S.local.events.filter((e) => e.id === o.id));
    const seen = new Set(); evs = evs.filter((e) => { const k = e.ts + e.type; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.ts.localeCompare(b.ts));
    const tl = $("#tl", dlg); if (!tl) return;
    tl.innerHTML = evs.length ? evs.map((e) => `<li><b>${esc(EV_LABEL[e.type] || e.type)}</b> · ${esc(fmtDT(e.type === "gone" && !e.detected ? o.gone_at || e.ts : e.ts))}${e.type === "price_change" ? ` · ${esc(eur(Number(e.old_price)))} → ${esc(eur(Number(e.new_price)))}` : ""}${e.fields ? ` <span class="muted">(${esc(e.fields)})</span>` : ""}</li>`).join("")
      : `<li>Erstmals gesehen · ${esc(fmtDT(o.first_seen))}</li>`;
  }

  /* ---------- Merkliste ---------- */
  const splitList = (s) => String(s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  function ruleSummary(r) {
    const p = [];
    if (r.keywords?.length) p.push(`Stichwort: <b>${r.keywords.map(esc).join(" / ")}</b>`);
    if (r.article_numbers?.length) p.push(`Art.-Nr.: <span class="mono">${r.article_numbers.map(esc).join(", ")}</span>`);
    if (r.exclude?.length) p.push(`ohne: ${r.exclude.map(esc).join(", ")}`);
    if (r.stores?.length) p.push(`Märkte: ${r.stores.map((s) => esc(stores().find((x) => x.id === String(s))?.name || s)).join(", ")}`);
    if (r.min_discount_pct) p.push(`ab ${esc(r.min_discount_pct)} % Rabatt`);
    if (r.min_price) p.push(`ab ${esc(eur(Number(r.min_price)))}`);
    if (r.max_price) p.push(`bis ${esc(eur(Number(r.max_price)))}`);
    if (r.conditions?.length) p.push(`Zustand/Grund: ${r.conditions.map(esc).join(", ")}`);
    return p.join(" · ") || "<span class='muted'>ohne Einschränkung (trifft alles)</span>";
  }
  /* ---------- Gemerkte Suchen auf der Startseite ---------- */
  // Eine gemerkte Suche = Regel. Mit Telegram (notify) = Merkliste, ohne = gespeicherte Ansicht (Preset).
  const hrefWith = (f, patch) => {
    const nf = { ...f, ...patch };
    for (const k of Object.keys(nf)) if (!nf[k] || k === "sort") delete nf[k];
    const qs = new URLSearchParams(nf).toString();
    return `#/aktuell${qs ? "?" + qs : ""}`;
  };
  function chipBar(f) {
    const all = savedSearches();
    const nHits = allOffers(false).filter((o) => o.status === "active" && hitRules(o).length).length;
    const top = all.filter((x) => x.r.enabled !== false).sort(SAVED_SORT.treffer[1]).slice(0, 10);
    const chip = (href, label, on, title = "") => `<a class="chip2 ${on ? "chip2--on" : ""}" href="${href}" ${title ? `title="${esc(title)}"` : ""}>${label}</a>`;
    const toggle = (k, v) => hrefWith(f, { [k]: f[k] === v ? "" : v });
    return `<nav class="chips2" aria-label="Schnellauswahl">
      ${chip("#/aktuell", "Alle", !f.m && !f.neu && !f.dmin && !f.pmax && !f.c)}
      ${chip(hrefWith(f, { m: f.m === "all" ? "" : "all" }), `⭐ Gemerkt <small>${nf0.format(nHits)}</small>`, f.m === "all", "Treffer aller gemerkten Suchen mit Telegram")}
      ${S.prevVisit ? chip(toggle("neu", "1"), "Neu seit Besuch", !!f.neu) : ""}
      ${chip(toggle("dmin", "50"), "≥ 50 %", f.dmin === "50")}
      ${chip(toggle("pmax", "10"), "bis 10 €", f.pmax === "10")}
      ${chip(toggle("c", "Wie neu"), "Wie neu", f.c === "Wie neu")}
      ${top.map((x) => chip(hrefWith(f, { m: f.m === x.r.id ? "" : x.r.id }), `${x.r.notify === false ? "" : "🔔 "}${esc(x.r.name)} <small>${nf0.format(x.n)}</small>`, f.m === x.r.id)).join("")}
      ${all.length > top.length ? chip("#/aktuell?m=all", `alle ${all.length} gemerkten ›`, false) : ""}
    </nav>`;
  }
  const savedRow = (x, f) => `<li class="saved-row ${x.r.enabled === false ? "saved-row--off" : ""} ${f.m === x.r.id ? "saved-row--on" : ""}">
      <a href="${hrefWith(f, { m: x.r.id })}">${x.r.notify === false ? "" : "🔔 "}${esc(x.r.name)}</a>
      <small>${nf0.format(x.n)}${x.nNew ? ` · <b>${nf0.format(x.nNew)} neu</b>` : ""}</small>
      <button type="button" class="iconbtn" data-edit-saved="${esc(x.r.id)}" aria-label="${esc(x.r.name)} bearbeiten">✎</button></li>`;
  function savedCard(f) {
    if (!f.m) return "";
    const all = savedSearches();
    if (f.m === "all") {
      const sorted = all.slice().sort((SAVED_SORT[S.savedSort] || SAVED_SORT.treffer)[1]);
      return `<div class="saved-card saved-card--list">
        <div class="saved-card__h"><b>Gemerkte Suchen</b> <small class="muted">${all.length}</small>
          <select class="inp" id="saved-sort" aria-label="Gemerkte Suchen sortieren">${Object.entries(SAVED_SORT).map(([k, [l]]) => `<option value="${k}" ${S.savedSort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        ${all.length ? `<ul class="saved-list">${sorted.map((x) => savedRow(x, f)).join("")}</ul>` : `<p class="muted">Noch nichts gemerkt. Suche oder Filter einstellen, dann „☆ Merken“.</p>`}
        <button type="button" class="btn" data-new-saved style="width:100%">＋ Neue Suche merken</button>
      </div>`;
    }
    const x = savedById(f.m);
    if (!x) return `<div class="saved-card"><p>Diese gemerkte Suche gibt es nicht (mehr). <a href="#/aktuell?m=all">Alle gemerkten</a></p></div>`;
    const r = x.r;
    return `<div class="saved-card">
      <a href="${hrefWith(f, { m: "all" })}" class="linkbtn">← alle gemerkten</a>
      <h3>${esc(r.name)}</h3>
      <p class="muted" style="font-size:13px;margin:4px 0">${ruleSummary(r)}</p>
      <p style="font-size:13px;margin:4px 0">${r.notify === false ? "🔕 ohne Telegram" : "🔔 Telegram an"}${r.enabled === false ? " · <b>pausiert</b>" : ""} · ${nf0.format(x.n)} Treffer</p>
      <div class="saved-card__act">
        <button type="button" class="btn" data-edit-saved="${esc(r.id)}">✎ Bearbeiten</button>
        <button type="button" class="btn" data-notify-saved="${esc(r.id)}">${r.notify === false ? "🔔 Telegram an" : "🔕 Telegram aus"}</button>
      </div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Die Filter darunter grenzen nur die Ansicht ein; die gemerkte Suche bleibt unverändert.</p>
    </div>`;
  }
  // Neue gemerkte Suche aus der aktuellen Ansicht (Suche + Filter; ggf. auf Basis der gewählten Suche)
  function ruleFromFilters(f) {
    const nameOf = Object.fromEntries(stores().map((x) => [x.id, x.name]));
    const base = f.m && f.m !== "all" ? savedById(f.m)?.r : null;
    const sids = [...setOf(f.s)];
    const conds = [...setOf(f.c), ...setOf(f.r)].filter((x) => x !== "–");
    const where = sids.map((i) => nameOf[i] || i).slice(0, 3).join(", ");
    const r = base ? { ...base } : { keywords: [], exclude: [], article_numbers: [], conditions: [], stores: [] };
    delete r.id; delete r._repo; delete r._localIndex;
    if (f.q) r.keywords = [f.q.trim()];
    if (sids.length) r.stores = sids;
    if (conds.length) r.conditions = conds;
    if (f.art) r.article_numbers = [ZC.fmtArticle(f.art)];
    if (f.dmin) r.min_discount_pct = Number(f.dmin);
    if (f.pmin) r.min_price = Number(f.pmin);
    if (f.pmax) r.max_price = Number(f.pmax);
    r.name = ([base?.name || (f.q || "").trim() || "Meine Suche", where].filter(Boolean).join(" · ")).slice(0, 60);
    r.enabled = true; if (r.notify === undefined) r.notify = true;
    return r;
  }
  function openRuleDialog(rule, prefill) {
    let dlg = $("#rule-dlg");
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "rule-dlg"; dlg.className = "ruledlg"; document.body.appendChild(dlg);
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    }
    const r = rule || prefill || {};
    const sel = new Set((r.stores || []).map(String));
    const v = (k) => esc(r[k] ?? "");
    dlg.innerHTML = `<form id="rd" class="form">
      <h2 style="grid-column:1/-1">${rule ? "Gemerkte Suche bearbeiten" : "Suche merken"}</h2>
      <label style="grid-column:1/-1">Name<input class="inp" name="name" required maxlength="60" value="${v("name")}"></label>
      <label>Stichworte (Komma = oder)<input class="inp" name="keywords" value="${esc((r.keywords || []).join(", "))}" placeholder="hemnes kommode, malm"></label>
      <label>Ausschließen<input class="inp" name="exclude" value="${esc((r.exclude || []).join(", "))}" placeholder="tür, front"></label>
      <label>Artikelnummern<input class="inp" name="article_numbers" value="${esc((r.article_numbers || []).join(", "))}" placeholder="802.758.87"></label>
      <label>Zustand / Grund enthält<input class="inp" name="conditions" value="${esc((r.conditions || []).join(", "))}" placeholder="wie neu, Ausstellungsstück"></label>
      <label>Rabatt ab %<input class="inp" name="min_discount_pct" type="number" min="0" max="100" value="${v("min_discount_pct")}"></label>
      <label>Preis ab €<input class="inp" name="min_price" type="number" min="0" step="any" value="${v("min_price")}"></label>
      <label>Preis bis €<input class="inp" name="max_price" type="number" min="0" step="any" value="${v("max_price")}"></label>
      <fieldset style="grid-column:1/-1" class="rd-stores"><legend>Märkte (keiner gewählt = alle) · <button type="button" class="linkbtn" data-rd-none>Auswahl aufheben</button></legend>
        <input class="inp" placeholder="Markt suchen" data-rd-find aria-label="Märkte durchsuchen">
        <div class="checks rd-checks">${stores().map((s) => `<label class="check"><input type="checkbox" name="stores" value="${esc(s.id)}" ${sel.has(s.id) ? "checked" : ""}><span>${esc(s.name)}</span></label>`).join("")}</div></fieldset>
      <label class="switch" style="grid-column:1/-1"><input type="checkbox" name="notify" ${r.notify === false ? "" : "checked"}> Neue Treffer per Telegram melden (sonst nur gespeicherte Ansicht)</label>
      <label class="switch" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${r.enabled === false ? "" : "checked"}> Aktiv (sonst pausiert)</label>
      <p class="muted" id="rd-preview" style="grid-column:1/-1;margin:0"></p>
      <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--primary" type="submit">Speichern</button>
        <button class="btn" type="button" data-rd-cancel>Abbrechen</button>
        ${rule ? `<button class="btn" type="button" data-rd-del style="margin-left:auto;color:var(--rust)">Entfernen …</button>` : ""}
      </div></form>`;
    const form = $("#rd", dlg);
    const read = () => {
      const fd = new FormData(form); const num = (k) => (fd.get(k) === "" || fd.get(k) === null ? null : Number(fd.get(k)));
      const out = { ...(rule || {}), id: rule?.id || newId(), name: String(fd.get("name") || "").trim(), enabled: !!fd.get("enabled"), notify: !!fd.get("notify"),
        keywords: splitList(fd.get("keywords")), exclude: splitList(fd.get("exclude")), article_numbers: splitList(fd.get("article_numbers")),
        conditions: splitList(fd.get("conditions")), stores: fd.getAll("stores"), min_discount_pct: num("min_discount_pct"), min_price: num("min_price"), max_price: num("max_price") };
      delete out._repo; delete out._localIndex;
      return out;
    };
    const preview = () => { const f = ZC.compileRule({ ...read(), enabled: true }); $("#rd-preview", dlg).textContent = `→ aktuell ${nf0.format(allOffers(false).filter((o) => o.status === "active" && f(o)).length)} Treffer`; };
    form.addEventListener("input", debounce(preview, 200)); preview();
    $("[data-rd-find]", dlg).addEventListener("input", (e) => { const q = ZC.fold(e.target.value); $$(".rd-checks .check", dlg).forEach((l) => { l.hidden = q && !ZC.fold(l.textContent).includes(q); }); });
    $("[data-rd-none]", dlg).addEventListener("click", () => { $$("input[name=stores]", dlg).forEach((c) => (c.checked = false)); preview(); });
    $("[data-rd-cancel]", dlg).addEventListener("click", () => dlg.close());
    $("[data-rd-del]", dlg)?.addEventListener("click", async () => {
      if (!S.rules.some((y) => y.id === rule.id)) { toast("Diese Suche kommt aus der Sicherung und lässt sich nur mit verbundenem Worker entfernen."); return; }
      if (!confirmTwice(`Gemerkte Suche „${rule.name}“ entfernen?`)) return;
      S.rules = S.rules.filter((y) => y.id !== rule.id); await persistRules(true); updateBadges();
      dlg.close(); toast("Entfernt. Der frühere Stand ist unter „Daten“ wiederherstellbar."); location.hash = "#/aktuell?m=all";
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const x = read();
      if (!x.name) { toast("Bitte einen Namen eingeben."); return; }
      if (allRules().some((y) => y.id !== x.id && ZC.ruleKey(y) === ZC.ruleKey(x))) { toast("Eine gemerkte Suche mit genau diesen Kriterien gibt es schon."); return; }
      const i = S.rules.findIndex((y) => y.id === x.id);
      if (i >= 0) S.rules[i] = x; else S.rules.push(x);
      await persistRules(); updateBadges(); dlg.close();
      toast(S.server?.ok ? `„${esc(x.name)}“ gespeichert.` : `„${esc(x.name)}“ gespeichert (nur in diesem Browser – Worker nicht verbunden).`, 6000);
      const target = `#/aktuell?m=${encodeURIComponent(x.id)}`;
      if (location.hash === target) route(); else location.hash = target;
    });
    dlg.showModal();
  }
  function bindSaved(root) {
    $("#saved-sort", root)?.addEventListener("change", (e) => { e.stopPropagation(); S.savedSort = e.target.value; lsSet(LS.savedSort, S.savedSort); route(); });
    $$("[data-edit-saved]", root).forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); const x = savedById(b.dataset.editSaved); if (x) openRuleDialog(x.r); }));
    $$("[data-new-saved]", root).forEach((b) => b.addEventListener("click", () => openRuleDialog(null, ruleFromFilters({}))));
    $$("[data-notify-saved]", root).forEach((b) => b.addEventListener("click", async () => {
      const x = savedById(b.dataset.notifySaved); if (!x) return;
      const upd = { ...x.r, notify: x.r.notify === false }; delete upd._repo; delete upd._localIndex;
      const i = S.rules.findIndex((y) => y.id === upd.id); if (i >= 0) S.rules[i] = upd; else S.rules.push(upd);
      await persistRules(); updateBadges(); route();
    }));
  }
  // Frühere Stände der Merkliste (Daten-Seite)
  function bindHistory(root) {
    $("#hist", root)?.addEventListener("toggle", async (e) => {
      if (!e.target.open || S.repo.history) return;
      const box = $("#hist-list", root);
      try {
        S.repo.history = await worker.call("GET", null, { path: "/api/history" });
        box.innerHTML = S.repo.history.length ? `<ul class="minilist">${S.repo.history.map((h) => `<li><span>${esc(fmtDT(h.ts))} · ${h.count ?? "?"} Suchen</span><button class="btn" data-restore="${esc(h.id)}">Wiederherstellen</button></li>`).join("")}</ul>` : "Noch keine früheren Stände (entstehen bei jeder Änderung).";
        $$("[data-restore]", box).forEach((b) => b.addEventListener("click", async () => {
          if (!confirmTwice("Diesen früheren Stand wiederherstellen? Der aktuelle Stand bleibt als Version erhalten.")) return;
          try {
            const snap = await worker.call("GET", null, { path: `/api/history?id=${encodeURIComponent(b.dataset.restore)}` });
            S.rules = ZC.dedupeRules(snap.rules || []).map(withId); S.repo.history = null; await persistRules(true); updateBadges(); toast("Früherer Stand wiederhergestellt."); renderDaten();
          } catch (err) { toast(`<b>Nicht möglich:</b> ${esc(err.message)}`, 6000); }
        }));
      } catch (err) { box.textContent = `Nicht abrufbar: ${err.message}`; }
    });
  }

  /* ---------- Statistik ---------- */
  function bars(rows, { fmt = nf0.format, cls = "", max } = {}) {
    const m = max ?? Math.max(1, ...rows.map((r) => r.v));
    return `<div class="bars">${rows.map((r) => `<span class="l" title="${esc(r.l)}">${r.href ? `<a href="${r.href}">${esc(r.l)}</a>` : esc(r.l)}</span><span class="b"><i class="${cls}" style="width:${(r.v / m) * 100}%"></i></span><span class="v">${esc(fmt(r.v))}</span>`).join("")}</div>`;
  }
  function columns(series, labels, colors) {
    const W = 640, H = 170, pad = 22, n = labels.length; if (!n) return "<p class='muted'>Keine Daten im Zeitraum.</p>";
    const max = Math.max(1, ...series.flat()); const bw = (W - pad) / n; const sw = Math.max(1, bw / series.length - 1);
    let g = "";
    series.forEach((s, si) => s.forEach((v, i) => { const h = (v / max) * (H - 30); g += `<rect x="${pad + i * bw + si * sw}" y="${H - 18 - h}" width="${sw}" height="${h}" fill="${colors[si]}"><title>${labels[i]}: ${v}</title></rect>`; }));
    const step = Math.ceil(n / 8); let ax = "";
    labels.forEach((l, i) => { if (i % step === 0) ax += `<text x="${pad + i * bw}" y="${H - 4}" font-size="10" fill="#6B6F76">${l.slice(5).split("-").reverse().join(".")}</text>`; });
    return `<div class="cols"><svg viewBox="0 0 ${W} ${H}" role="img"><text x="0" y="10" font-size="10" fill="#6B6F76">${nf0.format(max)}</text><line x1="${pad}" x2="${W}" y1="${H - 18}" y2="${H - 18}" stroke="#16181D"/>${g}${ax}</svg></div>`;
  }
  /* --- zusätzliche Auswertungen --- */
  const fmtDays = (v) => (v == null ? "–" : v < 1 ? `${Math.max(1, Math.round(v * 24))} Std.` : `${nf2.format(Math.round(v * 10) / 10).replace(/,0+$/, "")} T`);
  // Linie (eine Reihe) mit Hover je Punkt
  function lineChart(points, { fmt = nf0.format, label = "" } = {}) {
    if (points.length < 2) return "<p class='muted'>Noch zu wenige Abrufe.</p>";
    const W = 1000, H = 190, padL = 52, padB = 20;
    const t0 = +new Date(points[0].t), t1 = +new Date(points[points.length - 1].t) || t0 + 1;
    const vs = points.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), sp = hi - lo || 1;
    const x = (t) => padL + ((+new Date(t) - t0) / (t1 - t0 || 1)) * (W - padL - 6);
    const y = (v) => 8 + (1 - (v - lo) / sp) * (H - padB - 16);
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const hits = points.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="7" fill="transparent"><title>${esc(fmtDT(p.t))}: ${esc(fmt(p.v))}${label}</title></circle>`).join("");
    return `<div class="cols"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf von ${esc(fmt(vs[0]))} bis ${esc(fmt(vs[vs.length - 1]))}">
      <text x="0" y="12" font-size="10" fill="#6B6F76">${esc(fmt(hi))}</text><text x="0" y="${H - padB}" font-size="10" fill="#6B6F76">${esc(fmt(lo))}</text>
      <line x1="${padL}" x2="${W}" y1="${H - padB + 2}" y2="${H - padB + 2}" stroke="#DFDBD1"/>
      <text x="${padL}" y="${H - 4}" font-size="10" fill="#6B6F76">${esc(fmtD(points[0].t))}</text><text x="${W - 4}" y="${H - 4}" font-size="10" fill="#6B6F76" text-anchor="end">${esc(fmtD(points[points.length - 1].t))}</text>
      <path d="${d}" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linejoin="round"/>${hits}</svg></div>`;
  }
  // Wochentag × Uhrzeit (Berlin): eine Farbe, hell -> dunkel
  const hourFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", hour: "2-digit", hourCycle: "h23" });
  const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  function heatmap(grid) {
    const max = Math.max(1, ...grid.flat()), cw = 24, ch = 18, padL = 26, padT = 14;
    const shade = (v) => (v ? 0.12 + 0.88 * (v / max) : 0);
    let g = "";
    grid.forEach((row, d) => row.forEach((v, h) => { g += `<rect x="${padL + h * cw + 1}" y="${padT + d * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${v ? "#0058A3" : "#ECE9E2"}" fill-opacity="${v ? shade(v).toFixed(2) : 1}"><title>${WD[d]} ${String(h).padStart(2, "0")}–${String(h + 1).padStart(2, "0")} Uhr: ${nf0.format(v)} neue Angebote</title></rect>`; }));
    const ax = WD.map((w, d) => `<text x="0" y="${padT + d * ch + 13}" font-size="10" fill="#6B6F76">${w}</text>`).join("") + [0, 6, 12, 18, 23].map((h) => `<text x="${padL + h * cw + 4}" y="10" font-size="10" fill="#6B6F76">${h}</text>`).join("");
    return `<div class="cols"><svg viewBox="0 0 ${padL + 24 * cw} ${padT + 7 * ch + 2}" role="img" aria-label="Neue Angebote nach Wochentag und Uhrzeit">${ax}${g}</svg></div>
      <div class="legend"><span>wenige</span><span class="ramp"></span><span>viele (max. ${nf0.format(max)})</span></div>`;
  }
  function moreStats(every, gone, nameOf, tables, csvBtn) {
    const runs = (S.repo.runs || []).filter((r) => r.ts && r.active);
    const firstRun = runs[0]?.ts || "";
    const now = Date.now(), d7 = new Date(now - 7 * 864e5).toISOString(), d14 = new Date(now - 14 * 864e5).toISOString(), d30 = new Date(now - 30 * 864e5).toISOString();
    // 1) Bestand im Verlauf
    const bestand = runs.map((r) => ({ t: r.ts, v: Number(r.active) }));
    tables.bestand = bestand.map((p) => ({ zeit: p.t, aktiv: p.v }));
    // 2) Wann kommen neue Angebote? (ohne den ersten Abruf – da war alles "neu")
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let nObs = 0;
    for (const o of every) {
      if (!o.first_seen || o.first_seen <= firstRun) continue;
      const parts = Object.fromEntries(hourFmt.formatToParts(new Date(o.first_seen)).map((p) => [p.type, p.value]));
      const d = WD.indexOf(parts.weekday.replace(".", "").slice(0, 2)); const h = Number(parts.hour);
      if (d >= 0 && h >= 0 && h < 24) { grid[d][h]++; nObs++; }
    }
    tables.wann = grid.flatMap((row, d) => row.map((v, h) => ({ wochentag: WD[d], stunde: h, neu: v })));
    // 3) Preissenkungen
    const drops = [];
    for (const o of every) {
      const ph = (o.price_history || []).filter((p) => p[1] !== null);
      for (let i = 1; i < ph.length; i++) if (ph[i][1] < ph[i - 1][1]) drops.push({ o, ts: ph[i][0], from: ph[i - 1][1], to: ph[i][1], pct: (1 - ph[i][1] / ph[i - 1][1]) * 100 });
    }
    const recentDrops = drops.filter((x) => x.ts >= d14).sort((a, b) => b.pct - a.pct);
    tables.preissenkungen = recentDrops.map((x) => ({ zeit: x.ts, produkt: x.o.title, markt: x.o.store, von: x.from, auf: x.to, minus_pct: Math.round(x.pct), id: x.o.id }));
    // 4) Wie schnell weg – nach Rabatthöhe (nur verschwundene, Median Tage)
    const dwellByDisc = Array.from({ length: 5 }, (_, i) => ({ l: ["unter 20 %", "20–39 %", "40–59 %", "60–79 %", "ab 80 %"][i], a: [] }));
    for (const o of gone) { if (o.discount_pct == null) continue; const b = o.discount_pct < 20 ? 0 : o.discount_pct < 40 ? 1 : o.discount_pct < 60 ? 2 : o.discount_pct < 80 ? 3 : 4; dwellByDisc[b].a.push(days(o.first_seen, o.gone_at)); }
    const dwellDisc = dwellByDisc.filter((x) => x.a.length >= 5).map((x) => ({ l: x.l, v: Math.round(median(x.a) * 10) / 10, n: x.a.length }));
    tables.tempo_rabatt = dwellDisc;
    // 5) Märkte im Vergleich
    const per = new Map();
    for (const o of every) {
      const k = o.store_id; if (!per.has(k)) per.set(k, { act: [], new7: 0, gone7: 0, dwell: [] });
      const x = per.get(k);
      if (o.status === "active") x.act.push(o);
      if (o.first_seen >= d7 && o.first_seen > firstRun) x.new7++;
      if (o.status === "gone" && o.gone_at >= d7) x.gone7++;
      if (o.status === "gone") x.dwell.push(days(o.first_seen, o.gone_at));
    }
    const markets = [...per.entries()].map(([id, x]) => ({ id, markt: nameOf[id] || id, aktiv: x.act.length, median_rabatt: median(x.act.map((o) => o.discount_pct)), neu_pro_tag: Math.round(x.new7 / 7 * 10) / 10, weg_pro_tag: Math.round(x.gone7 / 7 * 10) / 10, verweildauer_tage: x.dwell.length >= 5 ? Math.round(median(x.dwell) * 10) / 10 : null }))
      .sort((a, b) => b.neu_pro_tag - a.neu_pro_tag);
    tables.maerkte_vergleich = markets;
    // 6) Gemerkte Suchen: was ist ein guter Preis?
    const saved = savedSearches().map((x) => {
      const all = every.filter((o) => x.f(o)), act = all.filter((o) => o.status === "active"), gn = all.filter((o) => o.status === "gone");
      const prices = all.map((o) => o.price).filter((v) => v != null);
      return { suche: x.r.name, aktiv: act.length, guenstigster_aktiv: act.length ? Math.min(...act.map((o) => o.price ?? 1e9)) : null, median_preis: median(prices), tiefster_preis: prices.length ? Math.min(...prices) : null, weg_30_tage: gn.filter((o) => o.gone_at >= d30).length, verweildauer_tage: gn.length >= 3 ? Math.round(median(gn.map((o) => days(o.first_seen, o.gone_at))) * 10) / 10 : null };
    }).sort((a, b) => b.aktiv - a.aktiv);
    tables.gemerkt_preise = saved;
    const num = (v, f = nf0.format) => (v == null || Number.isNaN(v) ? "–" : f(v));
    const sortTbl = (id) => `data-sorttable="${id}"`;
    return `
      <h2 style="margin:36px 0 14px">Mehr Einblick</h2>
      <div class="charts">
        ${productFinder(every)}
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Bestand im Verlauf</h3><p>Aktive Angebote je Abruf · Punkt antippen/überfahren für Details</p></div>${csvBtn("bestand")}</header>${lineChart(bestand)}</section>
        <section class="chart"><header><div><h3>Wann kommen neue Angebote?</h3><p>Erstmals gesehen, nach Wochentag und Stunde (Berlin) · ${nf0.format(nObs)} Angebote seit Beobachtungsbeginn${nObs < 500 ? " · noch wenig Daten" : ""}</p></div>${csvBtn("wann")}</header>${heatmap(grid)}
          <p class="muted" style="font-size:12px;margin:6px 0 0">Genauigkeit = Abrufabstand. Bei unregelmäßigem Takt wirken einzelne Stunden voller, als sie sind.</p></section>
        <section class="chart"><header><div><h3>Wie schnell ist es weg?</h3><p>Median-Verweildauer nach Rabatthöhe, nur verschwundene Angebote</p></div>${csvBtn("tempo_rabatt")}</header>${dwellDisc.length ? bars(dwellDisc, { fmt: fmtDays, cls: "y" }) : "<p class='muted'>Noch zu wenige abgeschlossene Angebote.</p>"}</section>
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Preissenkungen der letzten 14 Tage</h3><p>${nf0.format(recentDrops.length)} Senkungen · insgesamt ${nf0.format(drops.length)} seit Beobachtungsbeginn · stärkste zuerst</p></div>${csvBtn("preissenkungen")}</header>
          ${recentDrops.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Produkt</th><th>Markt</th><th class="n">vorher</th><th class="n">jetzt</th><th class="n">−</th><th>wann</th></tr></thead><tbody>${recentDrops.slice(0, 15).map((x) => `<tr data-id="${esc(x.o.id)}" style="cursor:pointer"><td>${esc(x.o.title)} <span class="muted">${esc(x.o.product_description)}</span></td><td>${esc(x.o.store)}</td><td class="n">${esc(eur(x.from))}</td><td class="n"><b>${esc(eur(x.to))}</b></td><td class="n">${nf0.format(Math.round(x.pct))} %</td><td>${esc(rel(x.ts))}</td></tr>`).join("")}</tbody></table></div>` : "<p class='muted'>Keine Preissenkungen im Zeitraum.</p>"}</section>
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Märkte im Vergleich</h3><p>Neu und weg je Tag (letzte 7 Tage) · Markt antippen = Markt-Statistik · Spaltenkopf = sortieren</p></div>${csvBtn("maerkte_vergleich")}</header>
          <div class="tblwrap"><table class="tbl" ${sortTbl("m")}><thead><tr><th data-k="0">Markt</th><th class="n" data-k="1">aktiv</th><th class="n" data-k="2">Median-Rabatt</th><th class="n" data-k="3">neu/Tag</th><th class="n" data-k="4">weg/Tag</th><th class="n" data-k="5">Verweildauer</th></tr></thead><tbody>
          ${markets.map((m) => `<tr><td><a href="${marktHref(m.id)}">${esc(m.markt)}</a></td><td class="n" data-v="${m.aktiv}">${nf0.format(m.aktiv)}</td><td class="n" data-v="${m.median_rabatt ?? -1}">${num(m.median_rabatt, pct)}</td><td class="n" data-v="${m.neu_pro_tag}">${num(m.neu_pro_tag, nf2.format)}</td><td class="n" data-v="${m.weg_pro_tag}">${num(m.weg_pro_tag, nf2.format)}</td><td class="n" data-v="${m.verweildauer_tage ?? -1}">${num(m.verweildauer_tage, fmtDays)}</td></tr>`).join("")}</tbody></table></div></section>
        ${saved.length ? `<section class="chart" style="grid-column:1/-1"><header><div><h3>Gemerkte Suchen: Was ist ein guter Preis?</h3><p>Aktuell und über den ganzen Beobachtungszeitraum</p></div>${csvBtn("gemerkt_preise")}</header>
          <div class="tblwrap"><table class="tbl" ${sortTbl("g")}><thead><tr><th data-k="0">Suche</th><th class="n" data-k="1">aktiv</th><th class="n" data-k="2">günstigster jetzt</th><th class="n" data-k="3">Median-Preis</th><th class="n" data-k="4">Tiefstpreis</th><th class="n" data-k="5">weg in 30 T</th><th class="n" data-k="6">Verweildauer</th></tr></thead><tbody>
          ${saved.map((x) => `<tr><td>${esc(x.suche)}</td><td class="n" data-v="${x.aktiv}">${nf0.format(x.aktiv)}</td><td class="n" data-v="${x.guenstigster_aktiv ?? -1}">${num(x.guenstigster_aktiv, eur)}</td><td class="n" data-v="${x.median_preis ?? -1}">${num(x.median_preis, eur)}</td><td class="n" data-v="${x.tiefster_preis ?? -1}">${num(x.tiefster_preis, eur)}</td><td class="n" data-v="${x.weg_30_tage}">${nf0.format(x.weg_30_tage)}</td><td class="n" data-v="${x.verweildauer_tage ?? -1}">${num(x.verweildauer_tage, fmtDays)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      </div>`;
  }
  // Tabellen per Klick auf den Spaltenkopf sortieren
  function bindSortTables(root) {
    $$("[data-sorttable]", root).forEach((tbl) => $$("th[data-k]", tbl).forEach((th) => th.addEventListener("click", () => {
      const k = +th.dataset.k, desc = th.dataset.dir !== "desc"; th.dataset.dir = desc ? "desc" : "asc";
      const rows = $$("tbody tr", tbl);
      const val = (tr) => { const td = tr.children[k]; return td.dataset.v !== undefined ? Number(td.dataset.v) : td.textContent; };
      rows.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "de"); return desc ? -c : c; });
      rows.forEach((tr) => tr.parentNode.appendChild(tr));
    })));
  }
  /* ---------- Statistik je Produkt (Artikelnummer) und je Markt ---------- */
  const artsOf = (o) => (o.article_numbers && o.article_numbers.length ? o.article_numbers : [o.article_number]).filter(Boolean);
  const prodHref = (art) => `#/produkt?art=${encodeURIComponent(ZC.normArticle(art))}`;
  const marktHref = (id) => `#/markt?id=${encodeURIComponent(id)}`;
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  const back = `<p style="margin:0 0 10px"><a href="#/statistik" class="linkbtn">← Statistik</a></p>`;

  // Wie viele Angebote waren an jedem Tag gelistet? (aus erstem/letztem Sehen)
  function listedPerDay(offers, maxDays = 120) {
    if (!offers.length) return { labels: [], counts: [] };
    const start = offers.reduce((m, o) => (o.first_seen < m ? o.first_seen : m), "9999");
    const from = Math.max(+new Date(start), Date.now() - maxDays * 864e5);
    const labels = []; for (let t = from; t <= Date.now(); t += 864e5) labels.push(dayKey(new Date(t)));
    const idx = Object.fromEntries(labels.map((d, i) => [d, i])), counts = labels.map(() => 0);
    for (const o of offers) {
      const a = Math.max(+new Date(o.first_seen), from), b = +new Date(o.gone_at || o.last_seen || Date.now());
      const seen = new Set();
      for (let t = a; t <= b + 1; t += 864e5) { const k = dayKey(new Date(Math.min(t, b))); if (k in idx && !seen.has(k)) { seen.add(k); counts[idx[k]]++; } }
    }
    return { labels, counts };
  }
  // Preis über die Zeit: jeder Punkt = ein Preis eines Angebots (aktiv blau, verschwunden grau)
  function priceDots(offers) {
    const pts = [];
    for (const o of offers) {
      const ph = (o.price_history || []).filter((p) => p[1] != null);
      ph.forEach(([t, v], i) => pts.push({ t, v, o, last: i === ph.length - 1 }));
    }
    if (!pts.length) return "<p class='muted'>Keine Preise erfasst.</p>";
    const W = 1000, H = 220, padL = 60, padB = 22;
    const ts = pts.map((p) => +new Date(p.t)), t0 = Math.min(...ts), t1 = Math.max(Date.now(), t0 + 864e5);
    const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), sp = hi - lo || Math.max(1, hi * 0.1);
    const x = (t) => padL + ((+new Date(t) - t0) / (t1 - t0)) * (W - padL - 10);
    const y = (v) => 10 + (1 - (v - lo) / sp) * (H - padB - 20);
    const lines = offers.map((o) => {
      const ph = (o.price_history || []).filter((p) => p[1] != null); if (!ph.length) return "";
      let d = `M${x(ph[0][0]).toFixed(1)},${y(ph[0][1]).toFixed(1)}`;
      for (let i = 1; i < ph.length; i++) d += `H${x(ph[i][0]).toFixed(1)}V${y(ph[i][1]).toFixed(1)}`;
      d += `H${x(o.status === "active" ? new Date().toISOString() : o.gone_at || o.last_seen).toFixed(1)}`;
      return `<path d="${d}" fill="none" stroke="${o.status === "active" ? "#0058A3" : "#9EA2A9"}" stroke-width="2" stroke-opacity=".55"/>`;
    }).join("");
    const dots = pts.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="${p.o.status === "active" ? "#0058A3" : "#9EA2A9"}" stroke="var(--paper)" stroke-width="2" data-id="${esc(p.o.id)}" style="cursor:pointer"><title>${esc(p.o.store)} · ${esc(eur(p.v))} · ${esc(fmtD(p.t))}${p.o.condition ? " · " + esc(p.o.condition) : ""}</title></circle>`).join("");
    return `<div class="cols"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Preise von ${esc(eur(lo))} bis ${esc(eur(hi))}">
      <text x="0" y="16" font-size="11" fill="#6B6F76">${esc(eur(hi))}</text><text x="0" y="${H - padB - 6}" font-size="11" fill="#6B6F76">${esc(eur(lo))}</text>
      <line x1="${padL}" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="#DFDBD1"/>
      <text x="${padL}" y="${H - 4}" font-size="11" fill="#6B6F76">${esc(fmtD(new Date(t0)))}</text><text x="${W - 4}" y="${H - 4}" font-size="11" fill="#6B6F76" text-anchor="end">heute</text>
      ${lines}${dots}</svg></div>
      <div class="legend"><span><i style="background:#0058A3"></i>noch gelistet</span><span><i style="background:#9EA2A9"></i>verschwunden</span><span>Punkt antippen = Angebot öffnen</span></div>`;
  }
  const offerTable = (list, { showStore = true, showTitle = false } = {}) => {
    const cols = [...(showTitle ? ["Produkt"] : []), ...(showStore ? ["Markt"] : []), "Preis", "Rabatt", "Ersparnis", "Zustand / Grund", "seit", "Status"];
    const num = new Set(["Preis", "Rabatt", "Ersparnis"]);
    return `<div class="tblwrap"><table class="tbl" data-sorttable="o"><thead><tr>${cols.map((c, i) => `<th data-k="${i}" ${num.has(c) ? 'class="n"' : ""}>${c}</th>`).join("")}</tr></thead><tbody>
      ${list.map((o) => `<tr data-id="${esc(o.id)}" style="cursor:pointer">
        ${showTitle ? `<td><b>${esc(o.title)}</b> <span class="muted">${esc(o.product_description)}</span></td>` : ""}${showStore ? `<td>${esc(o.store)}</td>` : ""}
        <td class="n" data-v="${o.price ?? -1}"><b>${esc(eur(o.price))}</b> <span class="muted">${o.original_price ? esc(eur(o.original_price)) : ""}</span></td>
        <td class="n" data-v="${o.discount_pct ?? -1}">${o.discount_pct != null ? `−${esc(pct(o.discount_pct))}` : "–"}</td>
        <td class="n" data-v="${o.discount_eur ?? -1}">${o.discount_eur != null ? esc(eur(o.discount_eur)) : "–"}</td>
        <td>${esc([o.condition, o.reason_discount].filter(Boolean).join(" · ") || "–")}</td>
        <td data-v="${+new Date(o.first_seen)}">${esc(fmtD(o.first_seen))}</td>
        <td data-v="${o.status === "active" ? 0 : 1}">${o.status === "active" ? "gelistet" : `weg ${esc(fmtD(o.gone_at))} · ${esc(fmtDays(days(o.first_seen, o.gone_at)))}`}</td></tr>`).join("")}
      </tbody></table></div>`;
  };

  async function renderProdukt(query) {
    const p = new URLSearchParams(query || ""); const art = ZC.normArticle(p.get("art") || "");
    if (hasRepo() && !archiveFullyLoaded()) { view.innerHTML = `${back}<div class="skeleton"></div>`; await loadArchive(); }
    const all = art ? allOffers(true).filter((o) => artsOf(o).includes(art)) : [];
    if (!all.length) {
      view.innerHTML = `${back}<div class="empty"><h3>Kein Angebot mit Artikelnummer ${esc(ZC.fmtArticle(art) || "?")} erfasst</h3><p>Suche ein Produkt unten in der Statistik oder öffne ein Angebot und tippe auf „Produkt-Statistik“.</p></div>`;
      return;
    }
    const act = all.filter((o) => o.status === "active"), gone = all.filter((o) => o.status === "gone");
    const ref = all.slice().sort((a, b) => (b.last_seen || "").localeCompare(a.last_seen || ""))[0];
    const prices = all.map((o) => o.price).filter((v) => v != null);
    const histPrices = all.flatMap((o) => (o.price_history || []).map((x) => x[1])).filter((v) => v != null);
    const drops = all.reduce((n, o) => n + (o.price_history || []).filter((x, i, a) => i && x[1] < a[i - 1][1]).length, 0);
    const dwell = gone.map((o) => days(o.first_seen, o.gone_at));
    const { labels, counts } = listedPerDay(all);
    // je Markt
    const per = new Map();
    for (const o of all) { const x = per.get(o.store_id) || { name: o.store, id: o.store_id, act: 0, n: 0, prices: [], disc: [], sav: [], last: "" }; x.n++; if (o.status === "active") x.act++; if (o.price != null) x.prices.push(o.price); if (o.discount_pct != null) x.disc.push(o.discount_pct); if (o.discount_eur != null) x.sav.push(o.discount_eur); if ((o.last_seen || "") > x.last) x.last = o.last_seen; per.set(o.store_id, x); }
    const savings = all.map((o) => o.discount_eur).filter((v) => v != null);
    const stores_ = [...per.values()].sort((a, b) => b.n - a.n);
    const byWeekday = Array(7).fill(0);
    for (const o of all) { const wd = (new Date(o.first_seen).getDay() + 6) % 7; byWeekday[wd]++; }
    view.innerHTML = `${back}
      <div class="prodhead">${ref.image ? `<img src="${esc(ref.image)}?f=s" alt="" loading="lazy">` : ""}
        <div><h2>${esc(ref.title)}</h2><p class="muted" style="margin:2px 0">${esc(ref.product_description)}</p>
        <p class="mono" style="margin:0">Art. ${esc(ZC.fmtArticle(art))} · Neupreis ${esc(eur(ref.original_price))}</p>
        <p style="margin:8px 0 0;display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="#/aktuell?art=${esc(art)}">Aktuelle Angebote (${nf0.format(act.length)})</a><a class="btn" href="#/archiv?art=${esc(art)}">Im Archiv</a><button class="btn" id="prod-merken">☆ Merken</button></p></div></div>
      <div class="kpis">
        ${kpi(nf0.format(act.length), "jetzt gelistet")}
        ${kpi(nf0.format(all.length), "insgesamt im Angebot")}
        ${kpi(prices.length ? `${eur(Math.min(...histPrices))} – ${eur(Math.max(...histPrices))}` : "–", "Preisspanne (alle Preise)")}
        ${kpi(eur(median(prices)), "Median-Preis")}
        ${kpi(pct(median(all.map((o) => o.discount_pct))), "Median-Rabatt")}
        ${kpi(savings.length ? eur(savings.reduce((a, v) => a + v, 0) / savings.length) : "–", "Ersparnis Ø je Angebot")}
        ${kpi(savings.length ? eur(Math.max(...savings)) : "–", "größte Ersparnis")}
        ${kpi(dwell.length ? fmtDays(median(dwell)) : "–", `Verweildauer (Median, ${dwell.length} weg)`)}
        ${kpi(nf0.format(drops), "Preissenkungen")}
        ${kpi(nf0.format(per.size), "Märkte")}
      </div>
      <div class="charts">
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Preisverlauf</h3><p>Jede Linie ein Angebot, Stufe = Preisänderung</p></div></header>${priceDots(all)}</section>
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Wann im Angebot?</h3><p>Anzahl gleichzeitig gelisteter Angebote je Tag</p></div></header>${columns([counts], labels, ["#0058A3"])}</section>
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Wo war oder ist es im Angebot?</h3><p>je Markt: wie oft, Preise, Rabatt und Ersparnis · Markt antippen = Markt-Seite</p></div></header>
          <div class="tblwrap"><table class="tbl" data-sorttable="w"><thead><tr><th data-k="0">Markt</th><th class="n" data-k="1">jetzt</th><th class="n" data-k="2">wie oft</th><th class="n" data-k="3">ab</th><th class="n" data-k="4">Ø Rabatt</th><th class="n" data-k="5">Ø Ersparnis</th><th class="n" data-k="6">max. Ersparnis</th><th data-k="7">zuletzt</th></tr></thead><tbody>
          ${stores_.map((x) => { const avgD = x.disc.length ? x.disc.reduce((a, v) => a + v, 0) / x.disc.length : null, avgS = x.sav.length ? x.sav.reduce((a, v) => a + v, 0) / x.sav.length : null; return `<tr><td><a href="${marktHref(x.id)}">${esc(x.name)}</a></td><td class="n" data-v="${x.act}">${nf0.format(x.act)}</td><td class="n" data-v="${x.n}">${nf0.format(x.n)}×</td><td class="n" data-v="${Math.min(...x.prices, 1e9)}">${x.prices.length ? esc(eur(Math.min(...x.prices))) : "–"}</td><td class="n" data-v="${avgD ?? -1}">${esc(pct(avgD))}</td><td class="n" data-v="${avgS ?? -1}">${avgS != null ? esc(eur(avgS)) : "–"}</td><td class="n" data-v="${x.sav.length ? Math.max(...x.sav) : -1}">${x.sav.length ? esc(eur(Math.max(...x.sav))) : "–"}</td><td data-v="${+new Date(x.last || 0)}">${esc(rel(x.last))}</td></tr>`; }).join("")}</tbody></table></div></section>
        <section class="chart"><header><div><h3>Neu eingestellt nach Wochentag</h3><p>Erstmals gesehen</p></div></header>${bars(WD.map((l, i) => ({ l, v: byWeekday[i] })), { cls: "bl" })}</section>
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Alle Angebote dieses Produkts</h3><p>jedes einzelne Angebot mit Preis, Rabatt und Ersparnis · Zeile antippen = Details · Spaltenkopf = sortieren</p></div></header>${offerTable(all.slice().sort((a, b) => (b.first_seen || "").localeCompare(a.first_seen || "")))}</section>
      </div>`;
    bindSortTables(view);
    $("#prod-merken").addEventListener("click", () => openRuleDialog(null, { name: `${ref.title} ${ZC.fmtArticle(art)}`, enabled: true, notify: true, article_numbers: [ZC.fmtArticle(art)], keywords: [], stores: [] }));
  }

  /* ---------- Katalog: alle IKEA-Artikel Deutschland (eigene Daten unter k/) ---------- */
  const K_IMG = "https://www.ikea.com/de/de/images/products/", K_P = "https://www.ikea.com/de/de/p/";
  async function getK(name, version) {
    const r = await fetch(`k/${name}${version ? "?v=" + encodeURIComponent(version) : ""}`, { cache: version ? "force-cache" : "no-cache" });
    if (!r.ok) throw new Error(`${r.status} k/${name}`);
    try { return await ZC.openBlob(await r.arrayBuffer(), AUTH.key); } catch (e) { throw new AuthError("Passwort stimmt nicht"); }
  }
  // Gegenstück zu katalog/model.py: pack/unpack
  function unpackK(d) {
    if (!d) return [];
    const T = d.s, ix = Object.fromEntries(d.f.map((f, i) => [f, i])), STR = ["id", "no", "type", "name", "kind", "measure", "slug", "img", "cat", "vfrom", "vto", "tag", "first_seen", "last_seen", "status", "ph", "log"], out = [];
    for (const row of d.r) {
      const o = {};
      for (const f of STR) o[f] = T[row[ix[f]]];
      for (const f of ["price", "prev", "last", "online", "missing"]) o[f] = row[ix[f]];
      o.ph = o.ph ? JSON.parse(o.ph) : [[o.first_seen, o.price]];
      o.log = o.log ? JSON.parse(o.log) : [];
      const vs = o.ph.map((p) => p[1]).filter((v) => v != null);
      o.lo = Math.min(...vs); o.hi = Math.max(...vs);
      const n = o.ph.length;
      o.chg = n > 1 ? { date: o.ph[n - 1][0], from: o.ph[n - 2][1], to: o.ph[n - 1][1] } : null;
      o.chgPct = o.chg && o.chg.from ? (o.chg.to / o.chg.from - 1) * 100 : 0;
      out.push(o);
    }
    return out;
  }
  async function loadKatalog() {
    if (S.kat) return S.kat;
    try { const meta = await getK("meta.bin"); S.kat = { meta, items: unpackK(await getK("items.bin", meta.items_version)) }; }
    catch (e) { if (e instanceof AuthError) throw e; S.kat = { meta: null, items: [] }; }
    S.kat.byId = new Map(S.kat.items.map((o) => [o.id, o]));
    S.kat.first = S.kat.items.reduce((m, o) => (o.first_seen < m ? o.first_seen : m), "9999");
    return S.kat;
  }
  const fundCount = () => {                                   // Artikelnummer -> aktive Fundgrube-Angebote
    if (S.fundMap && S.fundMap.n === S.repo.current.length) return S.fundMap.m;
    const m = new Map(); for (const o of S.repo.current) for (const a of artsOf(o)) m.set(a, (m.get(a) || 0) + 1);
    S.fundMap = { n: S.repo.current.length, m }; return m;
  };
  const kUrl = (o) => `${K_P}${o.slug}/`;
  const kImg = (o, f = "xs") => (o.img ? `<img class="offer__img" src="${K_IMG}${esc(o.img)}?f=${f}" alt="" loading="lazy" decoding="async">` : `<div class="offer__img offer__img--none">▢</div>`);
  const daysAgoIso = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const K_FILTERS = {
    alle: ["Alle", () => true],
    senkung: ["Preis gesenkt (7 T)", (o, c) => o.chg && o.chg.date >= c.d7 && o.chg.to < o.chg.from],
    erhoehung: ["Preis erhöht (7 T)", (o, c) => o.chg && o.chg.date >= c.d7 && o.chg.to > o.chg.from],
    last: ["Letzte Chance", (o) => o.last === 1 && o.status === "active"],
    neu: ["Neu im Sortiment (7 T)", (o, c) => o.first_seen >= c.d7 && o.first_seen > c.first],
    weg: ["Nicht mehr im Sortiment", (o) => o.status === "gone"],
    fund: ["Auch in der Fundgrube", (o, c) => c.fund.has(o.no)],
  };
  const K_SORT = {
    chg: ["Letzte Preisänderung", (a, b) => (b.chg?.date || "").localeCompare(a.chg?.date || "")],
    senk: ["Größte Senkung (%)", (a, b) => a.chgPct - b.chgPct],
    teuer: ["Preis absteigend", (a, b) => b.price - a.price],
    guenstig: ["Preis aufsteigend", (a, b) => a.price - b.price],
    neu: ["Neueste Artikel", (a, b) => (b.first_seen || "").localeCompare(a.first_seen || "")],
    name: ["Name A–Z", (a, b) => a.name.localeCompare(b.name, "de")],
  };
  function kCard(o, fund) {
    const down = o.chg && o.chg.to < o.chg.from, up = o.chg && o.chg.to > o.chg.from, recent = o.chg && o.chg.date >= daysAgoIso(7);
    return `<li class="card pcard"><a class="pcard__a" href="#/artikel?id=${esc(o.id)}">
      ${kImg(o)}
      <div class="offer__t" style="font-size:14.5px">${esc(o.name)} ${o.status === "gone" ? `<span class="badge badge--gone">weg</span>` : ""}${o.last && o.status === "active" ? ` <span class="badge badge--new" style="background:var(--rust)">letzte Chance</span>` : ""}</div>
      <div class="offer__d" style="white-space:normal;font-size:13px">${esc([o.kind, o.measure].filter(Boolean).join(", "))}</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px;margin-top:auto"><div><div class="price">${esc(eur(o.price))}</div>${o.prev ? `<div class="was">${esc(eur(o.prev))}</div>` : ""}</div>
        ${recent && (down || up) ? `<span class="tag" style="${down ? "" : "background:#F3D5CE"}">${down ? "▼" : "▲"} ${nf0.format(Math.abs(Math.round(o.chgPct)))} %</span>` : ""}</div>
      <div class="muted" style="font-size:12.5px">${o.chg ? `Preis seit ${esc(fmtD(o.chg.date))}` : `seit ${esc(fmtD(o.first_seen))} gelistet`}${fund ? ` · <b>${nf0.format(fund)}× Fundgrube</b>` : ""}</div></a></li>`;
  }
  async function renderKatalog(query) {
    view.innerHTML = `<div class="toolbar"><h2>Katalog</h2></div><div class="skeleton"></div>`;
    const kat = await loadKatalog();
    if (!kat.meta) { view.innerHTML = `<div class="empty"><h3>Noch keine Katalogdaten</h3><p>Der erste Katalog-Lauf steht noch aus (Actions → Katalog).</p></div>`; return; }
    const p = new URLSearchParams(query || ""); const q = p.get("q") || "", fk = K_FILTERS[p.get("f")] ? p.get("f") : "alle", sk = K_SORT[p.get("sort")] ? p.get("sort") : "chg";
    const ctx = { d7: daysAgoIso(7), first: kat.first, fund: fundCount() };
    const terms = ZC.fold(q).split(/\s+/).filter(Boolean);
    const cnt = Object.fromEntries(Object.entries(K_FILTERS).map(([k, [, f]]) => [k, kat.items.filter((o) => f(o, ctx)).length]));
    const base = kat.items.filter((o) => K_FILTERS[fk][1](o, ctx) && (!terms.length || terms.every((t) => (o._h || (o._h = ZC.fold(`${o.name} ${o.kind} ${o.measure} ${o.no} ${ZC.fmtArticle(o.no)} ${o.cat}`))).includes(t))));
    base.sort(K_SORT[sk][1]);
    let shown = 120;
    const act = kat.items.filter((o) => o.status === "active").length, m = kat.meta;
    view.innerHTML = `<div class="toolbar"><h2>Katalog <small>${nf0.format(act)} Artikel im Sortiment · Stand ${esc(rel(m.updated))}</small></h2>
        <div class="toolbar__r"><input class="inp" id="k-q" type="search" placeholder="Name, Artikelnr., Kategorie …" value="${esc(q)}" style="width:min(320px,60vw)">
        <select class="inp" id="k-sort" style="width:auto">${Object.entries(K_SORT).map(([k, [l]]) => `<option value="${k}" ${k === sk ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <nav class="chips2">${Object.entries(K_FILTERS).map(([k, [l]]) => `<a class="chip2 ${k === fk ? "chip2--on" : ""}" href="#/katalog?${new URLSearchParams({ ...(q ? { q } : {}), f: k, sort: sk })}">${l} <small>${nf0.format(cnt[k])}</small></a>`).join("")}</nav>
      <p class="muted" id="k-count" style="margin:0 0 10px"></p><ul class="grid" id="k-list"></ul><div class="more" id="k-more"></div>`;
    const draw = () => {
      $("#k-count").textContent = `${nf0.format(base.length)} Treffer`;
      $("#k-list").innerHTML = base.slice(0, shown).map((o) => kCard(o, ctx.fund.get(o.no) || 0)).join("") || `<li class="muted">Nichts gefunden.</li>`;
      $("#k-more").innerHTML = base.length > shown ? `<button class="btn">${nf0.format(Math.min(120, base.length - shown))} weitere (${nf0.format(base.length - shown)} übrig)</button>` : "";
      $("#k-more button")?.addEventListener("click", () => { shown += 120; draw(); });
    };
    const go = () => { location.hash = `#/katalog?${new URLSearchParams({ ...($("#k-q").value.trim() ? { q: $("#k-q").value.trim() } : {}), f: fk, sort: $("#k-sort").value })}`; };
    $("#k-q").addEventListener("change", go); $("#k-sort").addEventListener("change", go);
    draw();
  }
  async function renderArtikel(query) {
    const id = new URLSearchParams(query || "").get("id") || "";
    const backK = `<p style="margin:0 0 10px"><a href="#/katalog" class="linkbtn">← Katalog</a></p>`;
    view.innerHTML = `${backK}<div class="skeleton"></div>`;
    const kat = await loadKatalog(); const o = kat.byId?.get(id);
    if (!o) { view.innerHTML = `${backK}<div class="empty"><h3>Artikel nicht gefunden</h3></div>`; return; }
    if (hasRepo() && !archiveFullyLoaded()) await loadArchive();
    const fund = allOffers(true).filter((x) => artsOf(x).includes(o.no)).sort((a, b) => (b.first_seen || "").localeCompare(a.first_seen || ""));
    const fundAct = fund.filter((x) => x.status === "active");
    const today = new Date().toISOString().slice(0, 10), pts = [];
    o.ph.forEach(([t, v], i) => { if (i) pts.push({ t: o.ph[i][0], v: o.ph[i - 1][1] }); pts.push({ t, v }); });
    pts.push({ t: o.status === "gone" ? o.last_seen : today, v: o.ph[o.ph.length - 1][1] });
    const LOG = { gone: "Aus dem Sortiment genommen", back: "Wieder im Sortiment", last: "Als „Letzte Chance“ markiert" };
    view.innerHTML = `${backK}
      <div class="prodhead">${o.img ? `<img src="${K_IMG}${esc(o.img)}?f=s" alt="" loading="lazy">` : ""}
        <div><h2>${esc(o.name)}</h2><p class="muted" style="margin:2px 0">${esc([o.kind, o.measure].filter(Boolean).join(", "))}</p>
        <p class="mono" style="margin:0">Art. ${esc(ZC.fmtArticle(o.no))}${o.type === "SPR" ? " · Set/Kombination" : ""} · ${esc(o.cat)}</p>
        <p style="margin:8px 0 0;display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn--blue" href="${esc(kUrl(o))}" target="_blank" rel="noopener">Bei IKEA ansehen ↗</a>
          ${fund.length ? `<a class="btn" href="${prodHref(o.no)}">Fundgrube-Statistik</a>` : ""}</p></div></div>
      <div class="kpis">
        ${kpi(eur(o.price), o.prev ? `jetzt (vorher ${eur(o.prev)})` : "aktueller Preis")}
        ${kpi(eur(o.lo), "niedrigster Preis")}${kpi(eur(o.hi), "höchster Preis")}
        ${kpi(nf0.format(o.ph.length - 1), "Preisänderungen")}
        ${kpi(fmtD(o.first_seen), "erfasst seit")}
        ${kpi(o.status === "gone" ? "ausgelistet" : o.last ? "Letzte Chance" : "im Sortiment", o.tag ? `Hinweis: ${o.tag.toLowerCase().replace(/_/g, " ")}` : "Status")}
        ${kpi(nf0.format(fundAct.length), `in der Fundgrube (${nf0.format(fund.length)} insgesamt)`)}
      </div>
      <div class="charts">
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Preisverlauf</h3><p>Jede Änderung seit ${esc(fmtD(o.first_seen))}${o.vto ? ` · aktueller Preis gültig bis ${esc(fmtD(o.vto))}` : ""}</p></div></header>${o.ph.length > 1 ? lineChart(pts, { fmt: eur }) : `<p class="muted">Seit der Erfassung (${esc(fmtD(o.first_seen))}) hat sich der Preis nicht geändert.</p>`}</section>
        <section class="chart"><header><div><h3>Verlauf</h3></div></header><ul class="timeline">
          ${[...o.ph.slice(1).map(([t, v], i) => ({ t, text: `Preis ${v < o.ph[i][1] ? "gesenkt" : "erhöht"}: ${eur(o.ph[i][1])} → ${eur(v)}` })), ...o.log.map(([t, k]) => ({ t, text: LOG[k] || k })), { t: o.first_seen, text: "Erstmals erfasst" }].sort((a, b) => b.t.localeCompare(a.t)).map((e) => `<li><b>${esc(fmtD(e.t))}</b> · ${esc(e.text)}</li>`).join("")}</ul></section>
        ${fund.length ? `<section class="chart"><header><div><h3>In der Fundgrube</h3><p>${nf0.format(fundAct.length)} jetzt · Zeile antippen = Details</p></div></header>${offerTable(fund.slice(0, 30))}</section>` : ""}
      </div>`;
    bindSortTables(view);
  }
  async function fillKatalogDiag() {
    const box = $("#diag-katalog"); if (!box) return;
    const kat = await loadKatalog().catch(() => null);
    if (!kat?.meta) { box.innerHTML += `<p class="muted">Noch keine Katalogdaten. Erster Lauf: Actions → Katalog.</p>`; return; }
    const m = kat.meta, r = m.last_run, g = m.gaps;
    box.innerHTML += `<table class="tbl"><tbody>
      <tr><td>Letzter Lauf</td><td>${esc(fmtDT(m.updated))} (${esc(rel(m.updated))}) · ${esc(r.categories)} Kategorien${r.failed ? ` · <b>${r.failed} fehlgeschlagen</b>` : ""}${r.complete ? "" : " · unvollständig"}</td></tr>
      <tr><td>Artikel</td><td>${nf0.format(r.active)} im Sortiment · ${nf0.format(r.total)} erfasst</td></tr>
      <tr><td>Letzter Lauf</td><td>${nf0.format(r.new)} neu · ${nf0.format(r.price_change)} Preisänderungen · ${nf0.format(r.gone)} ausgelistet · ${nf0.format(r.last_chance)} neue „Letzte Chance“</td></tr>
      ${g ? `<tr><td>Lücken (${esc(fmtD(g.day))})</td><td>${nf0.format(g.only_sitemap)} nur in der Sitemap · ${nf0.format(g.only_list)} nur in den Listen · Sitemap gesamt ${nf0.format(g.sitemap)}</td></tr>` : ""}</tbody></table>`;
  }

  /* ---------- Märkte: Übersicht und Unterseite je Markt ---------- */
  // Angebote nach Produkt bündeln (Artikelnummer; ohne Nummer nach Name+Beschreibung)
  function groupProducts(offers) {
    const m = new Map();
    for (const o of offers) {
      const a = artsOf(o)[0] || "";
      const k = a || `t:${o.title}|${o.product_description}`;
      let g = m.get(k);
      if (!g) m.set(k, (g = { key: k, art: a, title: o.title, product_description: o.product_description, image: o.image, orig: o.original_price, offers: [], act: 0, n: 0, min: null, maxPct: null, maxEur: null, newest: "", saved: 0 }));
      g.offers.push(o); g.n++;
      if (!g.image && o.image) g.image = o.image;
      if ((o.first_seen || "") > g.newest) g.newest = o.first_seen;
      if (o.status === "active") {
        g.act++;
        if (o.price != null) g.min = g.min == null ? o.price : Math.min(g.min, o.price);
        if (o.discount_pct != null) g.maxPct = Math.max(g.maxPct ?? -1, o.discount_pct);
        if (o.discount_eur != null) { g.maxEur = Math.max(g.maxEur ?? -1, o.discount_eur); g.saved += o.discount_eur; }
      }
    }
    return [...m.values()];
  }
  const PSORT = {
    anzahl: ["Meiste Angebote", (a, b) => b.act - a.act || b.n - a.n],
    rabatt: ["Höchster Rabatt (%)", (a, b) => (b.maxPct ?? -1) - (a.maxPct ?? -1)],
    ersparnis: ["Größte Ersparnis (€)", (a, b) => (b.maxEur ?? -1) - (a.maxEur ?? -1)],
    neu: ["Neueste zuerst", (a, b) => (b.newest || "").localeCompare(a.newest || "")],
    preis: ["Günstigste zuerst", (a, b) => (a.min ?? 1e9) - (b.min ?? 1e9)],
    name: ["Name A–Z", (a, b) => (a.title || "").localeCompare(b.title || "", "de")],
  };
  function productCard(g, storeId) {
    const href = g.art ? prodHref(g.art) : `#/aktuell?q=${encodeURIComponent(g.title)}${storeId ? `&s=${encodeURIComponent(storeId)}` : ""}`;
    const isNewP = S.prevVisit && g.newest > S.prevVisit;
    return `<li class="card pcard"><a href="${href}" class="pcard__a">
      ${img(g)}
      <div class="offer__t" style="font-size:14.5px">${esc(g.title)} ${isNewP ? `<span class="badge badge--new">neu</span>` : ""}</div>
      <div class="offer__d" style="white-space:normal;font-size:13px">${esc(g.product_description)}</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px;margin-top:auto">
        <div>${g.act ? `<div class="price">${g.act > 1 ? "ab " : ""}${esc(eur(g.min))}</div>` : `<div class="muted" style="font-size:13px">derzeit nicht gelistet</div>`}${g.orig ? `<div class="was">${esc(eur(g.orig))}</div>` : ""}</div>
        ${g.maxPct != null ? `<span class="tag">−${esc(pct(g.maxPct))}</span>` : ""}
      </div>
      <div class="muted" style="font-size:12.5px">${g.act ? `${nf0.format(g.act)}× jetzt` : ""}${g.n > g.act ? `${g.act ? " · " : ""}${nf0.format(g.n)}× insgesamt` : ""}${g.maxEur ? ` · spart bis ${esc(eur0(g.maxEur))}` : ""}</div>
    </a></li>`;
  }
  // Gemeinsame Produkt-Galerie mit Suche, Sortierung und "mehr"
  function productGallery(id, offers, storeId) {
    return `<section class="chart" style="grid-column:1/-1" id="${id}"><header><div><h3>Produkte <small class="muted" data-pg-count></small></h3><p>Antippen = Produkt mit Preisverlauf, Ersparnis und allen Märkten</p></div></header>
      <div class="pg-ctl"><input class="inp" data-pg-q placeholder="Produkt suchen" aria-label="Produkte durchsuchen">
        <select class="inp" data-pg-sort aria-label="Sortierung">${Object.entries(PSORT).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <label class="switch"><input type="checkbox" data-pg-gone> auch verschwundene</label></div>
      <ul class="grid" data-pg-list></ul><div class="more" data-pg-more></div></section>`;
  }
  function bindGallery(id, offers, storeId) {
    const box = $(`#${id}`); if (!box) return;
    const groups = groupProducts(offers);
    let shown = 60;
    const draw = () => {
      const q = ZC.fold($("[data-pg-q]", box).value).trim(), withGone = $("[data-pg-gone]", box).checked;
      const cmp = PSORT[$("[data-pg-sort]", box).value][1];
      const list = groups.filter((g) => (withGone || g.act) && (!q || ZC.fold(`${g.title} ${g.product_description} ${g.art} ${ZC.fmtArticle(g.art)}`).includes(q))).sort(cmp);
      $("[data-pg-count]", box).textContent = `${nf0.format(list.length)}`;
      $("[data-pg-list]", box).innerHTML = list.slice(0, shown).map((g) => productCard(g, storeId)).join("") || `<li class="muted">Nichts gefunden.</li>`;
      $("[data-pg-more]", box).innerHTML = list.length > shown ? `<button class="btn">${nf0.format(Math.min(60, list.length - shown))} weitere (${nf0.format(list.length - shown)} übrig)</button>` : "";
      $("[data-pg-more] button", box)?.addEventListener("click", () => { shown += 60; draw(); });
    };
    $("[data-pg-q]", box).addEventListener("input", debounce(() => { shown = 60; draw(); }, 150));
    $("[data-pg-sort]", box).addEventListener("change", () => { shown = 60; draw(); });
    $("[data-pg-gone]", box).addEventListener("change", () => { shown = 60; draw(); });
    draw();
  }

  async function renderMaerkte() {
    const act = allOffers(false).filter((o) => o.status === "active");
    const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const per = new Map();
    for (const o of act) { const x = per.get(o.store_id) || { n: 0, disc: [], new7: 0, top: null, saved: 0 }; x.n++; if (o.discount_pct != null) x.disc.push(o.discount_pct); if (o.first_seen >= d7) x.new7++; x.saved += o.discount_eur || 0; if (!x.top || (o.discount_pct ?? -1) > (x.top.discount_pct ?? -1)) x.top = o; per.set(o.store_id, x); }
    const list = stores().map((s) => ({ s, x: per.get(s.id) || { n: 0, disc: [], new7: 0, top: null, saved: 0 } }));
    const MSORT = { name: ["Name A–Z", (a, b) => a.s.name.localeCompare(b.s.name, "de")], n: ["Meiste Angebote", (a, b) => b.x.n - a.x.n], neu: ["Meiste neue (7 T)", (a, b) => b.x.new7 - a.x.new7], rabatt: ["Höchster Median-Rabatt", (a, b) => (median(b.x.disc) ?? -1) - (median(a.x.disc) ?? -1)] };
    const sortKey = lsGet("zc.msort", "name");
    view.innerHTML = `<div class="toolbar"><h2>Märkte <small>${list.length}</small></h2>
        <div class="toolbar__r"><input class="inp" id="m-find" placeholder="Markt suchen" style="width:auto">
        <select class="inp" id="m-sort" style="width:auto">${Object.entries(MSORT).map(([k, [l]]) => `<option value="${k}" ${k === sortKey ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <ul class="mgrid">${list.sort(MSORT[sortKey]?.[1] || MSORT.name[1]).map(({ s, x }) => `<li><a class="mcard" href="${marktHref(s.id)}">
        ${x.top ? img(x.top, "mcard__img") : `<div class="mcard__img offer__img--none">▢</div>`}
        <div class="mcard__b"><b>${esc(s.name)}</b>
          <span>${nf0.format(x.n)} Angebote · Median ${esc(pct(median(x.disc)))}</span>
          <span class="muted">${nf0.format(x.new7)} neu in 7 Tagen${x.top?.discount_pct != null ? ` · bis −${esc(pct(x.top.discount_pct))}` : ""}</span></div></a></li>`).join("")}</ul>`;
    $("#m-sort").addEventListener("change", (e) => { lsSet("zc.msort", e.target.value); renderMaerkte(); });
    $("#m-find").addEventListener("input", (e) => { const q = ZC.fold(e.target.value); $$(".mgrid li").forEach((li) => { li.hidden = q && !ZC.fold(li.textContent).includes(q); }); });
  }

  async function renderMarkt(query) {
    const p = new URLSearchParams(query || ""); const id = p.get("id") || "";
    const backM = `<p style="margin:0 0 10px"><a href="#/maerkte" class="linkbtn">← alle Märkte</a></p>`;
    if (hasRepo() && !archiveFullyLoaded()) { view.innerHTML = `${backM}<div class="skeleton"></div>`; await loadArchive(); }
    if (hasRepo() && !S.repo.runs) S.repo.runs = await getBin("runs.bin", S.repo.meta.updated).catch(() => []);
    const st = stores().find((s) => s.id === id);
    const all = allOffers(true).filter((o) => o.store_id === id);
    if (!st && !all.length) { view.innerHTML = `${backM}<div class="empty"><h3>Markt nicht gefunden</h3></div>`; return; }
    const name = st?.name || all[0].store;
    const act = all.filter((o) => o.status === "active"), gone = all.filter((o) => o.status === "gone");
    const d7 = new Date(Date.now() - 7 * 864e5).toISOString(), firstRun = (S.repo.runs || [])[0]?.ts || "";
    const new7 = all.filter((o) => o.first_seen >= d7 && o.first_seen > firstRun).length, gone7 = gone.filter((o) => o.gone_at >= d7).length;
    const topPct = act.filter((o) => o.discount_pct != null).sort((a, b) => b.discount_pct - a.discount_pct).slice(0, 12);
    const buckets = Array.from({ length: 10 }, (_, i) => ({ l: `${i * 10}–${i * 10 + 9} %`, v: 0 })); act.forEach((o) => { if (o.discount_pct != null) buckets[Math.min(9, Math.max(0, Math.floor(o.discount_pct / 10)))].v++; });
    const reasons = [...act.reduce((m, o) => m.set(o.reason_discount || "–", (m.get(o.reason_discount || "–") || 0) + 1), new Map())].map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v).slice(0, 10);
    const conds = [...act.reduce((m, o) => m.set(o.condition || "–", (m.get(o.condition || "–") || 0) + 1), new Map())].map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v);
    const { labels, counts } = listedPerDay(all, 60);
    view.innerHTML = `${backM}
      <div class="toolbar"><h2>${esc(name)}</h2><div class="toolbar__r"><a class="btn" href="#/aktuell?s=${esc(id)}">Als Liste mit Filtern</a><a class="btn" href="#/archiv?s=${esc(id)}">Archiv dieses Markts</a></div></div>
      <div class="kpis">
        ${kpi(nf0.format(act.length), "aktive Angebote")}
        ${kpi(nf0.format(groupProducts(act).length), "verschiedene Produkte")}
        ${kpi(pct(median(act.map((o) => o.discount_pct))), "Median-Rabatt")}
        ${kpi(eur0(act.reduce((a, o) => a + (o.discount_eur || 0), 0)), "Ersparnis gesamt (aktiv)")}
        ${kpi(nf2.format(new7 / 7), "neu pro Tag (7 T)")}
        ${kpi(nf2.format(gone7 / 7), "weg pro Tag (7 T)")}
        ${kpi(gone.length >= 3 ? fmtDays(median(gone.map((o) => days(o.first_seen, o.gone_at)))) : "–", "Verweildauer (Median)")}
        ${kpi(nf0.format(all.length), "insgesamt erfasst")}
      </div>
      <div class="charts">
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Größte Rabatte jetzt</h3><p>Antippen = Angebot mit allen Details</p></div><a class="linkbtn" href="#/aktuell?s=${esc(id)}&sort=rabattpct">alle ›</a></header>${topPct.length ? `<ul class="grid">${topPct.map(offerCard).join("")}</ul>` : "<p class='muted'>Keine aktiven Angebote.</p>"}</section>
        ${productGallery("pg-markt", all, id)}
        <section class="chart"><header><div><h3>Rabatthöhe</h3><p>aktive Angebote</p></div></header>${bars(buckets, { cls: "y" })}</section>
        <section class="chart"><header><div><h3>Zustand</h3></div></header>${bars(conds, { cls: "bl" })}</section>
        <section class="chart"><header><div><h3>Häufigste Rabattgründe</h3></div></header>${bars(reasons)}</section>
        <section class="chart"><header><div><h3>Bestand je Tag</h3><p>gleichzeitig gelistete Angebote, letzte 60 Tage</p></div></header>${columns([counts], labels, ["#0058A3"])}</section>
      </div>`;
    bindGallery("pg-markt", all, id);
    bindSortTables(view);
  }

  // Produktsuche für die Statistik-Seite
  function productFinder(every) {
    const m = new Map();
    for (const o of every) { const a = artsOf(o)[0]; if (!a) continue; const x = m.get(a) || { art: a, title: o.title, desc: o.product_description, n: 0, act: 0 }; x.n++; if (o.status === "active") x.act++; m.set(a, x); }
    const list = [...m.values()].sort((a, b) => b.n - a.n);
    S.productIndex = list;
    const rows = (xs) => xs.slice(0, 20).map((x) => `<tr><td><a href="${prodHref(x.art)}"><b>${esc(x.title)}</b></a> <span class="muted">${esc(x.desc)}</span></td><td class="mono">${esc(ZC.fmtArticle(x.art))}</td><td class="n">${nf0.format(x.act)}</td><td class="n">${nf0.format(x.n)}</td></tr>`).join("");
    return `<section class="chart" style="grid-column:1/-1"><header><div><h3>Produkte</h3><p>Name oder Artikelnummer suchen · antippen = Preisverlauf, Spanne, wann und wo</p></div></header>
      <input class="inp" id="prod-find" placeholder="z. B. Knivshult oder 505.032.73" style="max-width:420px;margin-bottom:8px">
      <div class="tblwrap"><table class="tbl"><thead><tr><th>Produkt</th><th>Art.-Nr.</th><th class="n">jetzt</th><th class="n">insgesamt</th></tr></thead><tbody id="prod-rows">${rows(list)}</tbody></table></div></section>`;
  }
  function bindProductFinder() {
    const inp = $("#prod-find"); if (!inp) return;
    const rows = (xs) => xs.slice(0, 20).map((x) => `<tr><td><a href="${prodHref(x.art)}"><b>${esc(x.title)}</b></a> <span class="muted">${esc(x.desc)}</span></td><td class="mono">${esc(ZC.fmtArticle(x.art))}</td><td class="n">${nf0.format(x.act)}</td><td class="n">${nf0.format(x.n)}</td></tr>`).join("");
    inp.addEventListener("input", debounce(() => {
      const q = ZC.fold(inp.value).trim(), digits = ZC.normArticle(inp.value);
      const xs = !q ? S.productIndex : S.productIndex.filter((x) => (digits.length >= 3 && x.art.includes(digits)) || ZC.fold(`${x.title} ${x.desc}`).includes(q));
      $("#prod-rows").innerHTML = rows(xs) || `<tr><td colspan="4" class="muted">Nichts gefunden.</td></tr>`;
    }, 150));
  }

  async function renderStatistik(query) {
    if (activeSource() === "none") return renderOnboarding();
    const p = new URLSearchParams(query || ""); const scope = p.get("scope") || "aktiv"; const tage = Number(p.get("tage") || 30);
    if (hasRepo() && !archiveFullyLoaded()) { view.innerHTML = `<div class="toolbar"><h2>Statistik</h2></div><div class="skeleton"></div>`; await loadArchive(); }
    if (hasRepo() && !S.repo.runs) S.repo.runs = await getBin("runs.bin", S.repo.meta.updated).catch(() => []);
    const every = allOffers(true);
    const set = scope === "aktiv" ? every.filter((o) => o.status === "active") : every;
    const gone = every.filter((o) => o.status === "gone");
    const now = Date.now(), since = new Date(now - tage * 864e5).toISOString();
    const nameOf = Object.fromEntries(stores().map((s) => [s.id, s.name]));
    const csvBtn = (key) => `<button class="linkbtn" data-csv="${key}">CSV</button>`;
    const tables = {};
    const agg = (list, keyFn, valFn = () => 1) => { const m = new Map(); for (const o of list) { const k = keyFn(o) || "–"; m.set(k, (m.get(k) || 0) + valFn(o)); } return [...m.entries()].map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v); };
    const byStore = agg(set, (o) => nameOf[o.store_id] || o.store);
    const byReason = agg(set, (o) => o.reason_discount).slice(0, 15);
    const byCond = agg(set, (o) => o.condition);
    const idOfName = Object.fromEntries(stores().map((x) => [x.name, x.id]));
    byStore.forEach((r) => { if (idOfName[r.l]) r.href = marktHref(idOfName[r.l]); });
    const titleOfArt = {}; for (const o of set) { const a = artsOf(o)[0]; if (a && !titleOfArt[a]) titleOfArt[a] = `${o.title} ${o.product_description}`.slice(0, 60); }
    const byTitle = agg(set, (o) => artsOf(o)[0]).filter((r) => r.l !== "–").slice(0, 15).map((r) => ({ l: titleOfArt[r.l] || r.l, v: r.v, href: prodHref(r.l) }));
    const buckets = Array.from({ length: 10 }, (_, i) => ({ l: `${i * 10}–${i * 10 + 9} %`, v: 0 })); set.forEach((o) => { if (o.discount_pct != null) buckets[Math.min(9, Math.max(0, Math.floor(o.discount_pct / 10)))].v++; });
    const dwellBy = (keyFn) => { const m = new Map(); gone.forEach((o) => { const k = keyFn(o) || "–"; (m.get(k) || m.set(k, []).get(k)).push(days(o.first_seen, o.gone_at)); }); return [...m.entries()].filter(([, a]) => a.length >= 5).map(([l, a]) => ({ l, v: Math.round(median(a) * 100) / 100, n: a.length })).sort((a, b) => a.v - b.v).slice(0, 15); };
    const dwellCond = dwellBy((o) => o.condition), dwellStore = dwellBy((o) => nameOf[o.store_id] || o.store);
    const dayList = []; for (let d = new Date(since); d <= new Date(now); d = new Date(+d + 864e5)) dayList.push(dayKey(d));
    const nNew = Object.fromEntries(dayList.map((d) => [d, 0])), nGone = { ...Object.fromEntries(dayList.map((d) => [d, 0])) };
    every.forEach((o) => { const a = dayKey(o.first_seen); if (a in nNew) nNew[a]++; if (o.gone_at) { const b = dayKey(o.gone_at); if (b in nGone) nGone[b]++; } });
    const firstObs = every.reduce((m, o) => (o.first_seen < m ? o.first_seen : m), "9999");
    Object.assign(tables, { maerkte: byStore, gruende: byReason, zustand: byCond, produkte: byTitle, rabatt: buckets, verweil_zustand: dwellCond, verweil_markt: dwellStore, verlauf: dayList.map((d) => ({ l: d, neu: nNew[d], weg: nGone[d] })) });
    const active = every.filter((o) => o.status === "active");
    const k = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
    view.innerHTML = `
      <div class="toolbar"><h2>Statistik</h2>
        <div class="toolbar__r">
          <div class="seg" role="group" aria-label="Datengrundlage"><button data-scope="aktiv" aria-pressed="${scope === "aktiv"}">Aktuell gelistet</button><button data-scope="alle" aria-pressed="${scope === "alle"}">Alle erfassten</button></div>
          <label class="sr" for="tage">Zeitraum Verlauf</label><select class="inp" id="tage" style="width:auto">${[14, 30, 90, 365].map((t) => `<option value="${t}" ${t === tage ? "selected" : ""}>${t} Tage</option>`).join("")}</select>
        </div></div>
      <div class="kpis">
        ${k(nf0.format(active.length), "aktive Angebote")}
        ${k(eur0(active.reduce((a, o) => a + (o.discount_eur || 0), 0)), "Rabatt-Summe aktiv")}
        ${k(pct(median(set.map((o) => o.discount_pct))), "Median-Rabatt")}
        ${k(eur(median(set.map((o) => o.price))), "Median-Preis")}
        ${k(dur(median(gone.map((o) => days(o.first_seen, o.gone_at))) ?? null), "Median-Verweildauer (verschwunden)")}
        ${k(nf0.format(every.filter((o) => o.first_seen >= since).length), `neu in ${tage} Tagen`)}
        ${k(nf0.format(gone.filter((o) => o.gone_at >= since).length), `verschwunden in ${tage} Tagen`)}
      </div>
      <p class="muted" style="font-size:12.5px;margin:-14px 0 22px">Grundlage: ${nf0.format(set.length)} Angebote · Beobachtung seit ${fmtD(firstObs)}. „Verschwunden“ heißt: nicht mehr gelistet (verkauft, reserviert oder entfernt) – die Schnittstelle unterscheidet das nicht. Verweildauer erst ab ≥ 5 Fällen je Gruppe; Angebote, die vor Beobachtungsbeginn eingestellt wurden, sind unterschätzt.</p>
      <div class="charts">
        <section class="chart" style="grid-column:1/-1"><header><div><h3>Neu vs. verschwunden pro Tag</h3><p>Erstmals gesehen bzw. zuletzt gesehen, Berliner Zeit</p></div>${csvBtn("verlauf")}</header>
          ${columns([dayList.map((d) => nNew[d]), dayList.map((d) => nGone[d])], dayList, ["#2E7D4F", "#B5452B"])}<div class="legend"><span><i style="background:#2E7D4F"></i>neu</span><span><i style="background:#B5452B"></i>verschwunden</span></div></section>
        <section class="chart"><header><div><h3>Angebote je Markt</h3><p>${scope === "aktiv" ? "derzeit gelistet" : "alle erfassten"}</p></div>${csvBtn("maerkte")}</header>${bars(byStore)}</section>
        <section class="chart"><header><div><h3>Häufigste Rabattgründe</h3><p>Freitext laut IKEA, Top 15</p></div>${csvBtn("gruende")}</header>${bars(byReason, { cls: "y" })}</section>
        <section class="chart"><header><div><h3>Zustand</h3></div>${csvBtn("zustand")}</header>${bars(byCond, { cls: "bl" })}</section>
        <section class="chart"><header><div><h3>Rabatthöhe</h3><p>Verteilung gegenüber Neupreis</p></div>${csvBtn("rabatt")}</header>${bars(buckets, { cls: "y" })}</section>
        <section class="chart"><header><div><h3>Häufigste Produkte</h3><p>nach Artikelnummer, Top 15 · antippen für Details</p></div>${csvBtn("produkte")}</header>${bars(byTitle)}</section>
        <section class="chart"><header><div><h3>Verweildauer nach Zustand</h3><p>Median in Tagen, nur verschwundene</p></div>${csvBtn("verweil_zustand")}</header>${dwellCond.length ? bars(dwellCond, { fmt: fmtDays, cls: "bl" }) : "<p class='muted'>Noch zu wenige abgeschlossene Angebote.</p>"}</section>
        <section class="chart"><header><div><h3>Verweildauer nach Markt</h3><p>Median in Tagen – kurz = schnell vergriffen</p></div>${csvBtn("verweil_markt")}</header>${dwellStore.length ? bars(dwellStore, { fmt: fmtDays }) : "<p class='muted'>Noch zu wenige abgeschlossene Angebote.</p>"}</section>
      </div>
      ${moreStats(every, gone, nameOf, tables, csvBtn)}`;
    $$("[data-scope]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/statistik?scope=${b.dataset.scope}&tage=${tage}`; }));
    $("#tage").addEventListener("change", (e) => { location.hash = `#/statistik?scope=${scope}&tage=${e.target.value}`; });
    bindSortTables(view); bindProductFinder();
    $$("[data-csv]").forEach((b) => b.addEventListener("click", () => { const t = tables[b.dataset.csv]; download(`statistik_${b.dataset.csv}_${dayKey(Date.now())}.csv`, toCSV(t, Object.keys(t[0] || { l: 0, v: 0 }))); }));
  }

  /* ---------- Daten & Methodik ---------- */
  const DICT = [
    ["id", "Tracker-Schlüssel: u:&lt;offerUuid&gt;, sonst n:&lt;Markt&gt;:&lt;Angebotsnummer&gt;. Eindeutig pro Einzelstück."],
    ["offer_uuid / offer_number", "Kennungen des Angebots bei IKEA (Nummer steht auch im Reservierungslink)."],
    ["article_number", "Reguläre IKEA-Artikelnummer (8 Ziffern). Mehrere Angebote können denselben Artikel haben."],
    ["title / product_description", "Produktname und Produktbeschreibung laut IKEA."],
    ["offer_description", "Angebotsspezifischer Text, falls vorhanden."],
    ["condition / condition_description", "Zustandsstufe und Erläuterung (z. B. „Wie neu“)."],
    ["reason_discount / additional_info", "Grund für den Rabatt bzw. Mangel – Freitext der Märkte."],
    ["price / original_price", "Zweite-Chance-Preis und regulärer Preis in Euro."],
    ["discount_eur / discount_pct", "Berechnet: Neupreis − Preis; Anteil am Neupreis."],
    ["first_seen / last_seen", "Erster und letzter Abruf, in dem das Angebot gelistet war (UTC, ISO 8601). Kein IKEA-Einstelldatum."],
    ["gone_at / status", "Status „gone“ nach 2 erfolgreichen Abrufen des Markts ohne das Angebot; gone_at = letzter Sichtzeitpunkt."],
    ["reappear_count", "Wie oft das Angebot nach dem Verschwinden wieder auftauchte (z. B. abgelaufene Reservierung)."],
    ["price_history", "Liste [Zeitpunkt, Preis] bei jeder Preisänderung."],
  ];
  // Wie regelmäßig wurde zuletzt abgerufen? (Lücken sofort sichtbar)
  function taktHtml() {
    const runs = (S.repo.runs || []).map((r) => r.ts).filter(Boolean).sort();
    if (runs.length < 2) return `<p class="muted">Noch zu wenige Abrufe.</p>`;
    const last = runs.slice(-25), gaps = [];
    for (let i = 1; i < last.length; i++) gaps.push((new Date(last[i]) - new Date(last[i - 1])) / 36e5);
    const day = runs.filter((t) => Date.now() - new Date(t) < 864e5).length;
    const fmtH = (h) => (h < 1.5 ? `${Math.round(h * 60)} Min.` : `${nf0.format(Math.round(h * 10) / 10)} Std.`);
    const ok = median(gaps) <= 1.3 && Math.max(...gaps) <= 3;
    return `<p style="margin:0 0 6px"><span class="dot ${ok ? "" : "dot--warn"}"></span>${ok ? "Regelmäßig" : "Unregelmäßig"}: ${day} Abrufe in den letzten 24 Std.</p>
      <table class="tbl"><tbody><tr><td>Typischer Abstand</td><td>${fmtH(median(gaps))}</td></tr><tr><td>Längste Lücke (letzte 24 Abrufe)</td><td>${fmtH(Math.max(...gaps))}</td></tr><tr><td>Letzter Abruf</td><td>${esc(rel(runs[runs.length - 1]))}</td></tr></tbody></table>
      ${columns([gaps.map((g) => Math.round(g * 10) / 10)], last.slice(1).map((t) => dayKey(t)), ["#0058A3"])}<p class="muted" style="font-size:12px;margin:2px 0 0">Abstand zwischen den letzten Abrufen in Stunden.</p>`;
  }
  async function fillWorkerDiag() {
    const box = $("#diag-worker"); if (!box) return;
    const head = "<h3>Worker (Takt, Telegram-Bot, Merkliste)</h3>";
    const manual = `<form id="wurl" class="row" style="margin-top:8px"><input class="inp" name="u" placeholder="https://zc-helper….workers.dev" value="${esc(lsGet(LS.workerUrl, "") || "")}"><button class="btn" type="submit">Verbinden</button></form>`;
    const bindForm = () => $("#wurl", box)?.addEventListener("submit", (e) => { e.preventDefault(); lsSet(LS.workerUrl, new FormData(e.target).get("u").trim()); toast("Gespeichert – lade neu …"); setTimeout(() => location.reload(), 600); });
    if (!worker.url) {
      box.innerHTML = `${head}<p><span class="dot dot--bad"></span><b>Nicht verbunden.</b> Im GitHub-Repo fehlt das Secret <code>WORKER_URL</code>. Bis dahin: Adresse hier eintragen (gilt nur für diesen Browser).</p>${manual}`;
      return bindForm();
    }
    let st;
    try { st = await worker.call("GET", null, { path: "/api/status" }); }
    catch (e) {
      // Ohne Passwort abfragbar: welche Einstellungen kommen im Worker an?
      const ping = await fetch(`${worker.url}/api/ping`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const missing = ping?.config ? Object.entries(ping.config).filter(([, v]) => !v).map(([k]) => k) : null;
      const why = !ping ? "Der Worker antwortet nicht (Adresse falsch oder noch alte Worker-Version ohne Diagnose)."
        : missing.includes("ACCESS_PASSWORD") ? "Im Worker ist <b>ACCESS_PASSWORD nicht gesetzt</b> (oder als normale Variable statt als Secret angelegt und beim letzten Deploy verloren gegangen)."
        : /401/.test(e.message) ? "ACCESS_PASSWORD ist gesetzt, stimmt aber nicht mit dem Passwort überein, mit dem du dich hier angemeldet hast."
        : esc(e.message);
      box.innerHTML = `${head}<p><span class="dot dot--bad"></span>${why}</p>
        ${missing?.length ? `<p>Im Worker fehlen außerdem: <b>${missing.filter((k) => k !== "ACCESS_PASSWORD").map(esc).join(", ") || "nichts"}</b></p>` : ""}
        <p class="muted" style="font-size:12.5px">Adresse: <code>${esc(worker.url)}</code>${ping ? ` · Worker-Version ${esc(String(ping.version))}` : ""}</p>${manual}`;
      return bindForm();
    }
    const row = (label, x, okText) => `<tr><td>${label}</td><td>${!x ? `<span class="muted">noch nie</span>` : x.ok ? `<span class="dot"></span>${okText} · ${esc(rel(x.ts))}` : `<span class="dot dot--bad"></span><b>${esc(x.error || "Fehler")}</b> · ${esc(rel(x.ts))}`}</td></tr>`;
    const missing = Object.entries(st.config || {}).filter(([, v]) => !v).map(([k]) => k);
    box.innerHTML = `${head}
      ${missing.length ? `<p><span class="dot dot--bad"></span>Im Worker fehlen: <b>${missing.map(esc).join(", ")}</b></p>` : `<p><span class="dot"></span>Alle Einstellungen im Worker vorhanden${S.repo.meta?.worker ? "" : " · <b>GitHub-Secret WORKER_URL fehlt noch</b> (Merkliste erreicht den Abruf sonst nicht)"}.</p>`}
      <table class="tbl"><tbody>
        ${row("Stündlicher Auslöser", st.scrape, "ausgelöst")}
        ${row("Telegram-Nachricht empfangen", st.telegram, "angenommen")}
        ${row("Telegram-Bot ausgelöst", st.bot, "ausgelöst")}
        <tr><td>Merkliste</td><td>${S.server?.ok ? `<span class="dot"></span>zentral gespeichert (${S.rules.length} Suchen)` : `<span class="dot dot--bad"></span>nicht erreichbar`}</td></tr>
      </tbody></table>
      <p style="margin-top:10px"><button class="btn" id="run-now">Jetzt abrufen</button> <span class="muted" style="font-size:12.5px">startet einen Abruf (dauert ca. 3 Min.)</span></p>`;
    $("#run-now", box).addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await worker.call("POST", {}, { path: "/api/run" }); toast("Abruf gestartet. In ca. 3 Minuten neu laden."); }
      catch (err) { toast(`<b>Nicht gestartet:</b> ${esc(err.message)} – Details siehe „Stündlicher Auslöser“.`, 8000); fillWorkerDiag(); }
    });
  }
  async function fillSentLog() {
    const box = $("#diag-sent"); if (!box) return;
    const state = await getBin("state.bin", S.repo.meta?.updated).catch(() => null);
    const sent = (state?.sent || []).slice(-15).reverse();
    const queued = state?.outbox?.length || 0;
    box.classList.remove("muted");
    box.innerHTML = (sent.length ? `<ul class="sentlog">${sent.map((m) => `<li><span class="muted mono">${esc(fmtDT(m.ts))}</span><div>${m.text.replace(/<(?!\/?(b|code|a)( href="[^"]*")?>)[^>]*>/g, "").replace(/\n/g, "<br>")}</div></li>`).join("")}</ul>`
      : `<p class="muted">Seit Einführung des Protokolls noch nichts gemeldet. Gemeldet wird, wenn ein Angebot zu einer gemerkten Suche mit 🔔 neu erscheint, wieder auftaucht oder billiger wird.</p>`)
      + (queued ? `<p class="muted">${queued} Nachricht(en) warten auf den nächsten Versand.</p>` : "");
  }
  async function renderDaten(query) {
    const meta = S.repo.meta;
    if (hasRepo() && !S.repo.runs) S.repo.runs = await getBin("runs.bin", meta.updated).catch(() => []);
    const runs = (S.repo.runs || []).slice(-48).reverse();
    const st = meta?.stores || S.local.stores || [];
    const bmSrc = await getText("bookmarklet.src.js").catch(() => "");
    const tracker = location.href.split("#")[0];
    const bm = bmSrc ? "javascript:" + encodeURIComponent(bmSrc.replace("__TRACKER_URL__", tracker).replace(/\n\s*/g, "\n")) : "#";
    const src = activeSource();
    view.innerHTML = `
      <div class="toolbar"><h2>Daten &amp; Methodik</h2>
        <div class="toolbar__r"><label class="sr" for="src">Datenquelle</label>
          <select id="src" class="inp" style="width:auto">
            <option value="auto" ${S.source === "auto" ? "selected" : ""}>Quelle: automatisch</option>
            <option value="repo" ${S.source === "repo" ? "selected" : ""} ${hasRepo() ? "" : "disabled"}>Nur GitHub-Abrufe</option>
            <option value="local" ${S.source === "local" ? "selected" : ""} ${hasLocal() ? "" : "disabled"}>Nur lokale Importe</option>
            <option value="both" ${S.source === "both" ? "selected" : ""} ${hasRepo() && hasLocal() ? "" : "disabled"}>Beide zusammen</option>
          </select></div></div>
      <div class="cols2" style="margin-top:16px">
        <section class="box"><h3>Stand</h3>
          <table class="tbl"><tbody>
            <tr><td>Aktive Quelle</td><td>${({ repo: "GitHub-Abrufe", local: "Lokale Importe (dieser Browser)", both: "GitHub + lokal", none: "keine" })[src]}</td></tr>
            <tr><td>Letzter GitHub-Abruf</td><td>${meta ? `${esc(fmtDT(meta.updated))} (${esc(rel(meta.updated))})` : "–"}</td></tr>
            ${meta ? `<tr><td>Märkte ok</td><td>${meta.last_run.stores_ok} / ${meta.last_run.stores_total}</td></tr>
            <tr><td>Letzter Lauf</td><td>${nf0.format(meta.last_run.new || 0)} neu · ${nf0.format(meta.last_run.gone || 0)} weg · ${nf0.format(meta.last_run.price_change || 0)} Preisänderungen · ${nf0.format(meta.hits_this_run || 0)} Merklisten-Treffer</td></tr>
            <tr><td>Erfasst insgesamt</td><td>${nf0.format(meta.total_offers)} Angebote</td></tr>` : ""}
            <tr><td>Letzter lokaler Import</td><td>${S.local.updated ? `${esc(fmtDT(S.local.updated))} · ${nf0.format(Object.keys(S.local.db).length)} Angebote` : "–"}</td></tr>
          </tbody></table>
          ${meta?.last_run?.errors ? `<p class="muted" style="font-size:13px"><b>Hinweise letzter Lauf:</b> ${esc(meta.last_run.errors)}</p>` : ""}
        </section>
        <section class="box"><h3>Export</h3>
          <p class="muted" style="font-size:13.5px;margin:0 0 10px">Die Listen „Aktuell“ und „Archiv“ haben oben einen CSV-Export (gefilterte Ansicht).</p>
          <p><button class="btn" id="logout">Auf diesem Gerät abmelden</button></p>
          ${hasLocal() ? `<p style="margin-top:12px"><button class="btn" id="local-exp">Lokalen Bestand als CSV</button> <button class="btn" id="local-json">… als Backup-JSON</button></p>` : ""}
        </section>
      </div>

      <div class="cols2" style="margin-top:28px">
        <section class="box" id="diag-takt"><h3>Abruf-Takt</h3>${taktHtml()}</section>
        <section class="box" id="diag-worker"><h3>Worker (Takt, Telegram-Bot, Merkliste)</h3><p class="muted">prüfe …</p></section>
      </div>
      <section class="box" id="diag-katalog" style="margin-top:28px"><h3>Katalog (alle Artikel Deutschland)</h3></section>
      <div class="cols2" style="margin-top:28px">
        <section class="box"><h3>Zuletzt per Telegram gemeldet</h3><div id="diag-sent" class="muted">lädt …</div></section>
        <section class="box"><h3>Merkliste: frühere Stände</h3>
          ${S.server?.ok ? `<details id="hist"><summary>Anzeigen</summary><div id="hist-list" class="muted" style="margin-top:8px">lädt …</div></details>` : `<p class="muted">Erst verfügbar, wenn der Worker verbunden ist.</p>`}</section>
      </div>

      <section class="box" style="margin-top:28px" id="import">
        <h3>Selbst abrufen (Lesezeichen) – falls GitHub gesperrt ist oder du sofort aktuelle Daten willst</h3>
        <ol class="prose" style="padding-left:20px">
          <li>Den gelben Knopf in die Lesezeichenleiste ziehen: <a class="bm" href="${esc(bm)}" onclick="event.preventDefault();alert('Bitte in die Lesezeichenleiste ziehen und dann auf ikea.com anklicken.')">IKEA Zweite Chance holen</a></li>
          <li>Eine beliebige Seite auf <a href="https://www.ikea.com/de/de/second-hand/buy-from-ikea/" target="_blank" rel="noopener">ikea.com/de</a> öffnen und das Lesezeichen anklicken. Dauer: ca. 1–3 Minuten für alle Märkte.</li>
          <li>Die Daten landen automatisch hier im Monitor (gespeichert in diesem Browser) – sonst wird eine Datei heruntergeladen, die du unten einliest <b>oder im Repo in <code>inbox/</code> hochlädst</b>; dann übernimmt GitHub sie ins zentrale Archiv.</li>
        </ol>
        <div class="drop" id="drop" tabindex="0">Snapshot-Datei (.json) hierher ziehen oder <label class="linkbtn" style="cursor:pointer">auswählen<input type="file" id="file" accept=".json,application/json" hidden></label></div>
        ${hasLocal() ? `<p style="margin-top:10px"><button class="btn" id="local-del" style="color:var(--rust)">Lokalen Bestand löschen</button></p>` : ""}
      </section>

      <section style="margin-top:28px"><div class="toolbar"><h2>Märkte <small>${st.length}</small></h2></div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Markt</th><th>ID</th><th class="n">aktiv</th><th>zuletzt ok</th><th>Fehler</th></tr></thead><tbody>
          ${st.map((s) => `<tr><td><a href="#/aktuell?s=${esc(s.id)}">${esc(s.name)}</a> · <a href="${marktHref(s.id)}" class="muted">Statistik</a></td><td class="mono">${esc(s.id)}</td><td class="n">${s.active != null ? nf0.format(s.active) : "–"}</td><td>${esc(rel(s.last_ok))}</td><td class="muted" style="font-size:12.5px">${esc(s.last_error || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Noch keine Märkte erfasst.</td></tr>`}
        </tbody></table></div></section>

      ${runs.length ? `<section style="margin-top:28px"><div class="toolbar"><h2>Abrufprotokoll <small>letzte ${runs.length}</small></h2></div><div class="tblwrap"><table class="tbl"><thead><tr><th>Zeit</th><th>Quelle</th><th class="n">Märkte ok</th><th class="n">aktiv</th><th class="n">neu</th><th class="n">weg</th><th class="n">wieder</th><th class="n">Preis</th><th class="n">Dauer</th></tr></thead><tbody>
        ${runs.map((r) => `<tr><td>${esc(fmtDT(r.ts))}</td><td>${esc(r.source)}</td><td class="n">${esc(r.stores_ok)}/${esc(r.stores_total)}</td><td class="n">${esc(r.active)}</td><td class="n">${esc(r.new)}</td><td class="n">${esc(r.gone)}</td><td class="n">${esc(r.reappeared)}</td><td class="n">${esc(r.price_change)}</td><td class="n">${esc(r.duration_s)} s</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}

      <section class="prose" style="margin-top:32px">
        <h2>Methodik</h2>
        <p><b>Quelle.</b> Die Daten stammen aus der Schnittstelle, die IKEAs eigene Zweite-Chance-Seite lädt (<code>web-api.ikea.com/circular/circular-asis</code>). Sie ist nicht dokumentiert und kann sich jederzeit ändern. Abgerufen wird stündlich, alle Märkte nacheinander mit Pausen.</p>
        <p><b>Eindeutigkeit.</b> Jedes Einzelstück hat bei IKEA eine Angebots-UUID; sie ist der Schlüssel. Drei gleiche Regale im selben Markt sind drei Datensätze. Doppelte Einträge innerhalb einer Antwort werden verworfen.</p>
        <p><b>Verschwinden.</b> Ein Angebot gilt erst als „weg“, wenn es in zwei aufeinanderfolgenden <i>erfolgreichen</i> Abrufen seines Markts fehlt. Fällt ein Markt aus oder liefert er unplausibel null Angebote, bleibt sein Bestand unverändert. Taucht ein Angebot wieder auf (etwa nach abgelaufener Reservierung), wird derselbe Datensatz reaktiviert.</p>
        <p><b>Datum.</b> IKEA liefert kein Einstelldatum. Alle Zeitangaben sind Beobachtungen dieses Trackers; die Genauigkeit entspricht dem Abrufintervall (≈ 1 Stunde). Angebote, die schon vor dem ersten Abruf gelistet waren, haben ein zu spätes <code>first_seen</code>.</p>
        <p><b>Aufbewahrung.</b> Nichts wird automatisch gelöscht: aktive und verschwundene Angebote, ihr Verlauf und das Abrufprotokoll bleiben dauerhaft gespeichert (Archiv nach Monaten). Alle Dateien liegen verschlüsselt auf dem Server und werden erst in diesem Browser entschlüsselt.</p>
        <h3 style="margin-top:20px">Felder</h3>
        <table class="tbl"><tbody>${DICT.map(([k, v]) => `<tr><td class="mono" style="white-space:nowrap">${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>
      </section>`;

    bindHistory(view); fillWorkerDiag(); fillSentLog(); fillKatalogDiag();
    $("#logout").addEventListener("click", () => { lsSet(LS.key, null); lsSet(LS.pw, null); location.reload(); });
    $("#src").addEventListener("change", (e) => { S.source = e.target.value; lsSet(LS.source, S.source); updateBadges(); renderDaten(); });
    const drop = $("#drop"), file = $("#file");
    file.addEventListener("change", () => file.files[0] && importFile(file.files[0]));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
    $("#local-exp")?.addEventListener("click", () => download(`zweite-chance_lokal_${dayKey(Date.now())}.csv`, toCSV(Object.values(S.local.db), EXPORT_COLS)));
    $("#local-json")?.addEventListener("click", () => download(`zweite-chance_lokal_${dayKey(Date.now())}.json`, JSON.stringify({ format: "zc-local-v1", ...S.local }), "application/json"));
    $("#local-del")?.addEventListener("click", async () => { if (!confirm("Lokal gespeicherte Angebote in diesem Browser löschen? GitHub-Daten bleiben unberührt.")) return; S.local = { db: {}, events: [], runs: [], updated: null, stores: [] }; await saveLocal(); updateBadges(); renderDaten(); });
    if (new URLSearchParams(query || "").get("import")) $("#import").scrollIntoView({ block: "start" });
  }

  /* ---------- Import (Lesezeichen / Datei) ---------- */
  async function ingest(data) {
    if (data?.format === "zc-local-v1") { S.local = { db: data.db || {}, events: data.events || [], runs: data.runs || [], updated: data.updated || null, stores: data.stores || [] }; await saveLocal(); toast("Lokales Backup wiederhergestellt."); }
    else {
      const before = new Set(Object.keys(S.local.db));
      const run = ZC.ingestSnapshot(S.local, data);
      await saveLocal();
      const fresh = before.size ? Object.values(S.local.db).filter((o) => !before.has(o.id)) : [];
      const hits = fresh.filter((o) => hitRules(o).length);
      toast(`<b>Import ok:</b> ${run.stores_ok}/${run.stores_total} Märkte, ${nf0.format(run.offers_seen)} Angebote · ${nf0.format(run.new || 0)} neu · ${nf0.format(run.gone || 0)} weg${hits.length ? ` · <b>${hits.length} Merklisten-Treffer</b>` : ""}`, 8000);
      if (hits.length) notifyHits(hits);
      if (run.errors) console.warn("Import-Hinweise:", run.errors);
    }
    updateBadges(); route();
  }
  async function importFile(f) {
    try { await ingest(JSON.parse(await f.text())); } catch (e) { toast(`<b>Import fehlgeschlagen:</b> ${esc(e.message || e)}`, 8000); }
  }
  window.addEventListener("message", async (ev) => {
    let host = ""; try { host = new URL(ev.origin).hostname; } catch { return; }
    if (!/(^|\.)ikea\.com$/.test(host)) return;
    if (ev.data === "zc-hello") { ev.source?.postMessage("zc-ready", ev.origin); return; }
    if (ev.data?.type === "zc-snapshot") {
      try { await ingest(ev.data.snapshot); ev.source?.postMessage("zc-imported", ev.origin); }
      catch (e) { toast(`<b>Import fehlgeschlagen:</b> ${esc(e.message || e)}`, 8000); }
    }
  });
  if (window.opener) try { window.opener.postMessage("zc-ready", "*"); } catch { /* ohne Opener */ }

  /* ---------- Hinweise ---------- */
  function notifyHits(hits) {
    if (!lsGet(LS.notify, false) || !("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(hits.length === 1 ? `Merkliste: ${hits[0].title}` : `${hits.length} neue Merklisten-Treffer`, {
      body: hits.slice(0, 3).map((o) => `${o.title} · ${eur(o.price)} · ${o.store}`).join("\n"), tag: "zc-hits",
    });
    n.onclick = () => { window.focus(); location.hash = "#/aktuell?hit=1&neu=1"; };
  }
  function markHitsSeen() { lsSet(LS.seenHits, allOffers(false).filter((o) => hitRules(o).length).map((o) => o.id)); }
  function checkNewHits() {
    const seen = new Set(lsGet(LS.seenHits, []));
    const hits = allOffers(false).filter((o) => o.status === "active" && hitRules(o).length);
    const fresh = hits.filter((o) => !seen.has(o.id));
    if (fresh.length && seen.size) { notifyHits(fresh); toast(`<b>${fresh.length} neue Merklisten-Treffer</b> – <a style="color:#FFDB00" href="#/aktuell?hit=1">ansehen</a>`, 9000); }
    lsSet(LS.seenHits, hits.map((o) => o.id));
  }
  function updateBadges() {
    const act = allOffers(false).filter((o) => o.status === "active");
    $("#n-aktuell").textContent = act.length ? nf0.format(act.length) : "";
    const h = act.filter((o) => hitRules(o).length).length;
    $("#n-hits").textContent = h ? nf0.format(h) : "";
    const up = updatedAt(), meta = S.repo.meta;
    if (!up) { $("#status").textContent = "Noch keine Daten"; return; }
    const age = (Date.now() - new Date(up)) / 36e5;
    const okRatio = meta ? meta.last_run.stores_ok / Math.max(1, meta.last_run.stores_total) : 1;
    const cls = age > 6 || okRatio < 0.5 ? "dot--bad" : age > 2.5 || okRatio < 0.95 ? "dot--warn" : "";
    $("#status").innerHTML = `<span class="dot ${cls}"></span>Stand <b>${esc(rel(up))}</b>${meta ? ` · ${meta.last_run.stores_ok}/${meta.last_run.stores_total} Märkte` : ""} · ${nf0.format(act.length)} aktiv`;
  }

  /* ---------- Einrichtung (noch keine Daten) ---------- */
  function renderOnboarding() {
    view.innerHTML = `<div class="prose" style="margin:20px auto 0">
      <h2 style="font-size:30px">Noch keine Daten</h2>
      <p>Sobald der erste Abruf durch ist, erscheinen hier die Angebote. Der erste Lauf dauert einige Minuten; danach diese Seite neu laden.</p>
      <p><a class="btn btn--primary" href="#/daten?import=1">Selbst abrufen per Lesezeichen →</a></p></div>`;
  }

  /* ---------- Router & Start ---------- */
  function route() {
    document.body.classList.remove("filters-open");
    const h = location.hash.replace(/^#\/?/, "") || "aktuell";
    const [name, query] = h.split("?");
    if (name === "merkliste") { const rg = new URLSearchParams(query || "").get("regel"); location.replace(`#/aktuell?m=${rg !== null && savedSearches()[rg] ? savedSearches()[rg].r.id : "all"}`); return; }
    const tab0 = name === "produkt" ? "statistik" : name === "markt" ? "maerkte" : name === "artikel" ? "katalog" : ["aktuell", "archiv", "maerkte", "katalog", "statistik", "daten"].includes(name) ? name : "aktuell";
    const tab = tab0 === "aktuell" && /(^|&)m=/.test(query || "") ? "gemerkt" : tab0;
    $$(".tabs a").forEach((a) => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    S.shown = 120;
    const r = { aktuell: () => renderList("aktuell", query), gemerkt: () => renderList("aktuell", query), archiv: () => renderList("archiv", query), maerkte: () => (name === "markt" ? renderMarkt(query) : renderMaerkte()), katalog: () => (name === "artikel" ? renderArtikel(query) : renderKatalog(query)), statistik: () => (name === "produkt" ? renderProdukt(query) : renderStatistik(query)), daten: () => renderDaten(query) }[tab];
    Promise.resolve(r()).catch((e) => { console.error(e); view.innerHTML = `<div class="empty"><h3>Fehler beim Anzeigen</h3><p>${esc(e.message || e)}</p></div>`; });
  }
  window.addEventListener("hashchange", () => { if ($("#detail").open) $("#detail").close(); route(); });
  view.addEventListener("click", (e) => { const el = e.target.closest("[data-id]"); if (el && !e.target.closest("a")) openDetail(el.dataset.id); });
  view.addEventListener("keydown", (e) => { const el = e.target.closest?.("[data-id]"); if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(el.dataset.id); } });
  $("#detail").addEventListener("click", (e) => { if (e.target === $("#detail")) $("#detail").close(); });

  function rememberVisit() { lsSet(LS.lastVisit, new Date().toISOString()); }
  async function refresh() {
    const prev = S.repo.meta?.updated;
    await loadRepo().catch((e) => { if (e instanceof AuthError) { lsSet(LS.key, null); location.reload(); } });
    if (S.repo.meta?.updated && S.repo.meta.updated !== prev) {
      S.repo.archive = {}; S.repo.runs = null; S.kat = null; resetRules();
      updateBadges(); checkNewHits();
      if (prev) { toast(`Neue Daten (${esc(fmtDT(S.repo.meta.updated))}).`); if (!$("#detail").open && !document.activeElement?.closest?.("form")) route(); }
    } else updateBadges();
  }
  function loginForm(message) {
    return new Promise((resolve) => {
      const box = $("#login"); box.hidden = false;
      const form = $("#login-form"), msg = $("#login-msg"), pw = $("#login-pw");
      msg.textContent = message || ""; pw.focus();
      form.onsubmit = async (e) => {
        e.preventDefault(); msg.textContent = "Prüfe …"; form.querySelector("button").disabled = true;
        try {
          const b64 = await ZC.deriveKeyB64(pw.value);
          AUTH.key = await ZC.importKey(b64); AUTH.pw = pw.value;
          await loadRepo();
          lsSet(LS.key, b64); lsSet(LS.pw, pw.value);
          box.hidden = true; resolve();
        } catch (err) {
          msg.textContent = err instanceof AuthError ? "Passwort stimmt nicht." : `Fehler: ${err.message || err}`;
          form.querySelector("button").disabled = false; pw.select();
        }
      };
    });
  }
  async function unlock() {
    const k = lsGet(LS.key, null);
    if (k) {
      try { AUTH.key = await ZC.importKey(k); AUTH.pw = lsGet(LS.pw, null); await loadRepo(); return; }
      catch (e) { if (!(e instanceof AuthError)) throw e; lsSet(LS.key, null); }
    }
    await loginForm();
  }
  async function init() {
    S.prevVisit = lsGet(LS.lastVisit, null);
    await Promise.all([unlock(), loadLocal()]);
    document.body.classList.remove("locked");
    document.title = "Zweite Chance";
    view.innerHTML = '<div class="skeleton"></div>'.repeat(2);
    updateBadges(); route(); checkNewHits();
    setTimeout(rememberVisit, 60000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) rememberVisit(); else refresh(); });
    setInterval(refresh, 10 * 60 * 1000);
  }
  window.ZCApp = { openDetail, route, state: S };   // fuer Konsole/Debugging
  init();
})();

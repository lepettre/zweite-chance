/* Zweite-Chance-Monitor – Web-App (ohne Build, ohne Abhängigkeiten). */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $("#view");
  const TZ = "Europe/Berlin";
  const LS = { rules: "zc.rules", lastVisit: "zc.lastVisit", prevVisit: "zc.prevVisit", source: "zc.source", layout: "zc.layout", notify: "zc.notify", seenHits: "zc.seenHits", key: "zc.k", pw: "zc.p" };

  /* ---------- Formatierung ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = (v) => v === null || v === undefined ? "–" : `${nf2.format(v)} €`;
  const eur0 = (v) => v === null || v === undefined ? "–" : `${nf0.format(Math.round(v))} €`;
  const pct = (v) => v === null || v === undefined ? "–" : `${nf0.format(Math.round(v))} %`;
  const dtf = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const df = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  const dayKey = (ts) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(ts));
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
    repo: { meta: null, current: [], archive: {}, archiveLoaded: false, watch: [], runs: null, events: {} },
    local: { db: {}, events: [], runs: [], updated: null, stores: [] },
    source: lsGet(LS.source, "auto"),
    rules: ZC.dedupeRules(lsGet(LS.rules, [])),
    prevVisit: null,
    filters: {},
    layout: lsGet(LS.layout, "list"),
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
    get url() { return S.repo.meta?.worker || null; },
    async call(method, body) {
      const r = await fetch(`${this.url}/api/watchlist`, { method, headers: { "x-key": AUTH.pw, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(`Worker ${r.status}`);
      return r.json();
    },
  };
  async function loadRules() {
    S.server = { ok: false, groups: {} };
    if (worker.url && AUTH.pw) {
      try {
        const w = await worker.call("GET");
        S.server = { ok: true, groups: w.groups || {} };
        const old = lsGet(LS.rules, []);                       // frühere, nur lokal gespeicherte Regeln einmalig übernehmen
        const merged = ZC.dedupeRules([...(w.rules || []), ...old]);
        S.rules = merged; S.repo.watch = []; resetRules();
        if (old.length) { lsSet(LS.rules, []); if (merged.length !== ZC.dedupeRules(w.rules || []).length) await persistRules(); }
        return;
      } catch (e) { console.warn("Merkliste vom Server nicht lesbar", e); }
    }
    const saved = await getBin("watchlist.bin").catch((e) => { if (e instanceof AuthError) throw e; return { rules: [] }; });
    S.repo.watch = ZC.dedupeRules((saved.rules || []).map((r, i) => ({ ...r, name: r.name || `Regel ${i + 1}`, _repo: true }))); resetRules();
  }
  async function persistRules() {
    S.rules = ZC.dedupeRules(S.rules); resetRules();
    if (S.server?.ok) {
      try { await worker.call("PUT", { rules: S.rules.map(({ _localIndex, ...r }) => r), groups: S.server.groups }); }
      catch (e) { toast(`<b>Merkliste nicht gespeichert:</b> ${esc(e.message)}`, 7000); }
    } else lsSet(LS.rules, S.rules);
  }

  async function loadRepo() {
    let meta;
    try { meta = await getBin("meta.bin"); }
    catch (e) { if (e instanceof AuthError) throw e; S.repo.meta = null; return; }
    S.repo.meta = meta;
    S.repo.current = unpack(await getBin("current.bin", meta.current_version).catch((e) => { if (e instanceof AuthError) throw e; return null; }));
    await loadRules();
  }
  async function loadArchive() {
    if (S.repo.archiveLoaded || !hasRepo()) return;
    const months = S.repo.meta.archive_months || [];
    const parts = await Promise.all(months.map((m) => getBin(`a-${m}.bin`, S.repo.meta.updated).then(unpack).catch(() => [])));
    S.repo.archive = Object.fromEntries(months.map((m, i) => [m, parts[i]]));
    S.repo.archiveLoaded = true;
  }
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
  const allRules = () => ZC.dedupeRules([...S.repo.watch, ...S.rules]);
  let rulesMemo = null;                                   // vorbereitete Regeln; bei jeder Änderung verwerfen
  const resetRules = () => { rulesMemo = null; };
  const compiledRules = () => rulesMemo || (rulesMemo = allRules().filter((r) => r.enabled !== false).map((r) => ({ r, f: ZC.compileRule(r) })));
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
  const F_KEYS = ["q", "s", "c", "r", "pmin", "pmax", "dmin", "neu", "hit", "sort", "von", "bis", "art"];
  function parseQuery(qs) { const p = new URLSearchParams(qs || ""); const f = {}; for (const k of F_KEYS) if (p.get(k)) f[k] = p.get(k); return f; }
  function writeQuery(route, f) { const p = new URLSearchParams(); for (const k of F_KEYS) if (f[k]) p.set(k, f[k]); const qs = p.toString(); history.replaceState(null, "", `#/${route}${qs ? "?" + qs : ""}`); }
  const setOf = (v) => new Set((v || "").split("~").filter(Boolean));

  function applyFilters(list, f, mode) {
    const q = ZC.fold(f.q || "").trim(); const terms = q.split(/\s+/).filter(Boolean);
    const S_ = setOf(f.s), C_ = setOf(f.c), R_ = setOf(f.r);
    const pmin = f.pmin ? Number(f.pmin) : null, pmax = f.pmax ? Number(f.pmax) : null, dmin = f.dmin ? Number(f.dmin) : null;
    const art = f.art ? ZC.normArticle(f.art) : "";
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
      if (f.hit && !hitRules(o).length) return false;
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
    if (mode === "archiv" && !S.repo.archiveLoaded && hasRepo()) {
      view.innerHTML = `<div class="toolbar"><h2>Archiv</h2></div>${'<div class="skeleton"></div>'.repeat(5)}`;
      await loadArchive();
    }
    const base = allOffers(mode === "archiv");
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
            <label class="switch"><input type="checkbox" name="hit" value="1" ${f.hit ? "checked" : ""}> Nur Merklisten-Treffer</label>
            ${f.art ? `<label class="switch"><input type="checkbox" name="art" value="${esc(f.art)}" checked> Artikel ${esc(ZC.fmtArticle(f.art))}</label>` : ""}
          </fieldset>
          <button type="button" class="btn" id="reset" style="width:100%">Alle Filter zurücksetzen</button>
          <button type="button" class="btn btn--primary filters__done" id="filter-done">Ergebnisse anzeigen</button>
        </form>
        <section aria-labelledby="list-h">
          <div class="toolbar">
            <h2 id="list-h">${mode === "archiv" ? "Archiv" : "Aktuelle Angebote"} <small id="list-count"></small></h2>
            <div class="toolbar__r">
              <label class="sr" for="sort">Sortierung</label>
              <select id="sort" class="inp" style="width:auto">${Object.entries(SORTS).filter(([k]) => mode === "archiv" || !["weg"].includes(k)).map(([k, [l]]) => `<option value="${k}" ${f.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
              <div class="seg" role="group" aria-label="Darstellung"><button type="button" data-layout="list" aria-pressed="${S.layout === "list"}">Liste</button><button type="button" data-layout="grid" aria-pressed="${S.layout === "grid"}">Kacheln</button></div>
              <button type="button" class="btn" id="csv" title="Gefilterte Angebote als CSV">⤓ CSV</button>
            </div>
          </div>
          ${newCount && !f.neu ? `<div class="notice"><span><b>${nf0.format(newCount)} neue Angebote</b> seit deinem letzten Besuch (${fmtDT(S.prevVisit)}).</span><button class="btn" id="show-new">Nur neue zeigen</button></div>` : ""}
          <div id="results"></div>
        </section>
      </div>`;

    const form = $("#filters");
    let current = [];
    const filterToggle = $("#filter-toggle");
    const nActive = () => F_KEYS.filter((k) => k !== "sort" && S.filters[k]).length;
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
      if (fd.get("neu")) nf.neu = "1"; if (fd.get("hit")) nf.hit = "1"; if (fd.get("art")) nf.art = fd.get("art");
      S.filters = nf; S.shown = 120; writeQuery(mode, nf); draw();
    };
    const reset = () => { S.filters = { sort: S.filters.sort }; writeQuery(mode, S.filters); renderList(mode, `sort=${S.filters.sort}`); };
    form.addEventListener("input", debounce(sync, 140));
    form.addEventListener("submit", (e) => e.preventDefault());
    $("#store-find").addEventListener("input", (e) => { const q = ZC.fold(e.target.value); $$("#store-checks .check").forEach((l) => { l.hidden = q && !ZC.fold(l.textContent).includes(q); }); e.stopPropagation(); });
    $$("[data-clear]").forEach((b) => b.addEventListener("click", () => { $$(`input[name=${b.dataset.clear}]`, form).forEach((i) => (i.checked = false)); sync(); }));
    $("#reset").addEventListener("click", reset);
    $("#sort").addEventListener("change", (e) => { S.filters.sort = e.target.value; writeQuery(mode, S.filters); draw(); });
    $$("[data-layout]").forEach((b) => b.addEventListener("click", () => { S.layout = b.dataset.layout; lsSet(LS.layout, S.layout); $$("[data-layout]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
    $("#show-new")?.addEventListener("click", () => { $("input[name=neu]", form).checked = true; sync(); });
    $("#csv").addEventListener("click", () => {
      const cmp = SORTS[S.filters.sort]?.[1] || SORTS.neu[1];
      download(`zweite-chance_${mode}_${dayKey(Date.now())}.csv`, toCSV(current.slice().sort(cmp), EXPORT_COLS));
    });
    draw();
  }

  /* ---------- Detail ---------- */
  const EV_LABEL = { new: "Erstmals gesehen", reappeared: "Wieder aufgetaucht", price_change: "Preis geändert", changed: "Angaben geändert", gone: "Nicht mehr gelistet (zuletzt gesehen)" };
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
    if (!o && !S.repo.archiveLoaded) { await loadArchive(); o = allOffers(true).find((x) => x.id === id); }
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
            <dt>Markt</dt><dd>${esc(o.store)} <span class="muted mono">(ID ${esc(o.store_id)})</span></dd>
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
            ${o.article_number ? `<button class="btn" data-watch-art>＋ Artikel auf die Merkliste</button><a class="btn" href="#/archiv?art=${esc(o.article_number)}" data-close>Artikel im Archiv</a>` : ""}
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
      const r = { name: `${o.title} ${ZC.fmtArticle(o.article_number)}`, enabled: true, article_numbers: [ZC.fmtArticle(o.article_number)] };
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
    if (o.gone_at) evs.push({ ts: o.gone_at, type: "gone" });
    evs.push(...S.local.events.filter((e) => e.id === o.id));
    const seen = new Set(); evs = evs.filter((e) => { const k = e.ts + e.type; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.ts.localeCompare(b.ts));
    const tl = $("#tl", dlg); if (!tl) return;
    tl.innerHTML = evs.length ? evs.map((e) => `<li><b>${esc(EV_LABEL[e.type] || e.type)}</b> · ${esc(fmtDT(e.type === "gone" ? o.gone_at || e.ts : e.ts))}${e.type === "price_change" ? ` · ${esc(eur(Number(e.old_price)))} → ${esc(eur(Number(e.new_price)))}` : ""}${e.fields ? ` <span class="muted">(${esc(e.fields)})</span>` : ""}</li>`).join("")
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
    if (r.max_price) p.push(`bis ${esc(eur(Number(r.max_price)))}`);
    if (r.conditions?.length) p.push(`Zustand/Grund: ${r.conditions.map(esc).join(", ")}`);
    return p.join(" · ") || "<span class='muted'>ohne Einschränkung (trifft alles)</span>";
  }
  function renderMerkliste(query) {
    if (activeSource() === "none") return renderOnboarding();
    const active = allOffers(false).filter((o) => o.status === "active");
    const sel = new URLSearchParams(query || "").get("regel");
    const rules = ZC.dedupeRules([
      ...S.repo.watch.map((r) => ({ ...r, _repo: true })),
      ...S.rules.map((r, i) => ({ ...r, _localIndex: i }))
    ]);
    const hitsOf = (r) => active.filter((o) => ZC.matches({ ...r, enabled: true }, o));

    // Treffer einer Regel: eigene Seite, volle Breite (mobil nicht von Filtern/Formular verdeckt)
    if (sel !== null && rules[sel]) {
      const hs = hitsOf(rules[sel]).sort(SORTS.neu[1]);
      view.innerHTML = `
        <div class="toolbar"><div><a class="btn" href="#/merkliste">← Merkliste</a></div></div>
        <div class="toolbar"><h2>${esc(rules[sel].name)} <small>${nf0.format(hs.length)} Treffer</small></h2></div>
        <p class="muted" style="margin:0 0 14px">${ruleSummary(rules[sel])}</p>
        ${hs.length ? `<ul class="offers">${hs.slice(0, 300).map(offerRow).join("")}</ul>${hs.length > 300 ? `<p class="muted">… und ${hs.length - 300} weitere.</p>` : ""}` : `<div class="empty">Derzeit kein passendes Angebot.</div>`}`;
      return;
    }

    const st = stores();
    const serverMode = !!S.server?.ok;
    const exportJSON = () => JSON.stringify({ rules: ZC.dedupeRules([...S.repo.watch, ...S.rules]).map(({ _repo, _localIndex, ...r }) => r) }, null, 2);
    const wide = window.matchMedia("(min-width: 961px)").matches;
    view.innerHTML = `
      <div class="toolbar"><h2>Merkliste <small>${rules.length} Regeln</small></h2>
        <div class="toolbar__r">
          <label class="switch" title="Benachrichtigt, solange diese Seite geöffnet ist"><input type="checkbox" id="bnotify" ${lsGet(LS.notify, false) ? "checked" : ""}> Browser-Hinweise</label>
          ${serverMode ? "" : `<button class="btn" id="exp">watchlist.json exportieren</button>`}
          <a class="btn btn--primary" href="#rf-box" id="new-rule">＋ Neue Regel</a>
        </div></div>
      <div class="notice" style="background:#EAF2FA;border-color:#B8D0EA"><span>${serverMode
        ? "<b>Regeln werden zentral gespeichert</b> und lösen Telegram-Nachrichten aus. Änderungen gelten ab dem nächsten Abruf."
        : "<b>Ohne Server:</b> Gelbe Regeln leben nur in diesem Browser (Markierung in den Listen). Blaue Regeln kommen vom letzten Abruf und lösen Telegram aus."}</span></div>
      <div class="cols2">
        <section>
          <div class="rules">${rules.length ? rules.map((r, i) => { const n = hitsOf(r).length; const li = r._localIndex ?? -1; return `
            <article class="rule ${r._repo ? "rule--repo" : ""} ${r.enabled === false ? "rule--off" : ""}">
              <div style="min-width:0"><h3>${esc(r.name)} ${r.enabled === false ? `<span class="muted" style="font-weight:400">(pausiert)</span>` : ""}</h3><p>${ruleSummary(r)}</p></div>
              <div class="rule__act"><a class="btn" href="#/merkliste?regel=${i}">${nf0.format(n)} Treffer ›</a>
              ${r._repo || li < 0 ? "" : `<button class="btn" data-toggle="${li}" aria-label="Regel ${r.enabled === false ? "aktivieren" : "pausieren"}">${r.enabled === false ? "▶" : "❚❚"}</button><button class="btn" data-edit="${li}" aria-label="Bearbeiten">✎</button><button class="btn" data-del="${li}" aria-label="Löschen">✕</button>`}</div>
            </article>`; }).join("") : `<div class="empty"><h3>Noch keine Regeln</h3><p>Lege deine erste Suche an – oder im Angebotsdetail „Artikel auf die Merkliste“.</p></div>`}</div>
        </section>
        <details class="box" id="rf-box" ${wide ? "open" : ""} aria-labelledby="rf-h">
          <summary><h3 id="rf-h" style="display:inline">Neue Regel</h3></summary>
          <form id="rf" class="form">
            <input type="hidden" name="idx" value="">
            <label style="grid-column:1/-1">Name<input class="inp" name="name" required placeholder="z. B. Hemnes-Kommode Hamburg"></label>
            <label>Stichworte (Komma)<input class="inp" name="keywords" placeholder="hemnes kommode, malm"></label>
            <label>Ausschließen<input class="inp" name="exclude" placeholder="tür, front"></label>
            <label>Artikelnummern<input class="inp" name="article_numbers" placeholder="802.758.87"></label>
            <label>Zustand / Grund enthält<input class="inp" name="conditions" placeholder="wie neu, Ausstellungsstück"></label>
            <label>Mindestrabatt %<input class="inp" name="min_discount_pct" type="number" min="0" max="100"></label>
            <label>Höchstpreis €<input class="inp" name="max_price" type="number" min="0"></label>
            <fieldset style="grid-column:1/-1;border:1px solid var(--line);border-radius:var(--r);padding:8px 10px"><legend class="muted" style="font-size:12.5px">Märkte (leer = alle)</legend>
              <div class="checks" style="max-height:150px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${st.map((s) => `<label class="check"><input type="checkbox" name="stores" value="${esc(s.id)}"><span>${esc(s.name)}</span></label>`).join("")}</div></fieldset>
            <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--primary" type="submit">Regel speichern</button><button class="btn" type="reset">Leeren</button><span class="muted" id="rf-preview" style="align-self:center;font-size:13px"></span></div>
          </form>
        </details>
      </div>
      `;

    const form = $("#rf"), box = $("#rf-box");
    $("#new-rule").addEventListener("click", (e) => { e.preventDefault(); box.open = true; box.scrollIntoView({ block: "start" }); form.elements.namedItem("name").focus(); });
    const readForm = () => { const fd = new FormData(form); return { name: fd.get("name").trim(), enabled: true, keywords: splitList(fd.get("keywords")), exclude: splitList(fd.get("exclude")), article_numbers: splitList(fd.get("article_numbers")), conditions: splitList(fd.get("conditions")), stores: fd.getAll("stores"), min_discount_pct: fd.get("min_discount_pct") ? Number(fd.get("min_discount_pct")) : null, max_price: fd.get("max_price") ? Number(fd.get("max_price")) : null }; };
    form.addEventListener("input", debounce(() => { const r = readForm(); $("#rf-preview").textContent = `→ aktuell ${nf0.format(hitsOf(r).length)} Treffer`; }, 200));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const r = readForm(); const idx = form.elements.idx.value;
      const editIndex = idx === "" ? -1 : Number(idx);
      const duplicate = ZC.dedupeRules([...S.repo.watch, ...S.rules.map((x, i) => i === editIndex ? { ...x, _edit: true } : x)])
        .some((x) => !x._edit && ZC.ruleKey(x) === ZC.ruleKey(r));
      if (duplicate) { toast("Diese Suche ist bereits gespeichert."); return; }
      if (idx !== "") { r.enabled = S.rules[idx].enabled; S.rules[idx] = r; } else S.rules.push(r);
      await persistRules(); toast("Regel gespeichert."); updateBadges();
      renderMerkliste();
    });
    $$("[data-del]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Regel löschen?")) return; S.rules.splice(+b.dataset.del, 1); await persistRules(); updateBadges(); renderMerkliste(); }));
    $$("[data-toggle]").forEach((b) => b.addEventListener("click", async () => { const r = S.rules[+b.dataset.toggle]; r.enabled = r.enabled === false; await persistRules(); updateBadges(); renderMerkliste(query); }));
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const r = S.rules[+b.dataset.edit], el = form.elements; el.idx.value = b.dataset.edit; el.namedItem("name").value = r.name;
      for (const k of ["keywords", "exclude", "article_numbers", "conditions"]) el[k].value = (r[k] || []).join(", ");
      el.min_discount_pct.value = r.min_discount_pct ?? ""; el.max_price.value = r.max_price ?? "";
      $$("input[name=stores]", form).forEach((c) => (c.checked = (r.stores || []).map(String).includes(c.value)));
      $("#rf-h").textContent = "Regel bearbeiten"; box.open = true; form.elements.namedItem("name").focus(); box.scrollIntoView({ block: "start" });
    }));
    $("#exp")?.addEventListener("click", () => { download("watchlist.json", exportJSON(), "application/json"); toast("watchlist.json heruntergeladen.", 6000); });
    $("#bnotify").addEventListener("change", async (e) => {
      if (e.target.checked && "Notification" in window && Notification.permission !== "granted") { const p = await Notification.requestPermission(); if (p !== "granted") { e.target.checked = false; toast("Browser-Benachrichtigungen wurden nicht erlaubt."); return; } }
      lsSet(LS.notify, e.target.checked); if (e.target.checked) markHitsSeen();
    });
  }

  /* ---------- Statistik ---------- */
  function bars(rows, { fmt = nf0.format, cls = "", max } = {}) {
    const m = max ?? Math.max(1, ...rows.map((r) => r.v));
    return `<div class="bars">${rows.map((r) => `<span class="l" title="${esc(r.l)}">${esc(r.l)}</span><span class="b"><i class="${cls}" style="width:${(r.v / m) * 100}%"></i></span><span class="v">${esc(fmt(r.v))}</span>`).join("")}</div>`;
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
  async function renderStatistik(query) {
    if (activeSource() === "none") return renderOnboarding();
    const p = new URLSearchParams(query || ""); const scope = p.get("scope") || "aktiv"; const tage = Number(p.get("tage") || 30);
    if (!S.repo.archiveLoaded && hasRepo()) { view.innerHTML = `<div class="toolbar"><h2>Statistik</h2></div><div class="skeleton"></div>`; await loadArchive(); }
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
    const byTitle = agg(set, (o) => o.title).slice(0, 15);
    const buckets = Array.from({ length: 10 }, (_, i) => ({ l: `${i * 10}–${i * 10 + 9} %`, v: 0 })); set.forEach((o) => { if (o.discount_pct != null) buckets[Math.min(9, Math.max(0, Math.floor(o.discount_pct / 10)))].v++; });
    const dwellBy = (keyFn) => { const m = new Map(); gone.forEach((o) => { const k = keyFn(o) || "–"; (m.get(k) || m.set(k, []).get(k)).push(days(o.first_seen, o.gone_at)); }); return [...m.entries()].filter(([, a]) => a.length >= 5).map(([l, a]) => ({ l, v: Math.round(median(a) * 10) / 10, n: a.length })).sort((a, b) => a.v - b.v).slice(0, 15); };
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
        <section class="chart"><header><div><h3>Häufigste Produkte</h3><p>nach Produktname, Top 15</p></div>${csvBtn("produkte")}</header>${bars(byTitle)}</section>
        <section class="chart"><header><div><h3>Verweildauer nach Zustand</h3><p>Median in Tagen, nur verschwundene</p></div>${csvBtn("verweil_zustand")}</header>${dwellCond.length ? bars(dwellCond, { fmt: (v) => nf0.format(v) + " T", cls: "bl" }) : "<p class='muted'>Noch zu wenige abgeschlossene Angebote.</p>"}</section>
        <section class="chart"><header><div><h3>Verweildauer nach Markt</h3><p>Median in Tagen – kurz = schnell vergriffen</p></div>${csvBtn("verweil_markt")}</header>${dwellStore.length ? bars(dwellStore, { fmt: (v) => nf0.format(v) + " T" }) : "<p class='muted'>Noch zu wenige abgeschlossene Angebote.</p>"}</section>
      </div>`;
    $$("[data-scope]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/statistik?scope=${b.dataset.scope}&tage=${tage}`; }));
    $("#tage").addEventListener("change", (e) => { location.hash = `#/statistik?scope=${scope}&tage=${e.target.value}`; });
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
  async function renderDaten(query) {
    const meta = S.repo.meta;
    const runs = (meta?.runs || []).slice(-48).reverse();
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
          ${st.map((s) => `<tr><td><a href="#/aktuell?s=${esc(s.id)}">${esc(s.name)}</a></td><td class="mono">${esc(s.id)}</td><td class="n">${s.active != null ? nf0.format(s.active) : "–"}</td><td>${esc(rel(s.last_ok))}</td><td class="muted" style="font-size:12.5px">${esc(s.last_error || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Noch keine Märkte erfasst.</td></tr>`}
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
        <p><b>Aufbewahrung.</b> Aktive Angebote bleiben bis zum Verschwinden gespeichert; verschwundene Angebote bleiben 30 Tage im Archiv. Alle Dateien liegen verschlüsselt auf dem Server und werden erst in diesem Browser entschlüsselt.</p>
        <h3 style="margin-top:20px">Felder</h3>
        <table class="tbl"><tbody>${DICT.map(([k, v]) => `<tr><td class="mono" style="white-space:nowrap">${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>
      </section>`;

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
    const tab = ["aktuell", "archiv", "merkliste", "statistik", "daten"].includes(name) ? name : "aktuell";
    $$(".tabs a").forEach((a) => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    S.shown = 120;
    const r = { aktuell: () => renderList("aktuell", query), archiv: () => renderList("archiv", query), merkliste: () => renderMerkliste(query), statistik: () => renderStatistik(query), daten: () => renderDaten(query) }[tab];
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
      S.repo.archiveLoaded = false;
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

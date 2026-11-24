/* Holt die verschlüsselten Daten (Fundgrube d/, Katalog k/), entschlüsselt sie lokal und beantwortet Anfragen der Seite. */
importScripts("lib.js");
const DEFAULT_BASE = "https://lepettre.github.io/zweite-chance/";
const RECHECK_MS = 30 * 60 * 1000;

async function settings() {
  const o = await chrome.storage.local.get(["base", "key"]);
  return { base: (o.base || DEFAULT_BASE).replace(/\/?$/, "/"), key: o.key || null };
}
async function getBin(url, key) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  try { return await ZCX.openBlob(await r.arrayBuffer(), key); } catch { const e = new Error("Passwort stimmt nicht"); e.auth = true; throw e; }
}

// Index im Speicher + chrome.storage (damit er Neustarts des Hintergrundprozesses übersteht)
let memo = null;
async function ensureIndex(force) {
  const { base, key } = await settings();
  if (!key) return { error: "Noch nicht eingerichtet: Passwort in den Einstellungen eintragen." };
  const cached = memo || (await chrome.storage.local.get("idx")).idx || null;
  if (cached && !force && Date.now() - cached.checked < RECHECK_MS && cached.base === base) return (memo = cached);
  const ck = await ZCX.importKey(key);
  const meta = await getBin(`${base}d/meta.bin`, ck);
  let idx = cached && cached.base === base && cached.updated === meta.updated ? cached : null;
  if (!idx) {
    const stores = Object.fromEntries((meta.stores || []).map((s) => [s.id, s]));
    const v = encodeURIComponent(meta.current_version || meta.updated);
    const offers = ZCX.unpackOffers(await getBin(`${base}d/current.bin?v=${v}`, ck), stores);
    idx = { base, updated: meta.updated, byArt: ZCX.buildIndex(offers), n: offers.length };
  }
  try {                                                      // Katalog ist optional
    const km = await getBin(`${base}k/meta.bin`, ck);
    if (!idx.kat || idx.katUpdated !== km.updated) {
      idx.kat = ZCX.unpackKatalog(await getBin(`${base}k/items.bin?v=${encodeURIComponent(km.items_version || km.updated)}`, ck));
      idx.katUpdated = km.updated;
    }
  } catch (e) { if (e.auth) throw e; idx.kat = idx.kat || null; }
  idx.checked = Date.now();
  await chrome.storage.local.set({ idx });
  return (memo = idx);
}

function answer(idx, art) {
  if (idx.error) return idx;
  const offers = (idx.byArt[art.replace(/^s/, "")] || []).slice(0, 25);
  return { updated: idx.updated, offers, kat: idx.kat ? idx.kat[art] || null : null, katalog: !!idx.kat };
}

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  (async () => {
    if (m.type === "lookup") return answer(await ensureIndex(false), m.art);
    if (m.type === "test") { memo = null; const idx = await ensureIndex(true); return idx.error ? idx : { ok: true, updated: idx.updated, n: idx.n, katalog: idx.kat ? Object.keys(idx.kat).length : 0 }; }
    if (m.type === "clear") { memo = null; await chrome.storage.local.remove("idx"); return { ok: true }; }
  })().then(send).catch((e) => send({ error: e.auth ? "Das Passwort stimmt nicht." : `Daten nicht abrufbar (${e.message}). Adresse und Passwort prüfen.` }));
  return true;
});

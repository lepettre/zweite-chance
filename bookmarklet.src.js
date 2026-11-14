(async () => {
  const TRACKER = "__TRACKER_URL__";
  const API = "https://web-api.ikea.com/circular/circular-asis";
  const CID = "d530fa19-39b9-4f3f-9276-61146d470502";
  if (!/(^|\.)ikea\.com$/.test(location.hostname)) { alert("Bitte zuerst eine Seite auf ikea.com/de öffnen (z. B. den Zweite-Chance-Markt) und dann das Lesezeichen klicken."); return; }
  const win = window.open(TRACKER + "#/daten?import=1", "zweite-chance-monitor");
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;padding:14px 16px;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;border-radius:6px;box-shadow:0 6px 30px rgba(0,0,0,.35)";
  document.body.appendChild(box);
  const say = (t) => { box.innerHTML = "<b>Zweite-Chance-Monitor</b><br>" + t; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (url) => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(url, { headers: { "x-client-id": CID, accept: "application/json" } });
      if (r.ok) return r.json();
      if (r.status === 403 || r.status === 429) throw new Error("HTTP " + r.status + " (gesperrt/Rate-Limit)");
      await sleep(1500 * (i + 1));
    }
    throw new Error("Abruf fehlgeschlagen: " + url);
  };
  try {
    say("Lade Marktliste …");
    const raw = await get(API + "/api/public/stores/de");
    const stores = raw.filter((s) => s.active !== false).map((s) => ({ id: String(s.store_id || s.storeId || s.id), name: String(s.name || "").replace(/^IKEA\s+/i, "").trim() }));
    const results = {}; let n = 0, k = 0;
    for (const s of stores) {
      k++;
      try {
        const content = []; let page = 0;
        while (page < 60) {
          const d = await get(`${API}/offers/grouped/search?languageCode=de&size=64&storeIds=${s.id}&page=${page}`);
          content.push(...d.content);
          if (d.last === true || (d.totalPages != null && page + 1 >= d.totalPages) || d.content.length < 64) break;
          page++; await sleep(350);
        }
        results[s.id] = { ok: true, content, pages: page + 1 };
        n += content.reduce((a, g) => a + (g.offers || []).length, 0);
      } catch (e) {
        results[s.id] = { ok: false, error: String(e.message || e) };
        if (/HTTP 4(03|29)/.test(e.message)) { for (const r of stores) if (!results[r.id]) results[r.id] = { ok: false, error: "übersprungen nach Sperre" }; break; }
      }
      say(`Markt ${k}/${stores.length}: ${s.name}<br>${n.toLocaleString("de-DE")} Angebote bisher`);
      await sleep(300);
    }
    const snap = { schema: 1, source: "bookmarklet", country: "de", fetched_at: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"), stores, results };
    const blob = new Blob([JSON.stringify(snap)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "zweite-chance-" + snap.fetched_at.slice(0, 16).replace(/[:T]/g, "-") + ".json";
    let sent = false;
    const onMsg = (ev) => { if (ev.data === "zc-ready" && win && !sent) { sent = true; win.postMessage({ type: "zc-snapshot", snapshot: snap }, "*"); } if (ev.data === "zc-imported") { say(`✓ ${n.toLocaleString("de-DE")} Angebote übertragen und gespeichert.`); setTimeout(() => box.remove(), 6000); } };
    window.addEventListener("message", onMsg);
    if (win) win.postMessage("zc-hello", "*");
    say(`${n.toLocaleString("de-DE")} Angebote aus ${stores.length} Märkten geladen.<br>Übertrage an den Monitor … <a href="${a.href}" download="${a.download}" style="color:#ffdb00">Datei sichern</a>`);
    setTimeout(() => { if (!sent) { a.click(); say("Monitor-Fenster nicht erreichbar – Datei wurde heruntergeladen. Im Monitor unter <i>Daten → Import</i> einlesen oder in <code>inbox/</code> des Repos hochladen."); } }, 8000);
  } catch (e) { say("Fehler: " + (e.message || e)); }
})();

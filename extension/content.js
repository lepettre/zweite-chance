/* Blendet auf IKEA-Produktseiten eine kleine Karte ein: Fundgrube-Angebote + Preisentwicklung. */
(() => {
  let shown = null, host = null;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const eur = (v) => (v == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v));
  const day = (d) => (d ? new Date(d).toLocaleDateString("de-DE") : "–");
  const CSS = `:host{all:initial}.c{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:min(330px,calc(100vw - 32px));font:13px/1.4 system-ui,sans-serif;color:#16181D;background:#fff;border:1px solid #DFDBD1;border-left:5px solid #FFDB00;border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.22)}
  .h{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;font-weight:600}.h small{font-weight:400;color:#6B6F76;margin-left:auto}
  .b{padding:0 12px 10px;max-height:46vh;overflow:auto}.b[hidden]{display:none}
  .o{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:6px 0;border-top:1px solid #ECE9E2;text-decoration:none;color:inherit}.o:hover{background:#FFF9D6}
  .o b{font-size:14px}.m{color:#6B6F76;font-size:12px}.t{background:#FFDB00;border-radius:2px;padding:0 5px;font-size:12px;font-weight:700;align-self:start}
  .p{border-top:1px solid #ECE9E2;margin-top:4px;padding-top:6px;color:#3D4149}.x{margin-left:4px;cursor:pointer;color:#6B6F76}`;

  function render(art, r) {
    host?.remove();
    host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const n = r.offers?.length || 0, k = r.kat;
    let body = "";
    if (r.error) body = `<div class="m" style="padding:6px 0">${esc(r.error)} <a href="${chrome.runtime.getURL("options.html")}" target="_blank" style="color:#0058A3">Einstellungen</a></div>`;
    else {
      body = n ? r.offers.map((o) => `<a class="o" href="${esc(o.link)}" target="_blank" rel="noopener"><b>${esc(o.store)}</b><b>${eur(o.price)}</b>
        <span class="m">${esc([o.condition, o.reason].filter(Boolean).join(" · ") || o.desc)}</span><span>${o.pct != null ? `<span class="t">−${Math.round(o.pct)} %</span>` : ""}</span></a>`).join("")
        : `<div class="m" style="padding:6px 0">Dieser Artikel ist gerade in keinem Markt in der Fundgrube.</div>`;
      if (k) body += `<div class="p"><b>Preis bei IKEA:</b> ${eur(k.price)}${k.prev ? ` (vorher ${eur(k.prev)})` : ""}${k.changes ? `<br>Spanne ${eur(k.lo)} – ${eur(k.hi)} · ${k.changes} Änderung${k.changes === 1 ? "" : "en"}${k.last_change ? `, zuletzt ${day(k.last_change)}` : ""}` : `<br>Preis unverändert seit ${day(k.since)}`}${k.last ? "<br><b>Letzte Chance</b> laut IKEA" : ""}${k.status === "gone" ? "<br><b>Nicht mehr im Sortiment</b>" : ""}</div>`;
    }
    const title = r.error ? "Zweite Chance" : n ? `Fundgrube: ${n}× ab ${eur(r.offers[0].price)}` : "Fundgrube: nicht vorrätig";
    root.innerHTML = `<style>${CSS}</style><div class="c"><div class="h"><span>${esc(title)}</span><small>${r.updated ? "Stand " + day(r.updated) : ""}</small><span class="x" title="Schließen">schließen</span></div><div class="b" ${n || r.error || k ? "" : "hidden"}>${body}</div></div>`;
    const b = root.querySelector(".b");
    root.querySelector(".h").addEventListener("click", (e) => { if (e.target.classList.contains("x")) host.remove(); else b.hidden = !b.hidden; });
    document.documentElement.appendChild(host);
  }

  const artFromUrl = (u) => { const m = /-(s?\d{8})\/?(?:[?#].*)?$/.exec(u); return m ? m[1] : null; };
  async function run() {
    const art = artFromUrl(location.href);
    if (!art || art === shown) return;
    shown = art;
    try { render(art, await chrome.runtime.sendMessage({ type: "lookup", art })); }
    catch (e) { render(art, { error: "Die Erweiterung konnte nicht antworten. Seite neu laden." }); }
  }
  run();
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; shown = null; run(); } }, 1000);
})();

const $ = (id) => document.getElementById(id);
const say = (t, ok) => { $("msg").className = ok ? "ok" : "bad"; $("msg").textContent = t; };
chrome.storage.local.get(["base"]).then((o) => { $("base").value = o.base || ""; });
$("save").addEventListener("click", async () => {
  const base = ($("base").value.trim() || "https://lepettre.github.io/zweite-chance/").replace(/\/?$/, "/");
  try {
    const origin = new URL(base).origin + "/*";
    if (!(await chrome.permissions.contains({ origins: [origin] }))) {
      if (!(await chrome.permissions.request({ origins: [origin] }))) return say("Ohne Zugriff auf diese Adresse kann ich keine Daten holen.");
    }
    const upd = { base };
    if ($("pw").value) upd.key = await ZCX.deriveKeyB64($("pw").value);
    await chrome.storage.local.set(upd);
    say("Prüfe …", true);
    const r = await chrome.runtime.sendMessage({ type: "test" });
    if (r.error) return say(r.error);
    say(`Verbunden. Fundgrube: ${r.n.toLocaleString("de-DE")} Angebote (Stand ${new Date(r.updated).toLocaleString("de-DE")}). ` + (r.katalog ? `Katalog: ${r.katalog.toLocaleString("de-DE")} Artikel.` : "Katalog noch nicht vorhanden."), true);
    $("pw").value = "";
  } catch (e) { say(`Fehler: ${e.message}`); }
});
$("clear").addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "clear" }); say("Zwischenspeicher geleert.", true); });

// Cloudflare Worker: Telegram-Eingang, Merkliste (KV) und stündlicher Auslöser.
// Bindings/Secrets: siehe worker/wrangler.toml.example
//   KV       WL                  (Merkliste)
//   Secret   ACCESS_PASSWORD     dasselbe Passwort wie ZC_PASSWORD
//   Secret   GH_TOKEN            GitHub-Token (nur Actions: Read and write auf dieses Repo)
//   Secret   TG_SECRET           beliebiger Zufallstext, auch bei setWebhook als secret_token
//   Var      GH_REPO             z. B. "name/repo"
//   Var      TELEGRAM_CHAT_ID    nur dieser Chat darf fragen
//   Var      GH_REF              Branch mit den Workflows (Standard: main)

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" },
});

function same(a, b) {                       // zeitkonstanter Vergleich
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

async function dispatch(env, workflow, inputs) {
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "zc-worker", "content-type": "application/json",
    },
    body: JSON.stringify({ ref: env.GH_REF || "main", inputs: inputs || {} }),
  });
  if (!r.ok) console.log("dispatch", workflow, r.status, (await r.text()).slice(0, 200));
  return r.ok;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env, "scrape.yml"));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: {
        "access-control-allow-origin": "*", "access-control-allow-headers": "x-key, x-confirm-delete, content-type",
        "access-control-allow-methods": "GET, PUT, OPTIONS", "access-control-max-age": "86400" } });
    }

    // --- Merkliste (Web-App + Tracker) ---
    if (url.pathname === "/api/watchlist") {
      if (!same(req.headers.get("x-key"), env.ACCESS_PASSWORD)) return json({ error: "unauthorized" }, 401);
      if (req.method === "GET") return json((await env.WL.get("watchlist", "json")) || { rules: [], groups: {} });
      if (req.method === "PUT") {
        const body = await req.json().catch(() => null);
        if (!body || !Array.isArray(body.rules) || body.rules.length > 500) return json({ error: "bad request" }, 400);
        const clean = { rules: body.rules, groups: body.groups && typeof body.groups === "object" ? body.groups : {} };
        const old = await env.WL.get("watchlist", "json");
        // Es geht nichts verloren: weniger Regeln nur mit ausdrücklicher (doppelter) Bestätigung durch den Client.
        if (old && clean.rules.length < old.rules.length && req.headers.get("x-confirm-delete") !== "2") {
          return json({ error: "Löschen braucht doppelte Bestätigung" }, 409);
        }
        // Jeder überschriebene Stand bleibt als Version erhalten (wird nie automatisch gelöscht).
        if (old && JSON.stringify(old) !== JSON.stringify(clean)) {
          const id = `v:${new Date().toISOString()}:${Math.random().toString(36).slice(2, 6)}`;
          await env.WL.put(id, JSON.stringify(old), { metadata: { count: old.rules.length } });
        }
        await env.WL.put("watchlist", JSON.stringify(clean));
        return json({ ok: true, count: clean.rules.length });
      }
      return json({ error: "method" }, 405);
    }

    // --- frühere Stände der Merkliste (nur lesen; Wiederherstellen = normales PUT) ---
    if (url.pathname === "/api/history" && req.method === "GET") {
      if (!same(req.headers.get("x-key"), env.ACCESS_PASSWORD)) return json({ error: "unauthorized" }, 401);
      const id = url.searchParams.get("id");
      if (id) return json((await env.WL.get(id, "json")) || { error: "unbekannt" });
      const list = await env.WL.list({ prefix: "v:" });
      return json(list.keys.map((k) => ({ id: k.name, ts: k.name.slice(2, 26), count: k.metadata?.count ?? null })).reverse().slice(0, 200));
    }

    // --- Telegram-Webhook: Text an den Bot-Workflow weiterreichen ---
    if (url.pathname === "/tg" && req.method === "POST") {
      if (!same(req.headers.get("x-telegram-bot-api-secret-token"), env.TG_SECRET)) return new Response("no", { status: 401 });
      const upd = await req.json().catch(() => ({}));
      const msg = upd.message || upd.edited_message;
      if (msg?.text && String(msg.chat?.id) === String(env.TELEGRAM_CHAT_ID)) {
        ctx.waitUntil(dispatch(env, "bot.yml", { text: msg.text.slice(0, 300) }));
      }
      return new Response("ok");
    }

    return new Response("ok");
  },
};

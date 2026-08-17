/**
 * Tiny Exa search proxy for Warm Reception Live (GitHub Pages).
 * Deploy on Cloudflare Workers. Set secret EXA_API_KEY.
 *
 * Origin allowlist is friction, not a lock. Never return the Exa key.
 * Do not accept a browser-supplied Exa key.
 *
 * GET /search?q=legaltech+funding&num=5
 * Returns { results: [{ title, url, publishedDate, text }] } with CORS
 * only for allowed origins (never *).
 *
 * Prefer the production gateway (prod-api/) for Live. This worker remains
 * for the old Exa-only URL until that Settings field is switched.
 */

function parseAllowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || "";
  const list = raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (list.length) return list;
  return ["https://skirotica.github.io"];
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin"
  };
}

export default {
  async fetch(request, env) {
    const allowed = parseAllowedOrigins(env);
    const origin = request.headers.get("Origin") || "";
    if (!origin || allowed.indexOf(origin) === -1) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", Vary: "Origin" }
      });
    }
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/search" && url.pathname !== "/") {
      return new Response(JSON.stringify({ error: "Not found. Use /search" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (!env.EXA_API_KEY) {
      return new Response(JSON.stringify({ error: "EXA_API_KEY secret not set on worker" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/" ) {
      return new Response(JSON.stringify({ ok: true, routes: ["/search"] }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const q =
      url.searchParams.get("q") ||
      "Legaltech startup Series A Series B funding OR CRO VP Sales executive hire announcement";
    const num = Math.min(Math.max(parseInt(url.searchParams.get("num") || "6", 10) || 6, 1), 10);

    const upstream = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.EXA_API_KEY,
        "x-api-key": env.EXA_API_KEY
      },
      body: JSON.stringify({
        query: q,
        numResults: num,
        type: "auto",
        contents: {
          text: { maxCharacters: 1200 },
          highlights: { maxCharacters: 800 }
        }
      })
    });

    const raw = await upstream.json().catch(function () {
      return null;
    });
    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: (raw && (raw.error || raw.message)) || "Exa request failed",
          status: upstream.status
        }),
        {
          status: upstream.status,
          headers: { ...cors, "Content-Type": "application/json" }
        }
      );
    }

    const results = ((raw && raw.results) || []).map(function (r) {
      var text = "";
      if (r.text) text = String(r.text);
      else if (r.highlights && r.highlights.length) text = r.highlights.join(" ");
      return {
        title: r.title || "",
        url: r.url || "",
        publishedDate: r.publishedDate || r.published_date || "",
        text: text.slice(0, 1600)
      };
    });

    return new Response(JSON.stringify({ query: q, results: results }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};

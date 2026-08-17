/**
 * Production API gateway for Warm Reception Live (GitHub Pages).
 *
 * Holds provider keys as Cloudflare Worker secrets. Never returns keys.
 * live/index.html calls this worker. The class demo at site root does not.
 *
 * Step 4: PARTNER_ACCESS_CODE is a Worker secret. Partners type it in Live.
 * It is not in the HTML. GET / (health) stays open. Run, Exa, and Hunter
 * require the code. The Live HTML is still a public GitHub Pages file
 * (queue names visible). Cloudflare Access is the stronger follow-on.
 *
 * Hunter stays disabled while HUNTER_ENABLED is not "true". Privacy review:
 * Hunter stays off on public Pages until the tool is private.
 *
 * Routes:
 *   GET  /                 health (no secrets)
 *   POST /v1/messages      Anthropic Messages proxy
 *   GET  /search           Exa search proxy
 *   GET  /domain-search    Hunter (disabled unless HUNTER_ENABLED=true)
 *   GET  /email-finder     Hunter (disabled unless HUNTER_ENABLED=true)
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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Partner-Access",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

function hunterEnabled(env) {
  return String((env && env.HUNTER_ENABLED) || "").toLowerCase() === "true";
}

function partnerCodeConfigured(env) {
  return String((env && env.PARTNER_ACCESS_CODE) || "").length > 0;
}

function partnerCodeMatches(request, env) {
  const expected = String((env && env.PARTNER_ACCESS_CODE) || "");
  const got = String(request.headers.get("X-Partner-Access") || "");
  if (!expected || !got || expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return diff === 0;
}

function requirePartnerAccess(request, env, cors) {
  if (!partnerCodeConfigured(env)) {
    return jsonResponse(
      {
        error: "Partner access code not set on worker",
        detail: "Run: npx wrangler secret put PARTNER_ACCESS_CODE"
      },
      503,
      cors
    );
  }
  if (!partnerCodeMatches(request, env)) {
    return jsonResponse(
      {
        error: "Partner access required",
        detail: "Paste the partner access code in Live and click Save code. Do not paste Anthropic keys."
      },
      401,
      cors
    );
  }
  return null;
}

async function proxyAnthropic(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY secret not set on worker" }, 500, cors);
  }
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Request body must be JSON" }, 400, cors);
  }
  if (!payload || typeof payload !== "object") {
    return jsonResponse({ error: "Request body must be a JSON object" }, 400, cors);
  }
  // Ignore any key the browser might send. Only the Worker secret is used.
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

async function proxyExa(url, env, cors) {
  if (!env.EXA_API_KEY) {
    return jsonResponse({ error: "EXA_API_KEY secret not set on worker" }, 500, cors);
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
  const raw = await upstream.json().catch(function () { return null; });
  if (!upstream.ok) {
    return jsonResponse(
      {
        error: (raw && (raw.error || raw.message)) || "Exa request failed",
        status: upstream.status
      },
      upstream.status,
      cors
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
  return jsonResponse({ query: q, results: results }, 200, cors);
}

function hunterDisabledResponse(cors) {
  return jsonResponse(
    {
      error: "Hunter is disabled on the public live page",
      detail:
        "Privacy review: Hunter stays off on GitHub Pages until the tool is private (Cloudflare Access or partner sign-in). Set HUNTER_ENABLED=true only after that."
    },
    403,
    cors
  );
}

async function proxyHunter(url, path, env, cors) {
  if (!hunterEnabled(env)) return hunterDisabledResponse(cors);
  if (url.searchParams.get("api_key")) {
    return jsonResponse({ error: "Do not send provider keys to this worker" }, 400, cors);
  }
  let apiKey;
  let hunterUrl;
  if (path === "/email-finder") {
    apiKey = env.HUNTER_EMAIL_FINDER_KEY || env.HUNTER_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "HUNTER_EMAIL_FINDER_KEY (or HUNTER_API_KEY) secret not set" }, 500, cors);
    }
    hunterUrl = new URL("https://api.hunter.io/v2/email-finder");
    hunterUrl.searchParams.set("api_key", apiKey);
    const domain = url.searchParams.get("domain") || "";
    const first = url.searchParams.get("first_name") || "";
    const last = url.searchParams.get("last_name") || "";
    const linkedin = url.searchParams.get("linkedin_handle") || "";
    if (domain) hunterUrl.searchParams.set("domain", domain);
    if (first) hunterUrl.searchParams.set("first_name", first);
    if (last) hunterUrl.searchParams.set("last_name", last);
    if (linkedin) hunterUrl.searchParams.set("linkedin_handle", linkedin);
  } else {
    apiKey = env.HUNTER_DOMAIN_SEARCH_KEY || env.HUNTER_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "HUNTER_DOMAIN_SEARCH_KEY (or HUNTER_API_KEY) secret not set" }, 500, cors);
    }
    hunterUrl = new URL("https://api.hunter.io/v2/domain-search");
    hunterUrl.searchParams.set("api_key", apiKey);
    const domain = url.searchParams.get("domain") || "";
    const limit = url.searchParams.get("limit") || "10";
    if (domain) hunterUrl.searchParams.set("domain", domain);
    hunterUrl.searchParams.set("limit", limit);
  }
  const upstream = await fetch(hunterUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

export default {
  async fetch(request, env) {
    const allowed = parseAllowedOrigins(env);
    const origin = request.headers.get("Origin") || "";
    if (!origin || allowed.indexOf(origin) === -1) {
      return jsonResponse(
        { error: "Origin not allowed" },
        403,
        { "Content-Type": "application/json", Vary: "Origin" }
      );
    }
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/" && request.method === "GET") {
      return jsonResponse(
        {
          ok: true,
          service: "warm-reception-prod-api",
          hunter: hunterEnabled(env) ? "enabled" : "disabled",
          partner_gate: partnerCodeConfigured(env) ? "required" : "not_configured",
          routes: ["/v1/messages", "/search", "/domain-search", "/email-finder"]
        },
        200,
        cors
      );
    }

    const gate = requirePartnerAccess(request, env, cors);
    if (gate) return gate;

    if (path === "/v1/messages") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Use POST /v1/messages" }, 405, cors);
      }
      return proxyAnthropic(request, env, cors);
    }

    if (path === "/search") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Use GET /search" }, 405, cors);
      }
      return proxyExa(url, env, cors);
    }

    if (path === "/domain-search" || path === "/email-finder") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Use GET " + path }, 405, cors);
      }
      return proxyHunter(url, path, env, cors);
    }

    return jsonResponse({ error: "Not found" }, 404, cors);
  }
};

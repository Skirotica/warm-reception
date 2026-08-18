/**
 * Production API gateway for Warm Reception Live (GitHub Pages).
 *
 * Holds provider keys as Cloudflare Worker secrets. Never returns keys.
 * live/index.html calls this worker. The class demo at site root does not.
 *
 * Step 4: PARTNER_ACCESS_CODE is a Worker secret. Partners type it in Live.
 * It is not in the HTML. GET / (health) stays open. Run, Exa, and Hunter
 * require the code. GitHub Pages Live stays public HTML. Cloudflare Access
 * plus One-time PIN lock private Live (warm-reception-live.pages.dev).
 *
 * Hunter requires HUNTER_ENABLED=true AND a non-github.io Origin.
 * github.io may call Anthropic only. Exa, store, and Hunter routes 403
 * from github.io so public GitHub Live stays synthetic.
 *
 * Routes:
 *   GET  /                 health (no secrets)
 *   POST /v1/messages      Anthropic Messages proxy
 *   GET  /search           Exa search proxy
 *   GET  /domain-search    Hunter (HUNTER_ENABLED=true; 403 if Origin is github.io)
 *   GET  /email-finder     Hunter (HUNTER_ENABLED=true; 403 if Origin is github.io)
 */

function parseAllowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || "";
  const list = raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (list.length) return list;
  return ["https://skirotica.github.io"];
}

function originAllowed(origin, allowed) {
  if (!origin) return false;
  if (allowed.indexOf(origin) !== -1) return true;
  try {
    var host = new URL(origin).hostname.toLowerCase();
    // Preview deploys are https://<hash>.warm-reception-live.pages.dev
    if (/(^|\.)warm-reception-live\.pages\.dev$/.test(host)) return true;
  } catch (e) { /* ignore */ }
  return false;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
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

function hunterKeyConfigured(env) {
  return !!(env && (env.HUNTER_API_KEY || env.HUNTER_DOMAIN_SEARCH_KEY || env.HUNTER_EMAIL_FINDER_KEY));
}

function hunterKeyMissingResponse(cors) {
  return jsonResponse(
    {
      error: "Hunter key not set on worker",
      code: "hunter_key_missing",
      detail: "From prod-api run: npx wrangler secret put HUNTER_API_KEY. Do not put the key in the page."
    },
    500,
    cors
  );
}

function hunterGithubOrigin(origin) {
  try {
    return /github\.io$/i.test(new URL(origin).hostname);
  } catch (e) {
    return false;
  }
}

function githubIoPublicBlocked(cors, feature) {
  return jsonResponse(
    {
      error: feature + " is disabled for GitHub Pages",
      detail: "Privacy review: real company data stays on the Access-protected Live site. Public GitHub Live is synthetic only."
    },
    403,
    cors
  );
}

function partnerCodeConfigured(env) {
  return String((env && env.PARTNER_ACCESS_CODE) || "").trim().length > 0;
}

function partnerCodeMatches(request, env) {
  const expected = String((env && env.PARTNER_ACCESS_CODE) || "").trim();
  const got = String(request.headers.get("X-Partner-Access") || "").trim();
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

function hunterDisabledResponse(cors, reason) {
  var github = reason === "github_io";
  return jsonResponse(
    {
      error: github
        ? "Hunter is disabled for GitHub Pages"
        : "Hunter is disabled on the public live page",
      detail: github
        ? "Privacy review: Hunter stays off on github.io even when HUNTER_ENABLED is true. Use the private Cloudflare Pages Live URL."
        : "Privacy review: Hunter stays off until HUNTER_ENABLED=true on the Worker after Cloudflare Access."
    },
    403,
    cors
  );
}

async function proxyHunter(url, path, env, cors, origin) {
  if (hunterGithubOrigin(origin)) return hunterDisabledResponse(cors, "github_io");
  if (!hunterEnabled(env)) return hunterDisabledResponse(cors);
  if (url.searchParams.get("api_key")) {
    return jsonResponse({ error: "Do not send provider keys to this worker" }, 400, cors);
  }
  let apiKey;
  let hunterUrl;
  if (path === "/email-finder") {
    apiKey = env.HUNTER_EMAIL_FINDER_KEY || env.HUNTER_API_KEY;
    if (!apiKey) {
      return hunterKeyMissingResponse(cors);
    }
    hunterUrl = new URL("https://api.hunter.io/v2/email-finder");
    hunterUrl.searchParams.set("api_key", apiKey);
    const domain = url.searchParams.get("domain") || "";
    const first = url.searchParams.get("first_name") || "";
    const last = url.searchParams.get("last_name") || "";
    const fullName = url.searchParams.get("full_name") || "";
    const company = url.searchParams.get("company") || "";
    const linkedin = url.searchParams.get("linkedin_handle") || "";
    if (domain) hunterUrl.searchParams.set("domain", domain);
    if (first) hunterUrl.searchParams.set("first_name", first);
    if (last) hunterUrl.searchParams.set("last_name", last);
    if (fullName) hunterUrl.searchParams.set("full_name", fullName);
    if (company) hunterUrl.searchParams.set("company", company);
    if (linkedin) hunterUrl.searchParams.set("linkedin_handle", linkedin);
  } else {
    apiKey = env.HUNTER_DOMAIN_SEARCH_KEY || env.HUNTER_API_KEY;
    if (!apiKey) {
      return hunterKeyMissingResponse(cors);
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

function storeMissing(cors) {
  return jsonResponse(
    {
      error: "Store not configured",
      detail: "Create D1 with wrangler d1 create warm-reception, paste database_id in wrangler.toml, run schema.sql, then deploy."
    },
    503,
    cors
  );
}

async function kvGet(env, key) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(key).first();
  if (!row || !row.v) return null;
  try {
    return JSON.parse(row.v);
  } catch (e) {
    return null;
  }
}

async function kvPut(env, key, value) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at"
  ).bind(key, JSON.stringify(value), now).run();
}

async function storeSnapshot(env, cors) {
  if (!env.DB) return storeMissing(cors);
  try {
    const audit = await env.DB.prepare(
      "SELECT created_at, case_id, company_name, agent_decision, human_action, detail FROM audit ORDER BY id DESC LIMIT 200"
    ).all();
    const rows = (audit && audit.results) || [];
    return jsonResponse(
      {
        ok: true,
        audit: rows.slice().reverse(),
        extras: (await kvGet(env, "extras")) || {
          events: [],
          profiles: [],
          contacts: [],
          statuses: [],
          employment: []
        },
        voice: (await kvGet(env, "voice")) || null,
        results: (await kvGet(env, "results")) || {},
        clients: (await kvGet(env, "clients")) || []
      },
      200,
      cors
    );
  } catch (e) {
    return jsonResponse(
      { error: "Store read failed", detail: String((e && e.message) || e) },
      500,
      cors
    );
  }
}

async function storeAudit(request, env, cors) {
  if (!env.DB) return storeMissing(cors);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "JSON required" }, 400, cors);
  }
  const created = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO audit (created_at, case_id, company_name, agent_decision, human_action, detail) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        created,
        String((body && body.case_id) || "").slice(0, 64),
        String((body && body.company_name) || "").slice(0, 200),
        String((body && body.agent_decision) || "").slice(0, 200),
        String((body && body.human_action) || "").slice(0, 80),
        String((body && body.detail) || "").slice(0, 500)
      )
      .run();
    return jsonResponse({ ok: true, created_at: created }, 200, cors);
  } catch (e) {
    return jsonResponse(
      { error: "Store write failed", detail: String((e && e.message) || e) },
      500,
      cors
    );
  }
}

var BLOB_KEYS = { extras: true, voice: true, results: true, clients: true };

async function storePutBlob(request, env, cors, key) {
  if (!env.DB) return storeMissing(cors);
  if (!BLOB_KEYS[key]) return jsonResponse({ error: "Unknown store key" }, 400, cors);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "JSON required" }, 400, cors);
  }
  if (key === "clients" && !Array.isArray(body)) {
    return jsonResponse({ error: "clients must be an array" }, 400, cors);
  }
  try {
    await kvPut(env, key, body);
    return jsonResponse({ ok: true, key: key }, 200, cors);
  } catch (e) {
    return jsonResponse(
      { error: "Store write failed", detail: String((e && e.message) || e) },
      500,
      cors
    );
  }
}

export default {
  async fetch(request, env) {
    const allowed = parseAllowedOrigins(env);
    const origin = request.headers.get("Origin") || "";
    if (!originAllowed(origin, allowed)) {
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
          hunter_key: hunterKeyConfigured(env) ? "set" : "missing",
          partner_gate: partnerCodeConfigured(env) ? "required" : "not_configured",
          store: env.DB ? "d1" : "missing",
          routes: ["/v1/messages", "/search", "/domain-search", "/email-finder", "/store/snapshot", "/store/audit"]
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
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Exa");
      return proxyExa(url, env, cors);
    }

    if (path === "/domain-search" || path === "/email-finder") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Use GET " + path }, 405, cors);
      }
      return proxyHunter(url, path, env, cors, origin);
    }

    if (path === "/store/snapshot" && request.method === "GET") {
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Store");
      return storeSnapshot(env, cors);
    }
    if (path === "/store/audit" && request.method === "POST") {
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Store");
      return storeAudit(request, env, cors);
    }
    if (path.indexOf("/store/blob/") === 0 && request.method === "PUT") {
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Store");
      var key = path.slice("/store/blob/".length);
      return storePutBlob(request, env, cors, key);
    }

    return jsonResponse({ error: "Not found" }, 404, cors);
  }
};

/**
 * Hunter proxy for Warm Reception.
 * Deploy on Cloudflare Workers.
 *
 * Privacy: Hunter stays off on public GitHub Pages. Do not add
 * https://skirotica.github.io to ALLOWED_ORIGINS until the tool is private
 * (Cloudflare Access or partner sign-in, step 4/5).
 *
 * Origin allowlist is friction, not a lock. Never return API keys.
 * Do not accept a browser-supplied Hunter key (query api_key is rejected).
 *
 * Secrets:
 *   HUNTER_EMAIL_FINDER_KEY  — Email Finder product key
 *   HUNTER_DOMAIN_SEARCH_KEY — Domain Search product key
 * Fallback: HUNTER_API_KEY used for either route if the specific secret is missing.
 *
 * Routes:
 *   GET /email-finder?domain=&first_name=&last_name=&linkedin_handle=
 *   GET /domain-search?domain=&limit=10
 */

function parseAllowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || "";
  return raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
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
      return new Response(JSON.stringify({ errors: [{ details: "Origin not allowed" }] }), {
        status: 403,
        headers: { "Content-Type": "application/json", Vary: "Origin" }
      });
    }
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (url.searchParams.get("api_key")) {
      return new Response(
        JSON.stringify({ errors: [{ details: "Do not send a Hunter key to this worker" }] }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    let hunterUrl;
    let apiKey;

    if (path === "/email-finder" || path === "/") {
      apiKey = env.HUNTER_EMAIL_FINDER_KEY || env.HUNTER_API_KEY;
      if (!apiKey) {
        return new Response(
          JSON.stringify({
            errors: [{ details: "Set secret HUNTER_EMAIL_FINDER_KEY (or HUNTER_API_KEY) on this worker" }]
          }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
        );
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
      if (path === "/" && !domain && !first && !last && !linkedin) {
        return new Response(JSON.stringify({ ok: true, routes: ["/email-finder", "/domain-search"] }), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    } else if (path === "/domain-search") {
      apiKey = env.HUNTER_DOMAIN_SEARCH_KEY || env.HUNTER_API_KEY;
      if (!apiKey) {
        return new Response(
          JSON.stringify({
            errors: [{ details: "Set secret HUNTER_DOMAIN_SEARCH_KEY (or HUNTER_API_KEY) on this worker" }]
          }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      hunterUrl = new URL("https://api.hunter.io/v2/domain-search");
      hunterUrl.searchParams.set("api_key", apiKey);
      const domain = url.searchParams.get("domain") || "";
      const limit = url.searchParams.get("limit") || "10";
      if (domain) hunterUrl.searchParams.set("domain", domain);
      hunterUrl.searchParams.set("limit", limit);
    } else {
      return new Response(JSON.stringify({ errors: [{ details: "Not found. Use /email-finder or /domain-search" }] }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" }
      });
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
};

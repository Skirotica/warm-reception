/**
 * Tiny Hunter Email Finder proxy for Warm Reception (GitHub Pages).
 * Deploy on Cloudflare Workers. Set secret HUNTER_API_KEY to your Email Finder key.
 *
 * Expected request:
 *   GET /email-finder?domain=example.com&first_name=Ada&last_name=Lovelace
 * Response: Hunter's JSON passthrough (+ CORS for the Pages origin).
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/email-finder" && url.pathname !== "/") {
      return new Response(JSON.stringify({ errors: [{ details: "Not found. Use /email-finder" }] }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (!env.HUNTER_API_KEY) {
      return new Response(JSON.stringify({ errors: [{ details: "HUNTER_API_KEY secret not set on worker" }] }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const domain = url.searchParams.get("domain") || "";
    const first = url.searchParams.get("first_name") || "";
    const last = url.searchParams.get("last_name") || "";
    const linkedin = url.searchParams.get("linkedin_handle") || "";

    const hunterUrl = new URL("https://api.hunter.io/v2/email-finder");
    hunterUrl.searchParams.set("api_key", env.HUNTER_API_KEY);
    if (domain) hunterUrl.searchParams.set("domain", domain);
    if (first) hunterUrl.searchParams.set("first_name", first);
    if (last) hunterUrl.searchParams.set("last_name", last);
    if (linkedin) hunterUrl.searchParams.set("linkedin_handle", linkedin);

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

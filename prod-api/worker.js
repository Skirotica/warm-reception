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
 *   GET|POST /v1/sequence-dispatch  Sequence Dispatch Bot (post-approve email only)
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
    if (/(^|\.)blackgavel\.geetm\.ai$/.test(host)) return true;
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

function isGeetmManagedOrigin(origin) {
  try {
    return /(^|\.)blackgavel\.geetm\.ai$/i.test(new URL(origin).hostname);
  } catch (e) {
    return false;
  }
}

function partnerGateRequired(env, origin) {
  var gateMode = String((env && env.PARTNER_GATE) || "").trim().toLowerCase();
  if (gateMode === "off" || gateMode === "false" || gateMode === "disabled") return false;
  if (isGeetmManagedOrigin(origin)) return false;
  return partnerCodeConfigured(env);
}

function requirePartnerAccess(request, env, cors) {
  var origin = request.headers.get("Origin") || "";
  if (!partnerGateRequired(env, origin)) return null;
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

var EXA_DEFAULT_QUERY =
  "Legaltech Series A Series B funding OR CRO VP Sales executive hire announcement 2026";
var EXA_PUBLISHER_HOST_RE =
  /(law\.com|tech\.eu|prnewswire|linkedin|artificiallawyer|techfundingnews|pulse2|reuters|bloomberg|techcrunch|venturebeat|forbes|businesswire|globenewswire|yahoo\.com|medium\.com|substack\.com|latamlist\.com|latamrepublic\.com|thesaasnews\.com|finsmes\.com|crunchbase\.com|pitchbook\.com|axios\.com|sifted\.eu|tech\.eu|geekwire\.com|theregister\.com|zdnet\.com|wired\.com|theverge\.com|thenextweb\.com|tnw\.to|news\.yahoo|google\.com\/news|msn\.com|foundernews\.eu|foundernews|siliconrepublic\.com|siliconrepublic|globallegalpost\.com|globallegalpost|legaltech\.news|law360\.com|abovethelaw\.com|artificiallawyer\.com|techfundingnews\.com)/i;
/** VC / PE firm sites — never the outreach target when the article is about a portfolio company. */
var EXA_VC_HOST_RE =
  /(luxcapital\.com|a16z\.com|andreessen\.com|sequoiacap\.com|indexventures\.com|greylock\.com|accel\.com|benchmark\.com|lightspeedventure|bessemer\.com|khoslaventures\.com|firstround\.com|initialized\.com|ycombinator\.com|softbank\.com|generalcatalyst\.com|insightpartners\.com|baincapital|sequoia|andreessenhorowitz)/i;
var EXA_MEDIA_OR_VC_NAME_RE =
  /^(latamlist|latam\s*republic|latam\s*list|the\s*saas\s*news|saas\s*news|the\s*next\s*web|thenextweb|tnw|the\s*round|techcrunch|venturebeat|forbes|reuters|bloomberg|pr\s*newswire|business\s*wire|finsmes|crunchbase|pitchbook|axios|sifted|medium|substack|geekwire|wired|verge|yahoo|msn|foundernews|founder\s*news|silicon\s*republic|siliconrepublic|global\s*legal\s*post|globallegalpost|list|news|republic|ventures|capital|partners|fund|media|magazine|blog|company|startup|platform|publisher|press)$/i;
/** Customer / tool domains often named in PR copy. Never treat as the startup website. */
var EXA_CUSTOMER_PLATFORM_HOST_RE =
  /(^|\.)(monday\.com|salesforce\.com|hubspot\.com|slack\.com|notion\.so|asana\.com|atlassian\.com|jira\.com|zoom\.us|microsoft\.com|office\.com|google\.com|gmail\.com|outlook\.com|linkedin\.com|facebook\.com|twitter\.com|x\.com|apple\.com|amazon\.com|aws\.amazon\.com|dropbox\.com|box\.com|zendesk\.com|intercom\.com|stripe\.com|shopify\.com|docusign\.com|adobe\.com|oracle\.com|sap\.com|workday\.com|servicenow\.com)$/i;
/** Hard max age for live Exa company news before queueing. Age >= this many calendar days is rejected. */
var EXA_MAX_AGE_DAYS = 45;

function utcCalendarYmd(d) {
  var dt = d instanceof Date ? d : new Date(d || Date.now());
  if (isNaN(dt.getTime())) dt = new Date();
  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  var day = String(dt.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function exaStartPublishedDateIso(now) {
  var dt = now instanceof Date ? new Date(now.getTime()) : new Date(now || Date.now());
  if (isNaN(dt.getTime())) dt = new Date();
  var start = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - EXA_MAX_AGE_DAYS);
  return start.toISOString();
}

function parseExaEventDateYmd(raw) {
  var s = String(raw || "").trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var check = new Date(Date.UTC(y, mo - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== mo ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return m[1] + "-" + m[2] + "-" + m[3];
}

function calendarDaysOld(ymd, now) {
  var parsed = parseExaEventDateYmd(ymd);
  if (!parsed) return null;
  var parts = parsed.split("-");
  var eventUtc = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var todayYmd = utcCalendarYmd(now);
  var todayParts = todayYmd.split("-");
  var todayUtc = Date.UTC(Number(todayParts[0]), Number(todayParts[1]) - 1, Number(todayParts[2]));
  return Math.floor((todayUtc - eventUtc) / 86400000);
}

/**
 * Live Exa news must be younger than EXA_MAX_AGE_DAYS.
 * Missing or unparseable dates are rejected (safer than treating undated as new).
 */
function assessExaEventFreshness(publishedRaw, now) {
  var ymd = parseExaEventDateYmd(publishedRaw);
  if (!ymd) {
    return {
      ok: false,
      reason: "missing_or_unparseable_date",
      date: "",
      age_days: null
    };
  }
  var age = calendarDaysOld(ymd, now);
  if (age == null) {
    return { ok: false, reason: "missing_or_unparseable_date", date: ymd, age_days: null };
  }
  if (age >= EXA_MAX_AGE_DAYS) {
    return {
      ok: false,
      reason: "older_than_" + EXA_MAX_AGE_DAYS + "_days",
      date: ymd,
      age_days: age
    };
  }
  return { ok: true, reason: "fresh", date: ymd, age_days: age };
}

function isLiveExaQueueEvent(ev) {
  if (!ev) return false;
  if (ev.live_exa) return true;
  if (String(ev.case_id || "").indexOf("CE-LX-") === 0) return true;
  return String(ev.entity_note || "").indexOf("live_exa_refresh") !== -1;
}

function removeExtrasEventAndRelated(extras, caseId, companyId) {
  if (!extras) return;
  extras.events = (extras.events || []).filter(function (ev) {
    return !ev || (ev.case_id !== caseId && ev.company_id !== companyId);
  });
  extras.profiles = (extras.profiles || []).filter(function (p) {
    return !p || p.company_id !== companyId;
  });
  extras.contacts = (extras.contacts || []).filter(function (c) {
    return !c || c.company_id !== companyId;
  });
  extras.employment = (extras.employment || []).filter(function (e) {
    return !e || e.company_id !== companyId;
  });
  if (extras.attached_sources && caseId) {
    delete extras.attached_sources[caseId];
  }
}

/** Drop already-queued live Exa rows that are too old or undated. Leaves seed/demo alone (non-CE-LX). */
function purgeStaleLiveExaExtras(extras, now) {
  var dropped = 0;
  var reasons = [];
  if (!extras || !Array.isArray(extras.events)) return { dropped: 0, reasons: reasons };
  var doomed = [];
  (extras.events || []).forEach(function (ev) {
    if (!isLiveExaQueueEvent(ev)) return;
    // Keep embedded pilot seeds (CE-L01…) if they somehow appear; only purge refresh extras.
    if (String(ev.case_id || "").indexOf("CE-LX-") !== 0) return;
    var check = assessExaEventFreshness(ev.event_date, now);
    if (check.ok) return;
    doomed.push(ev);
    reasons.push({
      case_id: ev.case_id,
      company_name: ev.company_name,
      event_date: ev.event_date || "",
      reason: check.reason,
      age_days: check.age_days
    });
  });
  doomed.forEach(function (ev) {
    removeExtrasEventAndRelated(extras, ev.case_id, ev.company_id);
    dropped += 1;
  });
  return { dropped: dropped, reasons: reasons };
}

/**
 * Retarget Foundernews-style publisher rows to the funded company, then mark clear
 * non-legaltech subjects (Xapien / KYC) as Table 2 No-go so they leave Ambiguous.
 */
function scrubPublisherAndNonLegaltechExtras(extras, results) {
  results = results || {};
  var changed = false;
  var nogoCaseIds = [];
  if (!extras || !Array.isArray(extras.events)) {
    return { changed: false, nogo: nogoCaseIds, results: results };
  }
  (extras.events || []).forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    var nameIsPub = isMediaOrVcCompanyName(ev.company_name);
    var host = normalizeHost(ev.domain);
    var domainIsPub = !!(host && (EXA_PUBLISHER_HOST_RE.test(host) || isVcFirmHost(host)));
    if (nameIsPub || domainIsPub) {
      var resolved = resolvePublisherMisattribution(
        ev,
        ev.event_headline || "",
        ev.event_summary || "",
        ev.source_url || "",
        null
      );
      if (resolved && resolved.redirected) {
        changed = true;
        (extras.profiles || []).forEach(function (p) {
          if (!p || p.company_id !== ev.company_id) return;
          p.company_name = ev.company_name;
          p.domain = ev.domain;
        });
      } else if (resolved && resolved.publisher && !resolved.redirected) {
        // Still stuck on the magazine with no extractable subject: Table 2 publisher No-go.
        var existingPub = results[ev.case_id];
        var pubDec =
          existingPub && existingPub.lastFields && String(existingPub.lastFields.decision || "");
        if (!/^no-?go$/i.test(pubDec)) {
          results[ev.case_id] = {
            lastFields: publisherFalsePositiveFields(ev, ""),
            humanOutcome: "",
            humanStateText: "",
            archived: false,
            mode: "scrub_publisher"
          };
          nogoCaseIds.push(ev.case_id);
          changed = true;
        }
        return;
      }
    }
    var nonLegal = articleClearlyNonLegaltech(
      ev.event_headline || "",
      ev.event_summary || "",
      ev.company_name,
      ev.domain
    );
    if (!nonLegal) return;
    ev.sector = nonLegal.sector;
    (extras.profiles || []).forEach(function (p) {
      if (!p || p.company_id !== ev.company_id) return;
      p.sector = nonLegal.sector;
      p.notes = (p.notes ? p.notes + "; " : "") + "scrubbed_non_legaltech:" + nonLegal.sector;
    });
    var existing = results[ev.case_id];
    var decision = existing && existing.lastFields && String(existing.lastFields.decision || "");
    if (/^no-?go$/i.test(decision) || /^below\s*threshold$/i.test(decision)) return;
    results[ev.case_id] = {
      lastFields: {
        status: "OK",
        table: "Table 2",
        decision: "No-go",
        confidence_rating: "High",
        company_name: ev.company_name,
        domain: ev.domain || "",
        poc_name: "",
        poc_title: "",
        poc_email: "",
        fit_if_email_secured: "Still-blocked",
        fit_if_email_note: "Out of ICP sector even with email.",
        sector: nonLegal.sector,
        employee_count: "",
        revenue_estimate: "",
        vc_pe_backed: String(ev.vc_pe_backed || ""),
        ta_headcount: "",
        persona_assigned: "",
        persona_used: "",
        trigger_event: String(ev.event_type || ""),
        event_date: String(ev.event_date || ""),
        event_source_url: String(ev.source_url || ""),
        reason_or_ambiguity: "Out of ICP sector",
        override_available: "No",
        citations: String(ev.case_id || "") + ", icp-criteria.md",
        why:
          String(ev.company_name || "This company") +
          " is " +
          (nonLegal.label || "outside legaltech ICP") +
          ". Do not chase email for this case. Confirm No-Go to archive if you want it off the queue."
      },
      humanOutcome: "",
      humanStateText: "",
      archived: false,
      mode: "scrub_non_legaltech"
    };
    nogoCaseIds.push(ev.case_id);
    changed = true;
  });
  return { changed: changed, nogo: nogoCaseIds, results: results };
}

/**
 * One-shot store repair: merge publisher husks into the real startup, fix known
 * wrong domains (e.g. Chamelio → chamelio.ai), clear bad Hunter contacts.
 */
function repairMisattributedEntities(extras, results) {
  results = results || {};
  extras = extras || {};
  extras.events = extras.events || [];
  extras.profiles = extras.profiles || [];
  extras.contacts = extras.contacts || [];
  extras.employment = extras.employment || [];
  var changed = false;
  var actions = [];
  var doomed = [];

  function clearHunterContactsForCompanyId(companyId) {
    if (!companyId) return;
    var before = extras.contacts.length;
    extras.contacts = extras.contacts.filter(function (c) {
      if (!c || c.company_id !== companyId) return true;
      var via = String(c.discovered_via || "");
      if (via.indexOf("hunter") !== -1) return false;
      if (String(c.contact_id || "").indexOf("CT-H-") === 0) return false;
      var emailHost = String(c.email || "").split("@")[1] || "";
      if (emailHost && isCustomerPlatformHost(emailHost)) return false;
      if (emailHost && EXA_PUBLISHER_HOST_RE.test(emailHost)) return false;
      return true;
    });
    extras.employment = extras.employment.filter(function (e) {
      if (!e || e.company_id !== companyId) return true;
      return String(e.contact_id || "").indexOf("CT-H-") !== 0;
    });
    if (extras.contacts.length !== before) changed = true;
  }

  function clearAmbiguousResult(caseId, reason) {
    var rec = results[caseId];
    if (!rec || !rec.lastFields) return;
    // Partner Rerun is durable — never wipe it on hydrate repair.
    if (rec.partner_rerun || rec.last_rerun_at) {
      actions.push({
        action: "keep_partner_rerun",
        case_id: caseId,
        reason: reason || ""
      });
      return;
    }
    var dec = String(rec.lastFields.decision || "");
    if (/^go$/i.test(dec) && String(rec.humanOutcome || "").trim()) return;
    delete results[caseId];
    changed = true;
    actions.push({ action: "clear_result", case_id: caseId, reason: reason || "" });
  }

  function applyDomainFix(ev, correctDomain, reason) {
    var host = normalizeHost(correctDomain);
    if (!host || !looksLikeRealDomainWorker(host)) return false;
    if (normalizeHost(ev.domain) === host) return false;
    var from = String(ev.domain || "");
    ev.domain = host;
    var note = String(ev.entity_note || "");
    if (note.indexOf("domain_repaired:") === -1) {
      ev.entity_note =
        (note ? note + "; " : "") + "domain_repaired:" + (from || "blank") + "->" + host;
    }
    (extras.profiles || []).forEach(function (p) {
      if (!p || p.company_id !== ev.company_id) return;
      p.domain = host;
      p.company_name = ev.company_name;
    });
    (extras.statuses || []).forEach(function (s) {
      if (!s) return;
      if (
        sameCompanyWorker(s.company_name, s.domain, ev.company_name, from) ||
        sameCompanyWorker(s.company_name, s.domain, ev.company_name, host)
      ) {
        s.domain = host;
        s.company_name = ev.company_name;
      }
    });
    clearHunterContactsForCompanyId(ev.company_id);
    clearAmbiguousResult(ev.case_id, reason || "domain_repaired");
    changed = true;
    actions.push({
      action: "domain_fix",
      case_id: ev.case_id,
      company_name: ev.company_name,
      from: from,
      to: host
    });
    return true;
  }

  // Pass 1: known wrong-domain rows (Chamelio / monday.com).
  extras.events.forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    var slug = slugifyTokenWorker(ev.company_name).replace(/-/g, "");
    var host = normalizeHost(ev.domain);
    var known = knownSubjectDomainWorker(ev.company_name);
    if (
      (slug === "chamelio" || slug === "chameilo") &&
      (host === "monday.com" || isCustomerPlatformHost(host) || !host)
    ) {
      if (slug === "chameilo") ev.company_name = "Chamelio";
      // Fix domain only here. Do not wipe all Hunter contacts — Pass 4c keeps
      // chamelio.ai persona POCs (e.g. Ale Z. CEO) and promotes to Go.
      var fromCh = String(ev.domain || "");
      ev.domain = "chamelio.ai";
      var noteCh = String(ev.entity_note || "");
      if (noteCh.indexOf("domain_repaired:") === -1) {
        ev.entity_note =
          (noteCh ? noteCh + "; " : "") +
          "domain_repaired:" +
          (fromCh || "blank") +
          "->chamelio.ai";
      }
      (extras.profiles || []).forEach(function (p) {
        if (!p || p.company_id !== ev.company_id) return;
        p.company_name = "Chamelio";
        p.domain = "chamelio.ai";
      });
      extras.contacts = (extras.contacts || []).filter(function (c) {
        if (!c || c.company_id !== ev.company_id) return true;
        var emailHost = String(c.email || "").split("@")[1] || "";
        if (emailHost && (isCustomerPlatformHost(emailHost) || EXA_PUBLISHER_HOST_RE.test(emailHost))) {
          return false;
        }
        return true;
      });
      changed = true;
      actions.push({
        action: "domain_fix",
        case_id: ev.case_id,
        company_name: ev.company_name,
        from: fromCh,
        to: "chamelio.ai",
        reason: "chamelio_not_monday_keep_pocs"
      });
      return;
    }
    if (known && host && isCustomerPlatformHost(host)) {
      applyDomainFix(ev, known, "customer_platform_domain");
      return;
    }
    if (known && host && !domainMatchesCompanyWorker(ev.company_name, host)) {
      applyDomainFix(ev, known, "domain_mismatch");
    }
    if (host && (EXA_PUBLISHER_HOST_RE.test(host) || isVcFirmHost(host))) {
      // Handled in merge pass below.
      return;
    }
    if (host && isCustomerPlatformHost(host) && !known) {
      ev.domain = "";
      clearHunterContactsForCompanyId(ev.company_id);
      clearAmbiguousResult(ev.case_id, "cleared_customer_platform_domain");
      changed = true;
      actions.push({
        action: "clear_customer_domain",
        case_id: ev.case_id,
        company_name: ev.company_name,
        from: host
      });
    }
  });

  // Pass 1b: duplicate husks with the same cleaned name (e.g. Legal-tech Newcode
  // → Newcode) merge into the best row that already has a real domain.
  extras.events.forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    if (doomed.indexOf(ev) !== -1) return;
    var cleaned = cleanSubjectCompanyNameWorker(ev.company_name) || String(ev.company_name || "").trim();
    if (!cleaned || isMediaOrVcCompanyName(cleaned) || isPlaceholderCompanyNameWorker(cleaned)) return;
    var host = normalizeHost(ev.domain);
    var weak =
      !looksLikeRealDomainWorker(host) ||
      EXA_PUBLISHER_HOST_RE.test(host) ||
      isVcFirmHost(host) ||
      isCustomerPlatformHost(host);
    if (!weak) return;
    var best = null;
    for (var i = 0; i < extras.events.length; i++) {
      var other = extras.events[i];
      if (!other || other.case_id === ev.case_id) continue;
      if (doomed.indexOf(other) !== -1) continue;
      if (!sameCompanyWorker(cleaned, host, other.company_name, other.domain)) continue;
      var otherHost = normalizeHost(other.domain);
      var otherStrong =
        looksLikeRealDomainWorker(otherHost) &&
        !EXA_PUBLISHER_HOST_RE.test(otherHost) &&
        !isCustomerPlatformHost(otherHost);
      if (otherStrong) {
        best = other;
        break;
      }
      if (!best) best = other;
    }
    if (!best) return;
    attachStoryToEvent(best, {
      url: ev.source_url,
      title: ev.event_headline,
      text: ev.event_summary
    });
    if (Array.isArray(ev.source_urls)) {
      ev.source_urls.forEach(function (u) {
        attachStoryToEvent(best, { url: u });
      });
    }
    doomed.push(ev);
    clearAmbiguousResult(ev.case_id, "merged_duplicate_into_" + best.case_id);
    changed = true;
    actions.push({
      action: "merge_duplicate",
      from_case_id: ev.case_id,
      from_name: ev.company_name,
      to_case_id: best.case_id,
      to_name: best.company_name
    });
  });

  // Pass 2: publisher / placeholder husks → merge into real startup when present.
  extras.events.forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    var host = normalizeHost(ev.domain);
    var sourceHost = guessHostFromUrl(ev.source_url || "");
    var cleanedName = cleanSubjectCompanyNameWorker(ev.company_name);
    if (cleanedName && cleanedName !== ev.company_name) {
      ev.company_name = cleanedName;
      changed = true;
      actions.push({
        action: "clean_name",
        case_id: ev.case_id,
        company_name: cleanedName
      });
    }
    var nameIsPub =
      isMediaOrVcCompanyName(ev.company_name) || isPlaceholderCompanyNameWorker(ev.company_name);
    var domainIsPub = !!(host && (EXA_PUBLISHER_HOST_RE.test(host) || isVcFirmHost(host)));
    var sourceIsPub = !!(sourceHost && (EXA_PUBLISHER_HOST_RE.test(sourceHost) || isVcFirmHost(sourceHost)));
    // Empty domain + news source URL still counts as a publisher husk.
    if (!nameIsPub && !domainIsPub && !(sourceIsPub && !looksLikeRealDomainWorker(host))) return;

    var ident = extractCompanyFromExa(
      ev.event_headline || "",
      ev.event_summary || "",
      ev.source_url || ""
    );
    if (ident.company_name) {
      var cleanedIdent = cleanSubjectCompanyNameWorker(ident.company_name);
      if (cleanedIdent) ident.company_name = cleanedIdent;
    }
    if (!ident.company_name && cleanedName && !isMediaOrVcCompanyName(cleanedName)) {
      ident = { company_name: cleanedName, domain: knownSubjectDomainWorker(cleanedName) || "" };
    }
    if (!ident.company_name || isMediaOrVcCompanyName(ident.company_name)) {
      // Stuck on publisher: Table 2 No-go so it leaves Ambiguous.
      var existingPub = results[ev.case_id];
      var pubDec =
        existingPub && existingPub.lastFields && String(existingPub.lastFields.decision || "");
      if (!/^no-?go$/i.test(pubDec)) {
        results[ev.case_id] = {
          lastFields: publisherFalsePositiveFields(ev, ""),
          humanOutcome: "",
          humanStateText: "",
          archived: false,
          mode: "repair_publisher"
        };
        changed = true;
        actions.push({ action: "publisher_nogo", case_id: ev.case_id, domain: host || sourceHost });
      }
      return;
    }

    var target = null;
    for (var i = 0; i < extras.events.length; i++) {
      var other = extras.events[i];
      if (!other || other.case_id === ev.case_id) continue;
      if (sameCompanyWorker(ident.company_name, ident.domain, other.company_name, other.domain)) {
        target = other;
        break;
      }
    }

    if (target) {
      attachStoryToEvent(target, {
        url: ev.source_url,
        title: ev.event_headline,
        text: ev.event_summary
      });
      if (Array.isArray(ev.source_urls)) {
        ev.source_urls.forEach(function (u) {
          attachStoryToEvent(target, { url: u });
        });
      }
      if (!looksLikeRealDomainWorker(target.domain) && ident.domain) {
        target.domain = ident.domain;
      }
      var knownT = knownSubjectDomainWorker(target.company_name);
      if (knownT && !looksLikeRealDomainWorker(target.domain)) target.domain = knownT;
      doomed.push(ev);
      clearAmbiguousResult(ev.case_id, "merged_into_" + target.case_id);
      changed = true;
      actions.push({
        action: "merge_into",
        from_case_id: ev.case_id,
        from_name: ev.company_name,
        from_domain: host,
        to_case_id: target.case_id,
        to_name: target.company_name
      });
      return;
    }

    // No existing target: retarget this row in place.
    var resolved = resolvePublisherMisattribution(
      ev,
      ev.event_headline || "",
      ev.event_summary || "",
      ev.source_url || "",
      ident
    );
    if (resolved && resolved.redirected) {
      (extras.profiles || []).forEach(function (p) {
        if (!p || p.company_id !== ev.company_id) return;
        p.company_name = ev.company_name;
        p.domain = ev.domain;
      });
      clearHunterContactsForCompanyId(ev.company_id);
      clearAmbiguousResult(ev.case_id, "publisher_retarget");
      changed = true;
      actions.push({
        action: "retarget",
        case_id: ev.case_id,
        company_name: ev.company_name,
        domain: ev.domain || ""
      });
    }
  });

  // Pass 3: clear stale Ambiguous/Go scores that still cite a publisher domain.
  Object.keys(results || {}).forEach(function (caseId) {
    var rec = results[caseId];
    if (!rec || !rec.lastFields) return;
    var fieldDom = normalizeHost(rec.lastFields.domain);
    if (
      fieldDom &&
      (EXA_PUBLISHER_HOST_RE.test(fieldDom) ||
        isVcFirmHost(fieldDom) ||
        isCustomerPlatformHost(fieldDom) ||
        fieldDom === "unknown")
    ) {
      clearAmbiguousResult(caseId, "stale_publisher_or_unknown_domain_score");
    }
  });

  doomed.forEach(function (ev) {
    removeExtrasEventAndRelated(extras, ev.case_id, ev.company_id);
    if (results[ev.case_id]) delete results[ev.case_id];
  });

  // Pass 4b: drop Approve POC packages whose titles are IC/tech (not Email Template personas).
  var IC_TECH_TITLE_RE =
    /\b(qa|q\.?a\.?)\b|quality assurance|quality engineer|test automation|automation (engineer|manager|lead)|product (manager|management|owner|lead)|product management|software (engineer|developer|architect)|full[- ]?stack|front[- ]?end|back[- ]?end|devops|site reliability|\bsre\b|programmer|developer|scrum master|\b(cto|chief technology|vp[, ]?\s*engineering|head of engineering|engineering manager)|information systems|information technology|\bit (manager|director|specialist|support|admin|engineer)|\bdata scientist\b|\bdata engineer\b|\bmachine learning\b|\bml engineer\b/i;
  var PERSONA_TITLE_RE =
    /\b(cro|ceo|coo|cfo|founder|co-founder|chief revenue|chief executive|chief operating|chief financial|chief people|chief talent|chro|president|vp[, ]?\s*sales|head of sales|head of talent|head of people|head of hr|vp[, ]?\s*(talent|people|hr)|talent acquisition|\brecruiter\b|hiring manager|controller|vp[, ]?\s*finance|head of finance|general counsel|chief legal|head of legal|vp[, ]?\s*legal)\b/i;
  Object.keys(results || {}).forEach(function (caseId) {
    var rec = results[caseId];
    if (!rec || !Array.isArray(rec.pocPackages) || !rec.pocPackages.length) return;
    var before = rec.pocPackages.length;
    rec.pocPackages = rec.pocPackages.filter(function (pkg) {
      if (!pkg) return false;
      var title = String(pkg.title || (pkg.fields && pkg.fields.poc_title) || "");
      var email = String(pkg.email || (pkg.fields && pkg.fields.poc_email) || "").trim();
      if (!email) return false;
      if (IC_TECH_TITLE_RE.test(title)) return false;
      return PERSONA_TITLE_RE.test(title);
    });
    if (rec.pocPackages.length !== before) {
      changed = true;
      if (rec.pocPackages[0]) {
        rec.activePocId = rec.pocPackages[0].id;
        if (rec.lastFields) {
          rec.lastFields.poc_name = rec.pocPackages[0].name || rec.lastFields.poc_name;
          rec.lastFields.poc_title = rec.pocPackages[0].title || rec.lastFields.poc_title;
          rec.lastFields.poc_email = rec.pocPackages[0].email || rec.lastFields.poc_email;
        }
      } else {
        rec.activePocId = null;
      }
      actions.push({
        action: "scrub_non_persona_pocs",
        case_id: caseId,
        removed: before - rec.pocPackages.length
      });
    }
  });

  // Pass 4c: one-shot Chamelio repair — promote to Go waiting approval when a
  // persona-fit CEO/POC email exists on chamelio.ai. Does not Approve or send.
  extras.events.forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    var slug = slugifyTokenWorker(ev.company_name).replace(/-/g, "");
    if (slug !== "chamelio" && slug !== "chameilo") return;
    if (slug === "chameilo") {
      ev.company_name = "Chamelio";
      changed = true;
    }
    // Collect persona POC BEFORE any domain fix that clears Hunter contacts.
    var rec = results[ev.case_id];
    var fields = rec && rec.lastFields;
    var personaContact = null;
    (extras.contacts || []).forEach(function (c) {
      if (!c || c.company_id !== ev.company_id) return;
      var emailHost = String(c.email || "").split("@")[1] || "";
      if (emailHost && (isCustomerPlatformHost(emailHost) || EXA_PUBLISHER_HOST_RE.test(emailHost))) {
        return;
      }
      if (!String(c.email || "").trim() || String(c.email).indexOf("@") === -1) return;
      var title = String(c.title || "");
      if (IC_TECH_TITLE_RE.test(title)) return;
      if (!PERSONA_TITLE_RE.test(title)) return;
      var full = (String(c.first_name || "") + " " + String(c.last_name || "")).trim();
      if (!personaContact) personaContact = c;
      if (/^ale\b/i.test(full) && /\bceo\b/i.test(title)) personaContact = c;
    });
    if (!personaContact && fields && String(fields.poc_email || "").trim()) {
      var fieldTitle = String(fields.poc_title || "");
      var fieldEmailHost = String(fields.poc_email || "").split("@")[1] || "";
      if (
        PERSONA_TITLE_RE.test(fieldTitle) &&
        !IC_TECH_TITLE_RE.test(fieldTitle) &&
        !isCustomerPlatformHost(fieldEmailHost)
      ) {
        var nameParts = String(fields.poc_name || "").trim().split(/\s+/);
        personaContact = {
          first_name: nameParts[0] || "Ale",
          last_name: nameParts.slice(1).join(" ") || "Z.",
          title: fieldTitle || "CEO",
          email: String(fields.poc_email || "").trim()
        };
      }
    }
    // Fix domain without wiping persona contacts (applyDomainFix clears Hunter).
    if (normalizeHost(ev.domain) !== "chamelio.ai") {
      var fromDom = String(ev.domain || "");
      ev.domain = "chamelio.ai";
      var note = String(ev.entity_note || "");
      if (note.indexOf("domain_repaired:") === -1) {
        ev.entity_note =
          (note ? note + "; " : "") + "domain_repaired:" + (fromDom || "blank") + "->chamelio.ai";
      }
      (extras.profiles || []).forEach(function (p) {
        if (!p || p.company_id !== ev.company_id) return;
        p.domain = "chamelio.ai";
        p.company_name = "Chamelio";
      });
      // Drop only monday.com / publisher emails; keep chamelio.ai persona rows.
      extras.contacts = (extras.contacts || []).filter(function (c) {
        if (!c || c.company_id !== ev.company_id) return true;
        var host = String(c.email || "").split("@")[1] || "";
        if (host && (isCustomerPlatformHost(host) || EXA_PUBLISHER_HOST_RE.test(host))) return false;
        return true;
      });
      changed = true;
      actions.push({
        action: "chamelio_domain_fix_keep_pocs",
        case_id: ev.case_id,
        from: fromDom,
        to: "chamelio.ai"
      });
    }
    if (!personaContact) return;
    var pocName = (String(personaContact.first_name || "") + " " + String(personaContact.last_name || "")).trim();
    var pocTitle = personaContact.title || "CEO";
    var pocEmail = String(personaContact.email || "").trim();
    var alreadyGo =
      fields &&
      /^go$/i.test(String(fields.decision || "").trim()) &&
      String(fields.poc_email || "").trim();
    if (alreadyGo && normalizeHost(fields.domain) === "chamelio.ai") {
      if (!rec.partner_rerun) {
        rec.partner_rerun = true;
        if (!rec.last_rerun_at) rec.last_rerun_at = new Date().toISOString();
        changed = true;
        actions.push({ action: "chamelio_stamp_go", case_id: ev.case_id });
      }
      return;
    }
    var goFields = {
      status: "OK",
      table: "Table 1",
      decision: "Go",
      confidence_rating: "Medium",
      company_name: "Chamelio",
      domain: "chamelio.ai",
      poc_name: pocName,
      poc_title: pocTitle,
      poc_email: pocEmail,
      fit_if_email_secured: "Would-go",
      fit_if_email_note: "Qualified: legaltech CLM, Series A trigger, chamelio.ai, persona-fit CEO POC.",
      reason_or_ambiguity: "",
      override_available: "Yes",
      why:
        "Chamelio (chamelio.ai) raised a Series A for AI-native CLM. Hunter found persona-fit POC " +
        pocName +
        " (" +
        pocTitle +
        "). This is Go waiting approval. Nothing is sent until Approve."
    };
    results[ev.case_id] = {
      lastFields: goFields,
      humanOutcome: "",
      humanStateText: "Go — waiting approval",
      humanComplete: false,
      partner_rerun: true,
      last_rerun_at: new Date().toISOString(),
      saved_at: new Date().toISOString(),
      archived: false,
      pocPackages: [
        {
          id: "poc-chamelio-ale",
          name: pocName,
          title: pocTitle,
          email: pocEmail
        }
      ],
      activePocId: "poc-chamelio-ale"
    };
    changed = true;
    actions.push({
      action: "chamelio_promote_go",
      case_id: ev.case_id,
      domain: "chamelio.ai",
      poc: pocName
    });
  });

  // Pass 4d: Lexroom + numeric OCR garbage — never show 178900472 as the entity.
  // Prefer story/known name (Lexroom) + lexroom.ai; clear bad Hunter; stamp for Go enrich.
  var checkerHoldDoomed = [];
  extras.events.forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    var slug = slugifyTokenWorker(ev.company_name).replace(/-/g, "");
    var caseId = String(ev.case_id || "").toUpperCase();
    var blob =
      String(ev.event_headline || "") +
      "\n" +
      String(ev.event_summary || "") +
      "\n" +
      String(ev.source_url || "") +
      "\n" +
      String(ev.entity_note || "");
    var isLexroomCase =
      slug === "lexroom" ||
      caseId.indexOf("CE-LX-LEXROOM") === 0 ||
      /\blexroom\b/i.test(blob);
    var nameGarbage = isNumericOcrGarbageName(ev.company_name);
    var domainGarbage = isNumericOcrGarbageDomain(ev.domain);

    if (isLexroomCase || nameGarbage || domainGarbage) {
      var check = runEntityCheckerGate(
        { company_name: ev.company_name, domain: ev.domain },
        ev.event_headline || "",
        ev.event_summary || "",
        ev.source_url || ""
      );
      if (isLexroomCase) {
        check.company_name = "Lexroom";
        check.domain = "lexroom.ai";
        check.ok = true;
        check.repaired = true;
      }
      if (check.ok && check.company_name) {
        var fromName = String(ev.company_name || "");
        var fromDom = String(ev.domain || "");
        if (fromName !== check.company_name || normalizeHost(fromDom) !== normalizeHost(check.domain)) {
          ev.company_name = check.company_name;
          ev.domain = check.domain;
          var noteFix = String(ev.entity_note || "");
          if (noteFix.indexOf("entity_checker_repaired:") === -1) {
            ev.entity_note =
              (noteFix ? noteFix + "; " : "") +
              "entity_checker_repaired:" +
              (fromName || "blank") +
              "/" +
              (fromDom || "blank") +
              "->" +
              check.company_name +
              "/" +
              check.domain;
          }
          (extras.profiles || []).forEach(function (p) {
            if (!p || p.company_id !== ev.company_id) return;
            p.company_name = check.company_name;
            p.domain = check.domain;
          });
          (extras.statuses || []).forEach(function (s) {
            if (!s) return;
            if (
              sameCompanyWorker(s.company_name, s.domain, fromName, fromDom) ||
              sameCompanyWorker(s.company_name, s.domain, check.company_name, check.domain)
            ) {
              s.company_name = check.company_name;
              s.domain = check.domain;
            }
          });
          clearHunterContactsForCompanyId(ev.company_id);
          clearAmbiguousResult(ev.case_id, "entity_checker_repaired");
          changed = true;
          actions.push({
            action: "entity_checker_repair",
            case_id: ev.case_id,
            from_name: fromName,
            from_domain: fromDom,
            to_name: check.company_name,
            to_domain: check.domain
          });
        }
      } else if (nameGarbage || domainGarbage) {
        var noteHold = String(ev.entity_note || "");
        if (noteHold.indexOf("entity_checker_hold:") === -1) {
          ev.entity_note =
            (noteHold ? noteHold + "; " : "") +
            "entity_checker_hold:" +
            ((check.fail_reasons || []).join(",") || "invalid_entity");
        }
        clearAmbiguousResult(ev.case_id, "entity_checker_hold");
        checkerHoldDoomed.push(ev);
        changed = true;
        actions.push({
          action: "entity_checker_hold_removed",
          case_id: ev.case_id,
          fail_reasons: check.fail_reasons || []
        });
      }
    }
  });
  checkerHoldDoomed.forEach(function (ev) {
    removeExtrasEventAndRelated(extras, ev.case_id, ev.company_id);
    if (results[ev.case_id]) delete results[ev.case_id];
  });

  // Pass 4: move stories that clearly name a different queued company
  // (e.g. a Harvey Silicon Republic URL stuck on Newcode after a husk merge).
  extras.events.forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    var urls = Array.isArray(ev.source_urls)
      ? ev.source_urls.slice()
      : ev.source_url
        ? [ev.source_url]
        : [];
    urls.forEach(function (url) {
      if (!url) return;
      var ident = extractCompanyFromExa("", "", url);
      if (!ident.company_name) return;
      if (sameCompanyWorker(ident.company_name, ident.domain, ev.company_name, ev.domain)) return;
      var home = null;
      for (var i = 0; i < extras.events.length; i++) {
        var other = extras.events[i];
        if (!other || other.case_id === ev.case_id) continue;
        if (sameCompanyWorker(ident.company_name, ident.domain, other.company_name, other.domain)) {
          home = other;
          break;
        }
      }
      if (!home) return;
      attachStoryToEvent(home, { url: url });
      ev.source_urls = (Array.isArray(ev.source_urls) ? ev.source_urls : urls).filter(function (u) {
        return u !== url;
      });
      if (ev.source_url === url) {
        ev.source_url = ev.source_urls[0] || "";
      }
      changed = true;
      actions.push({
        action: "rehome_story",
        url: String(url).slice(0, 120),
        from_case_id: ev.case_id,
        to_case_id: home.case_id,
        subject: ident.company_name
      });
    });
  });

  return { changed: changed, actions: actions, results: results, extras: extras };
}

async function runEntityRepairPass(env) {
  var extras = (await kvGet(env, "extras")) || {
    events: [],
    profiles: [],
    contacts: [],
    statuses: [],
    employment: []
  };
  var results = (await kvGet(env, "results")) || {};
  var scrubbed = scrubPublisherAndNonLegaltechExtras(extras, results);
  results = scrubbed.results || results;
  var repaired = repairMisattributedEntities(extras, results);
  results = repaired.results || results;
  var lexroom = await enrichAndPromoteLexroom(env, extras, results);
  if (scrubbed.changed || repaired.changed || lexroom.changed) {
    await kvPut(env, "extras", extras);
    await kvPut(env, "results", results);
  }
  return {
    ok: true,
    scrub_nogo: (scrubbed.nogo || []).length,
    repair_actions: (repaired.actions || []).concat(lexroom.actions || []),
    changed: !!(scrubbed.changed || repaired.changed || lexroom.changed),
    lexroom: lexroom
  };
}

/**
 * After Lexroom domain repair: Hunter persona POCs on lexroom.ai and promote to
 * Go waiting approval when qualified. Does not Approve or send.
 */
async function enrichAndPromoteLexroom(env, extras, results) {
  var changed = false;
  var actions = [];
  var PERSONA_TITLE_RE =
    /\b(cro|ceo|coo|cfo|founder|co-founder|chief revenue|chief executive|chief operating|chief financial|chief people|chief talent|chro|president|vp[, ]?\s*sales|head of sales|head of talent|head of people|head of hr|vp[, ]?\s*(talent|people|hr)|talent acquisition|\brecruiter\b|hiring manager)\b/i;
  var IC_TECH_TITLE_RE =
    /\b(qa|q\.?a\.?)\b|quality assurance|software (engineer|developer)|full[- ]?stack|devops|\b(cto|chief technology|vp[, ]?\s*engineering)|product (manager|owner)\b/i;

  var events = (extras && extras.events) || [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev || !isLiveExaQueueEvent(ev)) continue;
    var slug = slugifyTokenWorker(ev.company_name).replace(/-/g, "");
    var caseId = String(ev.case_id || "").toUpperCase();
    if (slug !== "lexroom" && caseId.indexOf("CE-LX-LEXROOM") !== 0) continue;

    ev.company_name = "Lexroom";
    if (normalizeHost(ev.domain) !== "lexroom.ai") {
      ev.domain = "lexroom.ai";
      changed = true;
    }
    (extras.profiles || []).forEach(function (p) {
      if (!p || p.company_id !== ev.company_id) return;
      p.company_name = "Lexroom";
      p.domain = "lexroom.ai";
    });

    var hunter = await hunterRosterForDomain(env, "lexroom.ai");
    var persona = null;
    if (hunter && hunter.ok && hunter.emails && hunter.emails.length) {
      hunter.emails.forEach(function (row) {
        if (!row || !String(row.email || "").trim()) return;
        var title = String(row.title || "");
        if (IC_TECH_TITLE_RE.test(title)) return;
        if (!PERSONA_TITLE_RE.test(title)) return;
        if (!persona) persona = row;
        if (/\b(ceo|founder|co-founder)\b/i.test(title)) persona = row;
      });
      // Persist Hunter persona contacts for the card.
      hunter.emails.forEach(function (row, idx) {
        if (!row || !String(row.email || "").trim()) return;
        var title = String(row.title || "");
        if (IC_TECH_TITLE_RE.test(title)) return;
        if (!PERSONA_TITLE_RE.test(title)) return;
        var contactId = "CT-H-LEXROOM-" + idx + "-" + String(row.email).split("@")[0].slice(0, 12);
        var existing = (extras.contacts || []).some(function (c) {
          return c && c.company_id === ev.company_id && String(c.email || "").toLowerCase() === String(row.email).toLowerCase();
        });
        if (existing) return;
        extras.contacts = extras.contacts || [];
        extras.contacts.push({
          contact_id: contactId,
          company_id: ev.company_id,
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          title: title,
          email: row.email,
          employment_confirmed: "yes",
          linkedin_url: row.linkedin || "",
          discovered_via: "hunter_domain_search"
        });
        extras.employment = extras.employment || [];
        extras.employment.push({
          company_id: ev.company_id,
          contact_id: contactId,
          works_at_company: true
        });
        changed = true;
      });
    }

    if (!persona) {
      actions.push({
        action: "lexroom_repaired_awaiting_poc",
        case_id: ev.case_id,
        domain: "lexroom.ai",
        hunter: (hunter && hunter.detail) || "no_persona"
      });
      continue;
    }

    var pocName = (String(persona.first_name || "") + " " + String(persona.last_name || "")).trim();
    var pocTitle = persona.title || "Founder";
    var pocEmail = String(persona.email || "").trim();
    var rec = results[ev.case_id];
    var fields = rec && rec.lastFields;
    var alreadyGo =
      fields &&
      /^go$/i.test(String(fields.decision || "").trim()) &&
      String(fields.poc_email || "").trim() &&
      normalizeHost(fields.domain) === "lexroom.ai";
    if (alreadyGo) {
      if (rec && !rec.partner_rerun) {
        rec.partner_rerun = true;
        if (!rec.last_rerun_at) rec.last_rerun_at = new Date().toISOString();
        changed = true;
      }
      actions.push({ action: "lexroom_already_go", case_id: ev.case_id, poc: pocName });
      continue;
    }

    results[ev.case_id] = {
      lastFields: {
        status: "OK",
        table: "Table 1",
        decision: "Go",
        confidence_rating: "Medium",
        company_name: "Lexroom",
        domain: "lexroom.ai",
        poc_name: pocName,
        poc_title: pocTitle,
        poc_email: pocEmail,
        fit_if_email_secured: "Would-go",
        fit_if_email_note:
          "Qualified: Italian AI legal research / legaltech, acquisition trigger, lexroom.ai, persona-fit POC.",
        reason_or_ambiguity: "",
        override_available: "Yes",
        why:
          "Lexroom (lexroom.ai) is Italian AI legal research (acquiring Query Juriste / Praven Intelekt). Hunter found persona-fit POC " +
          pocName +
          " (" +
          pocTitle +
          "). This is Go waiting approval. Nothing is sent until Approve."
      },
      humanOutcome: "",
      humanStateText: "Go — waiting approval",
      humanComplete: false,
      partner_rerun: true,
      last_rerun_at: new Date().toISOString(),
      saved_at: new Date().toISOString(),
      archived: false,
      pocPackages: [
        {
          id: "poc-lexroom-hunter",
          name: pocName,
          title: pocTitle,
          email: pocEmail
        }
      ],
      activePocId: "poc-lexroom-hunter"
    };
    changed = true;
    actions.push({
      action: "lexroom_promote_go",
      case_id: ev.case_id,
      domain: "lexroom.ai",
      poc: pocName
    });
  }

  return { changed: changed, actions: actions };
}

async function searchExaResults(env, q, num) {
  if (!env.EXA_API_KEY) {
    return { ok: false, error: "EXA_API_KEY secret not set on worker", results: [] };
  }
  var query = q || EXA_DEFAULT_QUERY;
  var n = Math.min(Math.max(parseInt(num || "6", 10) || 6, 1), 10);
  var startPublishedDate = exaStartPublishedDateIso();
  var upstream = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + env.EXA_API_KEY,
      "x-api-key": env.EXA_API_KEY
    },
    body: JSON.stringify({
      query: query,
      numResults: n,
      type: "auto",
      startPublishedDate: startPublishedDate,
      contents: {
        text: { maxCharacters: 4500 },
        highlights: { maxCharacters: 1200 }
      }
    })
  });
  var raw = await upstream.json().catch(function () {
    return null;
  });
  if (!upstream.ok) {
    return {
      ok: false,
      error: (raw && (raw.error || raw.message)) || "Exa request failed",
      status: upstream.status,
      results: []
    };
  }
  var results = ((raw && raw.results) || []).map(function (r) {
    var chunks = [];
    if (r.text) chunks.push(String(r.text));
    if (r.highlights && r.highlights.length) chunks.push(r.highlights.join(" "));
    var text = chunks.join("\n").replace(/\s+/g, " ").trim();
    return {
      title: r.title || "",
      url: r.url || "",
      publishedDate: r.publishedDate || r.published_date || "",
      text: text.slice(0, 4500)
    };
  });
  return {
    ok: true,
    query: query,
    startPublishedDate: startPublishedDate,
    max_age_days: EXA_MAX_AGE_DAYS,
    results: results
  };
}

async function proxyExa(url, env, cors) {
  var packed = await searchExaResults(
    env,
    url.searchParams.get("q"),
    url.searchParams.get("num")
  );
  if (!packed.ok) {
    return jsonResponse(
      { error: packed.error, status: packed.status },
      packed.status || 500,
      cors
    );
  }
  return jsonResponse(
    {
      query: packed.query,
      startPublishedDate: packed.startPublishedDate,
      max_age_days: packed.max_age_days || EXA_MAX_AGE_DAYS,
      results: packed.results
    },
    200,
    cors
  );
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
    // Read-only restore. Scoring runs offline on Exa cron / ingest / /v1/auto-analyze —
    // never on login/snapshot, so partners never wait on scoring activity.
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
        ingest_status: (await kvGet(env, "ingest_status")) || null,
        voice: (await kvGet(env, "voice")) || null,
        results: (await kvGet(env, "results")) || {},
        clients: (await kvGet(env, "clients")) || [],
        dnc: (await kvGet(env, "dnc")) || [],
        dispatch_status: (await kvGet(env, "dispatch_status")) || null,
        auto_analyze: null
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

async function storeEscalate(request, env, cors) {
  if (!env.DB) return storeMissing(cors);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "JSON required" }, 400, cors);
  }
  const created = new Date().toISOString();
  const caseId = String((body && body.case_id) || "").slice(0, 64);
  const company = String((body && body.company_name) || "").slice(0, 200);
  const partnerNote = String((body && body.partner_note) || "").slice(0, 2000);
  const entityStatus = String((body && body.entity_status) || "").slice(0, 4000);
  const subject = String((body && body.subject) || ("Escalation: " + caseId)).slice(0, 200);
  const fullBody = String((body && body.body) || partnerNote).slice(0, 12000);
  const agentDecision = String((body && body.agent_decision) || "").slice(0, 200);
  try {
    await env.DB.prepare(
      "INSERT INTO audit (created_at, case_id, company_name, agent_decision, human_action, detail) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(created, caseId, company, agentDecision, "escalate_helpdesk", partnerNote.slice(0, 500))
      .run();
    const escalations = (await kvGet(env, "escalations")) || [];
    escalations.push({
      created_at: created,
      case_id: caseId,
      company_name: company,
      subject: subject,
      entity_status: entityStatus,
      partner_note: partnerNote,
      body: fullBody
    });
    await kvPut(env, "escalations", escalations.slice(-100));
    const send = await sendHelpdeskEmail(env, { subject: subject, body: fullBody });
    return jsonResponse(
      {
        ok: true,
        sent: !!send.sent,
        detail: send.detail || (send.sent ? "email_sent" : "logged_only")
      },
      200,
      cors
    );
  } catch (e) {
    return jsonResponse(
      { error: "Escalation store failed", detail: String((e && e.message) || e) },
      500,
      cors
    );
  }
}

async function sendHelpdeskEmail(env, payload) {
  const to = String((env && env.HELPDESK_EMAIL) || "courtney@geetm.ai").trim();
  const key = env && env.RESEND_API_KEY;
  if (!key) {
    return { sent: false, detail: "RESEND_API_KEY not set on worker; ticket logged to audit only" };
  }
  const from = String((env && env.HELPDESK_FROM) || "Black Gavel <noreply@geetm.ai>").trim();
  try {
    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: from,
        to: [to],
        subject: String(payload.subject || "Black Gavel escalation").slice(0, 200),
        text: String(payload.body || "").slice(0, 12000)
      })
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(function () { return ""; });
      return { sent: false, detail: "Resend failed: " + errText.slice(0, 200) };
    }
    return { sent: true, detail: "email_sent" };
  } catch (e) {
    return { sent: false, detail: String((e && e.message) || e) };
  }
}

var BLOB_KEYS = { extras: true, voice: true, results: true, clients: true, dnc: true };

async function storePutBlob(request, env, cors, key) {
  if (!env.DB) return storeMissing(cors);
  if (!BLOB_KEYS[key]) return jsonResponse({ error: "Unknown store key" }, 400, cors);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "JSON required" }, 400, cors);
  }
  if ((key === "clients" || key === "dnc") && !Array.isArray(body)) {
    return jsonResponse({ error: key + " must be an array" }, 400, cors);
  }
  try {
    // Results: merge by case_id so login/partial PUTs never erase classified memory.
    if (key === "results") {
      var existingResults = (await kvGet(env, "results")) || {};
      body = mergeResultsBlobs(existingResults, body);
    }
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

/** OCR / scrape garbage: all-digit or mostly-numeric labels like 178900472. */
function isNumericOcrGarbageLabel(label) {
  var s = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!s) return false;
  if (/^\d{4,}$/.test(s)) return true;
  var alnum = s.replace(/[^a-z0-9]/g, "");
  if (!alnum || alnum.length < 6) return false;
  var digits = (alnum.match(/\d/g) || []).length;
  return digits / alnum.length >= 0.7;
}

function isNumericOcrGarbageName(name) {
  return isNumericOcrGarbageLabel(String(name || "").trim());
}

function isNumericOcrGarbageDomain(domain) {
  var host = String(domain || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
  if (!host) return false;
  return isNumericOcrGarbageLabel(host.split(".")[0] || "");
}

function looksLikeRealDomainWorker(domain) {
  var d = String(domain || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
  if (!d || /\.example$/i.test(d) || /^livecompany\d+\.example$/.test(d)) return false;
  if (isNumericOcrGarbageDomain(d)) return false;
  if (EXA_PUBLISHER_HOST_RE.test(d)) return false;
  if (typeof isVcFirmHost === "function" && isVcFirmHost(d)) return false;
  return /^[a-z0-9][a-z0-9.-]{1,60}\.[a-z]{2,}$/.test(d);
}

/**
 * Pre-post Entity Checker: verify name + domain before a Review Queue card is written.
 * Auto-repairs when the article/title already names a real company; otherwise holds
 * as an internal draft (never posts numeric OCR husks like 178900472 / 178900472.ai).
 */
function runEntityCheckerGate(ident, title, text, url) {
  ident = ident || {};
  var name = String(ident.company_name || "").trim();
  var domain = normalizeHost(ident.domain);
  var failReasons = [];
  var repaired = false;
  var blob = String(title || "") + "\n" + String(text || "") + "\n" + String(url || "");

  if (
    !name ||
    isNumericOcrGarbageName(name) ||
    isPlaceholderCompanyNameWorker(name) ||
    isMediaOrVcCompanyName(name)
  ) {
    var fromStory = extractCompanyFromExa(title, text, url);
    if (
      fromStory &&
      fromStory.company_name &&
      !isNumericOcrGarbageName(fromStory.company_name) &&
      !isMediaOrVcCompanyName(fromStory.company_name) &&
      !isPlaceholderCompanyNameWorker(fromStory.company_name)
    ) {
      name = fromStory.company_name;
      if (fromStory.domain) domain = normalizeHost(fromStory.domain);
      repaired = true;
    }
  }

  // Title/body already names a known legaltech (e.g. Lexroom) while card is numeric garbage.
  if (isNumericOcrGarbageName(name) || isNumericOcrGarbageDomain(domain) || !name) {
    var knownHit = null;
    var knownMapProbe = {
      lexroom: "Lexroom",
      harvey: "Harvey",
      magnar: "Magnar",
      crosby: "Crosby",
      newcode: "Newcode",
      chamelio: "Chamelio",
      xapien: "Xapien"
    };
    Object.keys(knownMapProbe).forEach(function (slug) {
      if (knownHit) return;
      if (new RegExp("\\b" + slug + "\\b", "i").test(blob)) {
        knownHit = knownMapProbe[slug];
      }
    });
    if (knownHit) {
      name = knownHit;
      repaired = true;
    }
  }

  if (
    isNumericOcrGarbageDomain(domain) ||
    isCustomerPlatformHost(domain) ||
    (domain && EXA_PUBLISHER_HOST_RE.test(domain)) ||
    isVcFirmHost(domain)
  ) {
    domain = "";
    repaired = true;
  }

  var known = name ? knownSubjectDomainWorker(name) : "";
  if (known) {
    if (!domain || isNumericOcrGarbageDomain(domain) || !domainMatchesCompanyWorker(name, domain)) {
      domain = known;
      repaired = true;
    }
  }

  if (
    !name ||
    isNumericOcrGarbageName(name) ||
    isPlaceholderCompanyNameWorker(name) ||
    isMediaOrVcCompanyName(name)
  ) {
    failReasons.push("invalid_company_name");
  }
  if (!looksLikeRealDomainWorker(domain)) {
    failReasons.push("invalid_or_missing_domain");
  } else if (
    name &&
    !domainMatchesCompanyWorker(name, domain) &&
    !knownSubjectDomainWorker(name)
  ) {
    failReasons.push("domain_mismatch");
  }

  return {
    ok: failReasons.length === 0,
    company_name: name || "",
    domain: domain || "",
    fail_reasons: failReasons,
    repaired: repaired,
    hold_as_draft: failReasons.length > 0
  };
}

function caseHasDecision(rec) {
  if (!rec || !rec.lastFields || typeof rec.lastFields !== "object") return false;
  var decision = String(rec.lastFields.decision || "").trim().toLowerCase();
  var status = String(rec.lastFields.status || "").trim().toLowerCase();
  if (!decision && !status) return false;
  if (decision === "not run" || decision === "pending") return false;
  return true;
}

/** Merge results blobs so a partial client PUT never wipes classified cases. */
function mergeResultsBlobs(existing, incoming) {
  var base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  var next = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  var merged = Object.assign({}, base);
  Object.keys(next).forEach(function (caseId) {
    var inc = next[caseId];
    var cur = merged[caseId];
    if (inc && inc.clear === true) {
      delete merged[caseId];
      return;
    }
    if (caseHasDecision(inc)) {
      var curDec = cur && cur.lastFields ? String(cur.lastFields.decision || "").toLowerCase() : "";
      var incDec = String((inc.lastFields && inc.lastFields.decision) || "").toLowerCase();
      var curIsPartnerGo =
        cur &&
        curDec.indexOf("go") !== -1 &&
        curDec.indexOf("no-go") === -1 &&
        (cur.partner_rerun || cur.last_rerun_at);
      var incIsGo = incDec.indexOf("go") !== -1 && incDec.indexOf("no-go") === -1;
      // Never let Ambiguous (or other non-Go) overwrite a partner Rerun Go.
      if (curIsPartnerGo && !incIsGo) {
        return;
      }
      // Prefer a stamped partner Rerun over an older auto-score overwrite.
      if (
        cur &&
        caseHasDecision(cur) &&
        (cur.partner_rerun || cur.last_rerun_at) &&
        !(inc.partner_rerun || inc.last_rerun_at) &&
        String(cur.saved_at || "") > String(inc.saved_at || "")
      ) {
        return;
      }
      merged[caseId] = inc;
      if (cur && cur.archived && !inc.archived) {
        merged[caseId].archived = true;
        merged[caseId].archived_at = cur.archived_at || "";
      }
      // Worker-owned dispatch stamps survive client PUTs that omit them.
      if (cur && cur.dispatch && !inc.dispatch) {
        merged[caseId].dispatch = cur.dispatch;
      }
      if (cur && cur.authorized_at && !inc.authorized_at) {
        merged[caseId].authorized_at = cur.authorized_at;
      }
      if (cur && (cur.partner_rerun || cur.last_rerun_at) && !(inc.partner_rerun || inc.last_rerun_at)) {
        merged[caseId].partner_rerun = cur.partner_rerun;
        merged[caseId].last_rerun_at = cur.last_rerun_at;
      }
      return;
    }
    if (caseHasDecision(cur)) {
      // Keep saved classification; ignore empty/incomplete overwrite.
      return;
    }
    if (inc) merged[caseId] = inc;
  });
  return merged;
}

function domainIsConfirmed(note) {
  var n = String(note || "");
  return n.indexOf("human_confirmed_domain") !== -1 || n.indexOf("auto_confirmed_domain") !== -1;
}

function eventReadyForAutoAnalyze(ev) {
  if (!ev || !ev.live_exa) return false;
  var name = String(ev.company_name || "").trim();
  if (!name || /^live\s*company\s*\d+$/i.test(name)) return false;
  // Never score numeric OCR husks (178900472) until Entity Checker repairs them.
  if (isNumericOcrGarbageName(name) || isNumericOcrGarbageDomain(ev.domain)) return false;
  // Publisher mis-attribution must enter the queue so we can retarget the article subject
  // (e.g. Latamlist/latamlist.com → Magnar). Do not require a real vendor domain first.
  var host = normalizeHost(ev.domain);
  if (isMediaOrVcCompanyName(name) || (host && (EXA_PUBLISHER_HOST_RE.test(host) || isVcFirmHost(host)))) return true;
  if (String(ev.entity_note || "").indexOf("redirected_from_publisher") !== -1) return true;
  if (!looksLikeRealDomainWorker(ev.domain)) return false;
  // Domain confirm is automatic for real domains — never block drain on a human click.
  return true;
}

function normalizeHost(domain) {
  return String(domain || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function matchClientBookWorker(clients, companyName, domain) {
  var host = normalizeHost(domain);
  var name = String(companyName || "").trim().toLowerCase();
  var list = Array.isArray(clients) ? clients : [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row) continue;
    var rowHost = normalizeHost(row.domain);
    if (host && rowHost && host === rowHost) return row;
    var rowName = String(row.company_name || "").trim().toLowerCase();
    if (name && rowName && name === rowName) return row;
  }
  return null;
}

function parseLabeledFieldsWorker(text) {
  var fields = {};
  var lines = String(text || "").replace(/\r/g, "").split("\n");
  var currentKey = "";
  var known = {
    status: true,
    table: true,
    decision: true,
    confidence_rating: true,
    company_name: true,
    domain: true,
    poc_name: true,
    poc_title: true,
    poc_email: true,
    fit_if_email_secured: true,
    fit_if_email_note: true,
    sector: true,
    employee_count: true,
    revenue_estimate: true,
    vc_pe_backed: true,
    ta_headcount: true,
    persona_assigned: true,
    persona_used: true,
    trigger_event: true,
    event_date: true,
    event_source_url: true,
    reason_or_ambiguity: true,
    override_available: true,
    citations: true,
    why: true,
    trigger_reference: true
  };
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(/^([a-z0-9_]+)\s*:\s*(.*)$/i);
    if (m && known[m[1].toLowerCase()]) {
      currentKey = m[1].toLowerCase();
      fields[currentKey] = String(m[2] || "").trim();
    } else if (currentKey && (currentKey === "why" || currentKey === "reason_or_ambiguity" || currentKey === "citations" || currentKey === "fit_if_email_note" || currentKey === "trigger_reference")) {
      fields[currentKey] = (fields[currentKey] || "") + "\n" + line;
    }
  }
  return fields;
}

function AUTO_ANALYZE_SYSTEM_PROMPT() {
  return [
    "You classify one Legaltech recruiting outreach candidate for Recruiting Partners / Black Gavel.",
    "Return ONLY labeled fields, one per line. No markdown fences.",
    "status: OK or REFUSED-ESCALATE",
    "table: Table 1 or Table 2 or Table 3",
    "decision: Go or No-go or Ambiguous or Out of ICP or Refused",
    "confidence_rating: High or Medium or Low or Ambiguous or Out of ICP",
    "company_name:",
    "domain:",
    "poc_name:",
    "poc_title:",
    "poc_email:",
    "fit_if_email_secured: Would-go or Still-blocked or Ambiguous",
    "fit_if_email_note:",
    "sector:",
    "employee_count:",
    "revenue_estimate:",
    "vc_pe_backed:",
    "ta_headcount:",
    "persona_assigned:",
    "persona_used:",
    "trigger_event:",
    "event_date:",
    "event_source_url:",
    "reason_or_ambiguity:",
    "override_available: Yes or No",
    "citations:",
    "why:",
    "ICP: legaltech software sold to law firms or in-house legal; employees 50-350; revenue $15M-$50M preferred; VC/PE backed; TA 0-2.",
    "No-go / Table 2 only for known disqualifiers (client, confirmed out of ICP, bankruptcy, duplicate/opt-out).",
    "Ambiguous / Table 3 when you lack enough information to judge, OR when Hunter roster is sparse / missing a verified qualified POC email but company+event would otherwise allow outreach (fit_if_email_secured: Would-go).",
    "Never invent emails. Use hunter_roster emails only. Qualified POCs match Email Template personas only: New Hire, CRO/CEO/COO/Founder, Head of Talent and HR, Talent Acquisition/Recruiter, Hiring Manager (finance/legal leadership). Never pick IC/tech titles (QA, Product Manager/Management, Software Engineer/Developer, Engineering, IT, IS, Information Systems, DevOps, Data Scientist). If no verified qualified POC email and Would-go: Table 3 Ambiguous, decision Ambiguous, status OK (not REFUSED-ESCALATE). Why: Hunter email/roster thin, company+event otherwise qualify, partner should secure POC email / Move to Go.",
    "Entity management / registered-agent / corp-sec sold to finance-ops is NOT legaltech (Table 2 No-go for sector).",
    "KYC / AML / AI due diligence / OSINT / third-party risk / compliance research platforms (example: Xapien / xapien.com) are NOT legaltech even when banks or law firms buy them. Table 2 No-go for sector. Selling to legal buyers does not make the product practice-of-law software.",
    "PUBLISHER / VC FALSE POSITIVE: If company_name or domain is a news/magazine site OR a venture firm (Lux Capital / luxcapital.com, Sequoia, a16z, Index Ventures, Foundernews / foundernews.eu, etc.) and the article is about a portfolio company they covered or funded, do NOT score or Hunter the publisher/VC. Extract the company named in the story body (possessive funding lines count: \"Xapien's total equity funding\" → Xapien). Set company_name and domain to THAT company, then apply ICP. If that company is clearly not legaltech, Table 2 No-go for sector (do not leave Ambiguous unknown-entity). Mega-round / unicorn size ($100M+ raise or ~$1B+ valuation) is Table 2 No-go / Out of ICP even if legaltech. If the startup website is unknown AND size is not clearly out of ICP AND sector is still plausibly legaltech: Table 3 Ambiguous asking for the real domain. Never REFUSED-ESCALATE solely to stop on the publisher/VC when the article subject is clear.",
    "Partner-facing why: plain language, end with a next action. Name Exa.ai / Hunter.io when relevant. No .md file names in why.",
    "Drafts are filled later by the console. Leave draft fields out. Set persona_used when decision is Go."
  ].join("\n");
}

function deterministicClassify(ev, profile, clients) {
  var clientHit = matchClientBookWorker(clients, ev.company_name, ev.domain);
  if (clientHit) {
    return {
      status: "REFUSED-ESCALATE",
      table: "Table 2",
      decision: "No-go",
      confidence_rating: "High",
      company_name: ev.company_name,
      domain: ev.domain,
      poc_name: "",
      poc_title: "",
      poc_email: "",
      fit_if_email_secured: "Still-blocked",
      fit_if_email_note: "Existing client. Cold outreach not allowed.",
      sector: (profile && profile.sector) || ev.sector || "",
      employee_count: String(ev.employee_count != null ? ev.employee_count : ""),
      revenue_estimate: String(ev.revenue_estimate_mm != null ? ev.revenue_estimate_mm : ""),
      vc_pe_backed: String(ev.vc_pe_backed || ""),
      ta_headcount: String(ev.ta_headcount != null ? ev.ta_headcount : ""),
      persona_assigned: "",
      persona_used: "",
      trigger_event: String(ev.event_type || ""),
      event_date: String(ev.event_date || ""),
      event_source_url: String(ev.source_url || ""),
      reason_or_ambiguity: "Existing client",
      override_available: "No",
      citations: String(ev.case_id || "") + ", client-book",
      why:
        String(ev.company_name || "This company") +
        " is already a client. Cold outreach is not allowed. Use the existing relationship instead."
    };
  }
  var sector = String((profile && profile.sector) || ev.sector || "").toLowerCase();
  var blobForSector = [
    ev && ev.company_name,
    ev && ev.event_headline,
    ev && ev.event_summary,
    profile && profile.notes,
    profile && profile.sector
  ]
    .map(function (x) {
      return String(x || "");
    })
    .join(" ");
  var nonLegal = classifyNonLegaltechSignal(blobForSector, ev && ev.company_name, ev && ev.domain);
  if (nonLegal || (sector && sector !== "legaltech" && /entity|corp.?sec|registered.?agent|hr.?tech|fintech|generic|kyc|aml|osint|due.?diligence|compliance|risk.?intel/.test(sector))) {
    var sectorLabel = (nonLegal && nonLegal.sector) || sector || "non_legaltech";
    return {
      status: "OK",
      table: "Table 2",
      decision: "No-go",
      confidence_rating: "High",
      company_name: ev.company_name,
      domain: ev.domain,
      poc_name: "",
      poc_title: "",
      poc_email: "",
      fit_if_email_secured: "Still-blocked",
      fit_if_email_note: "Out of ICP sector even with email.",
      sector: sectorLabel,
      employee_count: String(ev.employee_count != null ? ev.employee_count : ""),
      revenue_estimate: String(ev.revenue_estimate_mm != null ? ev.revenue_estimate_mm : ""),
      vc_pe_backed: String(ev.vc_pe_backed || ""),
      ta_headcount: String(ev.ta_headcount != null ? ev.ta_headcount : ""),
      persona_assigned: "",
      persona_used: "",
      trigger_event: String(ev.event_type || ""),
      event_date: String(ev.event_date || ""),
      event_source_url: String(ev.source_url || ""),
      reason_or_ambiguity: "Out of ICP sector",
      override_available: "No",
      citations: String(ev.case_id || "") + ", icp-criteria.md",
      why:
        String(ev.company_name || "This company") +
        " is outside legaltech ICP based on sector (" +
        sectorLabel +
        "). Do not chase email for this case."
    };
  }
  var mega = megaFundingOutOfIcpFields(ev, profile);
  if (mega) return mega;

  var emp = ev.employee_count;
  if (profile && profile.employee_count != null && profile.employee_count !== "") emp = profile.employee_count;
  if (emp != null && emp !== "" && !isNaN(Number(emp))) {
    var n = Number(emp);
    if (n < 50 || n > 350) {
      return {
        status: "OK",
        table: "Table 2",
        decision: "Out of ICP",
        confidence_rating: "High",
        company_name: ev.company_name,
        domain: ev.domain,
        poc_name: "",
        poc_title: "",
        poc_email: "",
        fit_if_email_secured: "Still-blocked",
        fit_if_email_note: "Out of ICP size even with email.",
        sector: (profile && profile.sector) || ev.sector || "legaltech",
        employee_count: String(n),
        revenue_estimate: String(ev.revenue_estimate_mm != null ? ev.revenue_estimate_mm : ""),
        vc_pe_backed: String(ev.vc_pe_backed || ""),
        ta_headcount: String(ev.ta_headcount != null ? ev.ta_headcount : ""),
        persona_assigned: "",
        persona_used: "",
        trigger_event: String(ev.event_type || ""),
        event_date: String(ev.event_date || ""),
        event_source_url: String(ev.source_url || ""),
        reason_or_ambiguity: "Employee count outside 50-350",
        override_available: "No",
        citations: String(ev.case_id || "") + ", icp-criteria.md",
        why:
          String(ev.company_name || "This company") +
          " has about " +
          n +
          " employees, outside the 50–350 ICP size range, and is not on the partner whitelist. Even with a POC email, it stays out of scope. Do not chase email for this case."
      };
    }
  }
  return null;
}

/** Parse $550M / $15.6bn-style signals from Exa copy. Mega companies are out of ICP size. */
function parseMoneyTokenToMillions(numStr, unit) {
  var n = parseFloat(String(numStr || "").replace(/,/g, ""));
  if (!isFinite(n)) return null;
  var u = String(unit || "").toLowerCase();
  if (u === "b" || u === "bn" || u === "billion") return n * 1000;
  if (u === "m" || u === "mm" || u === "million") return n;
  if (u === "k" || u === "thousand") return n / 1000;
  return n;
}

function detectMegaFundingSignal(ev) {
  var blob = [ev && ev.event_headline, ev && ev.event_summary, ev && ev.source_url]
    .map(function (x) {
      return String(x || "");
    })
    .join(" ");
  if (!blob.trim()) return null;
  var valMatch = blob.match(
    /\$?\s*([\d,.]+)\s*(bn|b|billion|mm|m|million)?\b[^.]{0,40}\bvaluat/i
  ) || blob.match(
    /\bvaluat(?:ion|ed)?[^.]{0,40}\$?\s*([\d,.]+)\s*(bn|b|billion|mm|m|million)?\b/i
  );
  if (valMatch) {
    var valMm = parseMoneyTokenToMillions(valMatch[1], valMatch[2] || "b");
    // $1B+ valuation => clearly above mid-market ICP.
    if (valMm != null && valMm >= 1000) {
      return { kind: "valuation", millions: valMm, label: "$" + valMatch[1] + (valMatch[2] || "B") + " valuation" };
    }
  }
  var raiseMatch = blob.match(
    /\$\s*([\d,.]+)\s*(bn|b|billion|mm|m|million)\b[^.]{0,50}\b(?:round|series|funding|raise|raised|closes|closed|secures|secured)/i
  ) || blob.match(
    /\b(?:raises?|raised|closes?|closed|secures?|secured|lands?)\b[^.]{0,40}\$\s*([\d,.]+)\s*(bn|b|billion|mm|m|million)\b/i
  );
  if (raiseMatch) {
    var raiseMm = parseMoneyTokenToMillions(raiseMatch[1], raiseMatch[2]);
    // $100M+ single round => too large for 50-350 / $15-50M revenue ICP.
    if (raiseMm != null && raiseMm >= 100) {
      return { kind: "raise", millions: raiseMm, label: "$" + raiseMatch[1] + (raiseMatch[2] || "M") + " round" };
    }
  }
  return null;
}

function megaFundingOutOfIcpFields(ev, profile) {
  var signal = detectMegaFundingSignal(ev);
  if (!signal) return null;
  var company = String(ev.company_name || "This company");
  var why =
    company +
    " is the company named in the Exa.ai funding article, but the " +
    signal.label +
    " puts it far above Black Gavel ICP size (target roughly 50-350 employees / mid-market). Legaltech fit alone is not enough. Do not chase a POC email for this case.";
  return {
    status: "OK",
    table: "Table 2",
    decision: "Out of ICP",
    confidence_rating: "High",
    company_name: ev.company_name,
    domain: ev.domain || "",
    poc_name: "",
    poc_title: "",
    poc_email: "",
    fit_if_email_secured: "Still-blocked",
    fit_if_email_note: "Out of ICP size (mega round / valuation) even with email.",
    sector: (profile && profile.sector) || ev.sector || "legaltech",
    employee_count: String(ev.employee_count != null ? ev.employee_count : ""),
    revenue_estimate: String(ev.revenue_estimate_mm != null ? ev.revenue_estimate_mm : ""),
    vc_pe_backed: String(ev.vc_pe_backed || ""),
    ta_headcount: String(ev.ta_headcount != null ? ev.ta_headcount : ""),
    persona_assigned: "",
    persona_used: "",
    trigger_event: String(ev.event_type || ""),
    event_date: String(ev.event_date || ""),
    event_source_url: String(ev.source_url || ""),
    reason_or_ambiguity: "Mega funding / valuation outside ICP size",
    override_available: "No",
    citations: String(ev.case_id || "") + ", icp-criteria.md, exa-mega-size",
    why: why
  };
}

function coerceSparseHunterEmailFields(fields, hunter) {
  if (!fields) return fields;
  var fit = String(fields.fit_if_email_secured || "").toLowerCase().replace(/\s+/g, "-");
  if (fit.indexOf("still-blocked") === 0) return fields;
  var status = String(fields.status || "").toUpperCase();
  var decision = String(fields.decision || "").toLowerCase();
  var table = String(fields.table || "").toLowerCase();
  var looksRefusedOrNogo =
    status.indexOf("REFUSED") !== -1 ||
    /no-go|refused|below threshold|out of icp/.test(decision) ||
    /table\s*2/.test(table);
  if (!looksRefusedOrNogo) return fields;
  var poc = String(fields.poc_email || "").trim();
  var hasEmail = !!(poc && poc.indexOf("@") !== -1);
  var blob = [
    fields.why,
    fields.reason_or_ambiguity,
    fields.fit_if_email_note
  ].map(function (x) { return String(x || ""); }).join(" \n ").toLowerCase();
  var emailish =
    !hasEmail ||
    /\bhunter\.?io\b|\bverified email\b|\bpoc email\b|\bmissing email\b|\bno email\b|\bunqualified poc\b|\bno qualified poc\b|\broster\b/.test(blob);
  var wouldGo = fit.indexOf("would-go") === 0 || !fit;
  var hunterEmpty =
    hunter &&
    (!hunter.emails || !hunter.emails.length) &&
    String(hunter.detail || "").indexOf("found_") !== 0;
  if (!emailish && !hunterEmpty) return fields;
  if (!wouldGo && hasEmail) return fields;
  if (/\bexisting client\b|\balready a client\b|\bout of icp\b|\bbankrupt/.test(blob)) return fields;
  var company = String(fields.company_name || "This company");
  fields.status = "OK";
  fields.table = "Table 3";
  fields.decision = "Ambiguous";
  fields.confidence_rating = "Ambiguous";
  fields.fit_if_email_secured = wouldGo && fit.indexOf("would-go") === 0 ? fields.fit_if_email_secured : "Would-go";
  fields.fit_if_email_note =
    fields.fit_if_email_note ||
    "Company and event would allow outreach once a verified qualified POC email is secured.";
  fields.reason_or_ambiguity =
    fields.reason_or_ambiguity && /email|hunter|poc/i.test(String(fields.reason_or_ambiguity))
      ? fields.reason_or_ambiguity
      : "Hunter email/roster is thin. Company and event otherwise look like a Would-go.";
  if (
    !String(fields.why || "").trim() ||
    status.indexOf("REFUSED") !== -1 ||
    /refused-escalate|table 2|no-go/i.test(String(fields.why || ""))
  ) {
    fields.why =
      "Hunter.io did not return a verified qualified POC email (roster thin or missing) for " +
      company +
      ". The company and the event otherwise look qualified for outreach. Secure a POC email, then Move to Go, or verify further before outreach.";
  }
  fields.override_available = fields.override_available || "Yes";
  if (!hasEmail) fields.poc_email = "";
  return fields;
}

async function hunterRosterForDomain(env, domain) {
  if (!hunterEnabled(env) || !looksLikeRealDomainWorker(domain)) {
    return { ok: false, emails: [], detail: "hunter_skipped" };
  }
  var apiKey = env.HUNTER_DOMAIN_SEARCH_KEY || env.HUNTER_API_KEY;
  if (!apiKey) return { ok: false, emails: [], detail: "hunter_key_missing" };
  try {
    var hunterUrl = new URL("https://api.hunter.io/v2/domain-search");
    hunterUrl.searchParams.set("api_key", apiKey);
    hunterUrl.searchParams.set("domain", normalizeHost(domain));
    hunterUrl.searchParams.set("limit", "10");
    var upstream = await fetch(hunterUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    var raw = await upstream.json().catch(function () {
      return null;
    });
    if (!upstream.ok) {
      return {
        ok: false,
        emails: [],
        detail: (raw && (raw.errors || raw.error || raw.message)) || ("HTTP " + upstream.status)
      };
    }
    var emails = (((raw && raw.data && raw.data.emails) || []) || []).map(function (row) {
      return {
        email: row.value || row.email || "",
        first_name: row.first_name || "",
        last_name: row.last_name || "",
        title: row.position || row.title || "",
        linkedin: (row.linkedin || row.linkedin_url || "") + ""
      };
    }).filter(function (row) {
      return !!String(row.email || "").trim();
    });
    return { ok: true, emails: emails, detail: "found_" + emails.length };
  } catch (e) {
    return { ok: false, emails: [], detail: String((e && e.message) || e) };
  }
}

async function callAnthropicClassify(env, userMessage) {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, detail: "ANTHROPIC_API_KEY missing" };
  }
  var upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1800,
      system: AUTO_ANALYZE_SYSTEM_PROMPT(),
      messages: [{ role: "user", content: userMessage }]
    })
  });
  var data = await upstream.json().catch(function () {
    return null;
  });
  if (!upstream.ok) {
    return {
      ok: false,
      detail: (data && data.error && data.error.message) || ("Anthropic HTTP " + upstream.status)
    };
  }
  var content = "";
  if (data && data.content && data.content.length) {
    content = data.content
      .map(function (part) {
        return part.text || "";
      })
      .join("\n");
  }
  var fields = parseLabeledFieldsWorker(content);
  if (!String(fields.decision || "").trim() && !String(fields.status || "").trim()) {
    return { ok: false, detail: "parse_failed", raw: String(content || "").slice(0, 500) };
  }
  return { ok: true, fields: fields };
}

async function analyzeOnePendingEvent(env, ev, extras, clients) {
  var profiles = (extras && extras.profiles) || [];
  var profile =
    profiles.find(function (p) {
      return p && p.company_id === ev.company_id;
    }) || null;
  var contacts = ((extras && extras.contacts) || []).filter(function (c) {
    return c && c.company_id === ev.company_id;
  });

  // Drop customer-platform / publisher domains before Hunter (monday.com, siliconrepublic.com).
  var hostGuard = normalizeHost(ev.domain);
  if (
    hostGuard &&
    (isCustomerPlatformHost(hostGuard) ||
      EXA_PUBLISHER_HOST_RE.test(hostGuard) ||
      isVcFirmHost(hostGuard) ||
      !domainMatchesCompanyWorker(ev.company_name, hostGuard))
  ) {
    var knownGuard = knownSubjectDomainWorker(ev.company_name);
    if (knownGuard) {
      ev.domain = knownGuard;
    } else if (
      isCustomerPlatformHost(hostGuard) ||
      EXA_PUBLISHER_HOST_RE.test(hostGuard) ||
      isVcFirmHost(hostGuard)
    ) {
      ev.domain = "";
    }
  }

  // Already retargeted off a publisher but still missing the startup domain.
  if (
    String(ev.entity_note || "").indexOf("redirected_from_publisher") !== -1 &&
    !looksLikeRealDomainWorker(ev.domain)
  ) {
    var megaEarly = megaFundingOutOfIcpFields(ev, profile);
    if (megaEarly) {
      return {
        ok: true,
        fields: megaEarly,
        hunterStatus: "skipped_mega_size",
        mode: "deterministic_mega"
      };
    }
    await ensureSubjectDomainWorker(env, ev);
    if (!looksLikeRealDomainWorker(ev.domain)) {
      return {
        ok: true,
        fields: subjectNeedsDomainFields(ev, true),
        hunterStatus: "skipped_publisher_redirect",
        mode: "publisher_redirect"
      };
    }
    // Domain resolved (e.g. Magnar → magnar.ai). Fall through to Hunter + classify.
  }

  // Story entity agent: when the queued row is a publisher or VC firm, extract the
  // funded/hired legaltech company from the article before scoring.
  var storyIdent = null;
  var hostNow = normalizeHost(ev.domain);
  if (
    isMediaOrVcCompanyName(ev.company_name) ||
    (hostNow && (EXA_PUBLISHER_HOST_RE.test(hostNow) || isVcFirmHost(hostNow)))
  ) {
    storyIdent = await extractStorySubjectCompany(
      env,
      ev.event_headline || "",
      ev.event_summary || "",
      ev.source_url || ""
    );
  }
  var resolved = resolvePublisherMisattribution(
    ev,
    ev.event_headline || "",
    ev.event_summary || "",
    ev.source_url || "",
    storyIdent
  );
  if (resolved.redirected) {
    // Persist retarget so the next snapshot shows Magnar/Harvey (not the publisher).
    try {
      // Publisher-attached headcount is unreliable; drop it so we don't trust TNW staff counts.
      ev.employee_count = null;
      if (!looksLikeRealDomainWorker(ev.domain)) {
        await ensureSubjectDomainWorker(env, ev);
      }
      var events = (extras && extras.events) || [];
      for (var ei = 0; ei < events.length; ei++) {
        if (events[ei] && events[ei].case_id === ev.case_id) {
          events[ei].company_name = ev.company_name;
          events[ei].domain = ev.domain;
          events[ei].entity_note = ev.entity_note;
          events[ei].employee_count = null;
          break;
        }
      }
      for (var pi = 0; pi < profiles.length; pi++) {
        if (profiles[pi] && profiles[pi].company_id === ev.company_id) {
          profiles[pi].company_name = ev.company_name;
          profiles[pi].domain = ev.domain;
          profiles[pi].employee_count = null;
          break;
        }
      }
    } catch (ePersist) { /* continue */ }
    var megaAfterRedirect = megaFundingOutOfIcpFields(ev, profile);
    if (megaAfterRedirect) {
      return {
        ok: true,
        fields: megaAfterRedirect,
        hunterStatus: "skipped_mega_size",
        mode: "publisher_redirect_mega"
      };
    }
    if (!looksLikeRealDomainWorker(ev.domain)) {
      return {
        ok: true,
        fields: subjectNeedsDomainFields(ev, true),
        hunterStatus: "skipped_publisher_redirect",
        mode: "publisher_redirect"
      };
    }
  } else if (resolved.publisher) {
    var subjectGuess = extractCompanyFromExa(ev.event_headline || "", ev.event_summary || "", ev.source_url || "");
    return {
      ok: true,
      fields: publisherFalsePositiveFields(ev, subjectGuess && subjectGuess.company_name),
      hunterStatus: "skipped_publisher",
      mode: "publisher_guard"
    };
  }

  var det = deterministicClassify(ev, profile, clients);
  if (det) {
    return { ok: true, fields: det, hunterStatus: "skipped_deterministic", mode: "deterministic" };
  }

  var hunter = await hunterRosterForDomain(env, ev.domain);
  var payload = {
    candidate_event: ev,
    company_profile: profile,
    company_contacts: contacts,
    hunter_roster: hunter.emails || [],
    hunter_status: hunter.detail,
    icp_rules:
      "legaltech only; employees 50-350; revenue 15-50mm preferred; vc/pe yes; TA 0-2; missing info => Ambiguous not No-go"
  };
  var userMessage = [
    "Classify this outreach candidate. Return only labeled OUTPUT fields.",
    "If the record still looks like a news publisher covering another startup, retarget company_name/domain to that startup or Table 3 asking for its website. Never Hunter the publisher.",
    "If hunter_roster is empty / sparse and company+event would otherwise qualify: Table 3 Ambiguous, decision Ambiguous, status OK, fit_if_email_secured Would-go. Do not REFUSED-ESCALATE or Table 2 No-go for email miss alone.",
    "CASE CONTEXT (JSON):",
    JSON.stringify(payload, null, 2)
  ].join("\n");
  var llm = await callAnthropicClassify(env, userMessage);
  if (!llm.ok) return { ok: false, detail: llm.detail, mode: "llm" };
  if (!llm.fields.company_name) llm.fields.company_name = ev.company_name;
  if (!llm.fields.domain) llm.fields.domain = ev.domain;
  if (!llm.fields.event_date) llm.fields.event_date = ev.event_date || "";
  if (!llm.fields.event_source_url) llm.fields.event_source_url = ev.source_url || "";
  llm.fields = coerceSparseHunterEmailFields(llm.fields, hunter);
  return {
    ok: true,
    fields: llm.fields,
    hunterStatus: hunter.detail || "",
    mode: "llm"
  };
}

async function runAutoAnalyze(env, opts) {
  opts = opts || {};
  if (!env.DB) {
    return { ok: false, detail: "store_missing", processed: 0 };
  }
  var extras = (await kvGet(env, "extras")) || {
    events: [],
    profiles: [],
    contacts: [],
    statuses: [],
    employment: []
  };
  var results = (await kvGet(env, "results")) || {};
  var clients = (await kvGet(env, "clients")) || [];
  var events = Array.isArray(extras.events) ? extras.events : [];
  var pending = events.filter(function (ev) {
    return eventReadyForAutoAnalyze(ev) && !caseHasDecision(results[ev.case_id]);
  });
  // Cap one HTTP/cron pass so Worker CPU stays bounded. Only unscored pending.
  var limit = Math.min(Math.max(parseInt(opts.limit || "8", 10) || 8, 1), 12);
  var batch = pending.slice(0, limit);
  var ok = 0;
  var errors = 0;
  var outcomes = [];
  var extrasDirty = false;

  for (var i = 0; i < batch.length; i++) {
    var ev = batch[i];
    try {
      var beforeName = String(ev.company_name || "");
      var beforeDomain = String(ev.domain || "");
      var outcome = await analyzeOnePendingEvent(env, ev, extras, clients);
      if (
        String(ev.company_name || "") !== beforeName ||
        String(ev.domain || "") !== beforeDomain ||
        String(ev.entity_note || "").indexOf("redirected_from_publisher") !== -1
      ) {
        extrasDirty = true;
      }
      if (!outcome.ok || !outcome.fields) {
        errors += 1;
        outcomes.push({ case_id: ev.case_id, ok: false, detail: outcome.detail || "failed" });
        continue;
      }
      var prev = results[ev.case_id] || {};
      results[ev.case_id] = {
        lastFields: outcome.fields,
        humanComplete: !!prev.humanComplete,
        humanStateText: prev.humanStateText || "",
        humanOutcome: prev.humanOutcome || "",
        sequenceStop: prev.sequenceStop || null,
        deletedSequenceSteps: prev.deletedSequenceSteps || {},
        hunterStatus: outcome.hunterStatus || prev.hunterStatus || "",
        auto_analyzed_at: new Date().toISOString(),
        auto_analyze_mode: outcome.mode || "llm"
      };
      ok += 1;
      outcomes.push({
        case_id: ev.case_id,
        ok: true,
        decision: outcome.fields.decision || "",
        mode: outcome.mode,
        company_name: ev.company_name,
        domain: ev.domain
      });
      try {
        await env.DB.prepare(
          "INSERT INTO audit (created_at, case_id, company_name, agent_decision, human_action, detail) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(
            new Date().toISOString(),
            String(ev.case_id || "").slice(0, 64),
            String(ev.company_name || "").slice(0, 200),
            String((outcome.fields.status || "") + "/" + (outcome.fields.decision || "")).slice(0, 120),
            "auto_analyze",
            String(outcome.mode || "llm").slice(0, 200)
          )
          .run();
      } catch (auditErr) {
        /* keep going */
      }
    } catch (e) {
      errors += 1;
      outcomes.push({
        case_id: ev.case_id,
        ok: false,
        detail: String((e && e.message) || e)
      });
    }
  }

  if (ok) {
    var latestResults = (await kvGet(env, "results")) || {};
    results = mergeResultsBlobs(latestResults, results);
    await kvPut(env, "results", results);
  }
  if (extrasDirty) {
    await kvPut(env, "extras", extras);
  }

  var remaining = Math.max(0, pending.length - batch.length);
  return {
    ok: true,
    pending_total: pending.length,
    pending_remaining: remaining,
    processed: batch.length,
    classified: ok,
    errors: errors,
    outcomes: outcomes
  };
}

/** Drain unscored pending in short rounds. Never re-scores decided cases. */
async function drainPendingAutoAnalyze(env, opts) {
  opts = opts || {};
  var perRound = Math.min(Math.max(parseInt(opts.limit || "8", 10) || 8, 1), 12);
  var maxRounds = Math.min(Math.max(parseInt(opts.maxRounds || "3", 10) || 3, 1), 5);
  var total = {
    ok: true,
    pending_total: 0,
    pending_remaining: 0,
    processed: 0,
    classified: 0,
    errors: 0,
    rounds: 0,
    outcomes: []
  };
  for (var r = 0; r < maxRounds; r++) {
    var summary = await runAutoAnalyze(env, { limit: perRound });
    if (!summary || !summary.ok) {
      return summary || { ok: false, detail: "auto_analyze_failed" };
    }
    total.rounds += 1;
    total.pending_total = Math.max(total.pending_total, summary.pending_total || 0);
    total.processed += summary.processed || 0;
    total.classified += summary.classified || 0;
    total.errors += summary.errors || 0;
    total.pending_remaining = summary.pending_remaining || 0;
    if (Array.isArray(summary.outcomes)) {
      total.outcomes = total.outcomes.concat(summary.outcomes);
    }
    if (!(summary.processed > 0) || !(summary.pending_remaining > 0)) break;
  }
  return total;
}

async function handleAutoAnalyzeRequest(request, env, cors) {
  if (!env.DB) return storeMissing(cors);
  var limit = 8;
  var maxRounds = 3;
  try {
    if (request.method === "POST") {
      var body = await request.json().catch(function () {
        return null;
      });
      if (body && body.limit != null) limit = body.limit;
      if (body && body.maxRounds != null) maxRounds = body.maxRounds;
    }
  } catch (e) {
    /* default limit */
  }
  var summary = await drainPendingAutoAnalyze(env, { limit: limit, maxRounds: maxRounds });
  return jsonResponse(summary, summary.ok ? 200 : 500, cors);
}

function slugifyTokenWorker(text) {
  return (
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 28) || "co"
  );
}

function inferEventTypeWorker(blob) {
  var t = String(blob || "");
  if (
    /(?:joins?|joined|joining|appoints?|appointed|named|names|welcomes?)\b[\s\S]{0,90}\b(?:as|chief|CRO|CEO|CFO|COO|VP|Head of)/i.test(t) ||
    /\bas (?:our |the |a |an )?(?:new )?(?:chief|CRO|CEO|CFO|COO|VP|Head of)/i.test(t)
  ) {
    return "executive_hire";
  }
  if (/series\s+[a-z]\b|raised \$?[\d]|closes? \$?[\d]|funding round|seed round|pre-seed/i.test(t)) {
    return "funding_round";
  }
  if (/\b(?:hire|hires|hired|appoints?|appointed|joins?|joined|named|names)\b/i.test(t)) return "executive_hire";
  if (/\bpartner(?:ship|ed)\b/i.test(t)) return "strategic_partnership";
  return "funding_round";
}

function guessHostFromUrl(url) {
  try {
    var host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || EXA_PUBLISHER_HOST_RE.test(host)) return "";
    return host;
  } catch (e) {
    return "";
  }
}

function isVcFirmHost(host) {
  return EXA_VC_HOST_RE.test(String(host || ""));
}

function isMediaOrVcCompanyName(name) {
  var n = String(name || "").trim();
  if (!n) return true;
  if (EXA_MEDIA_OR_VC_NAME_RE.test(n)) return true;
  if (/\b(ventures|capital|partners|fund|media|magazine|news|list|blog)\b/i.test(n) && n.split(/\s+/).length <= 4) {
    // "Lux Capital" / "Index Ventures" are investors, not the legaltech subject.
    if (!/\b(legal|law|tech|ai|software|platform)\b/i.test(n)) return true;
  }
  // Glued brands: Luxcapital, Sequoiacap, Indexventures
  var compact = n.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    compact.length >= 6 &&
    /(ventures|capital|partners|fund)$/.test(compact) &&
    !/(legal|law|tech|ai|software)/.test(compact)
  ) {
    return true;
  }
  return false;
}

function isPlaceholderCompanyNameWorker(name) {
  var n = String(name || "").trim();
  if (isNumericOcrGarbageName(n)) return true;
  return /^(company|startup|platform|news|publisher|press|live\s*company\s*\d+)$/i.test(n);
}

function isCustomerPlatformHost(host) {
  var h = normalizeHost(host);
  if (!h) return false;
  return EXA_CUSTOMER_PLATFORM_HOST_RE.test(h);
}

function titleCaseTokenWorker(tok) {
  var t = String(tok || "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Pull startup slug from news URL paths like /ai-start-up-newcode-adds-… or /chamelio-raises-26m-… */
function companyFromNewsUrlPath(url) {
  try {
    var path = decodeURIComponent(String(new URL(url).pathname || "")).toLowerCase();
    var m =
      path.match(/(?:ai[-_]?start[-_]?ups?|start[-_]?ups?)[-_/]+([a-z0-9]{3,40})(?:[-_/]|$)/i) ||
      path.match(/\/([a-z0-9]{3,40})[-_](?:raises?|raised|secures?|closes?|announces?|hires?|names?|appoints?|lands?)(?:[-_]|$)/i) ||
      path.match(/\/([a-z0-9]{3,40})[-_](?:series[-_]?[a-d]|seed|funding|growth)(?:[-_]|$)/i);
    if (!m || !m[1]) return "";
    var slug = String(m[1] || "").replace(/[^a-z0-9]/gi, "");
    if (!slug || slug.length < 3) return "";
    if (
      /^(series|funding|startup|startups|company|legaltech|tech|news|press|raises|raised)$/i.test(slug)
    ) {
      return "";
    }
    if (isMediaOrVcCompanyName(slug)) return "";
    return titleCaseTokenWorker(slug);
  } catch (e) {
    return "";
  }
}

function domainMatchesCompanyWorker(companyName, domain) {
  var host = normalizeHost(domain);
  if (!host || !looksLikeRealDomainWorker(host)) return false;
  if (EXA_PUBLISHER_HOST_RE.test(host) || isVcFirmHost(host) || isCustomerPlatformHost(host)) {
    return false;
  }
  var slug = slugifyTokenWorker(companyName).replace(/-/g, "");
  if (!slug || slug.length < 3) return false;
  var hostSlug = host.split(".")[0].replace(/-/g, "");
  if (hostSlug === slug) return true;
  if (hostSlug.indexOf(slug) !== -1 || slug.indexOf(hostSlug) !== -1) return true;
  return false;
}

/** When Exa grabbed a magazine host, pull the funded/hired company from the article and retarget. */
function resolvePublisherMisattribution(ev, title, text, url, preferredIdent) {
  if (!ev) return { redirected: false, publisher: false, subject: null };
  var host = normalizeHost(ev.domain);
  var nameIsPub = isMediaOrVcCompanyName(ev.company_name);
  var domainIsPub = !!(host && (EXA_PUBLISHER_HOST_RE.test(host) || isVcFirmHost(host)));
  if (!nameIsPub && !domainIsPub) return { redirected: false, publisher: false, subject: null };

  var ident =
    preferredIdent && preferredIdent.company_name
      ? preferredIdent
      : extractCompanyFromExa(
          title || ev.event_headline || "",
          text || ev.event_summary || "",
          url || ev.source_url || ""
        );
  if (!ident.company_name || isMediaOrVcCompanyName(ident.company_name)) {
    return { redirected: false, publisher: true, subject: null };
  }
  if (sameCompanyWorker(ident.company_name, ident.domain, ev.company_name, ev.domain) && !domainIsPub) {
    return { redirected: false, publisher: false, subject: ident };
  }

  var fromName = String(ev.company_name || "");
  var fromDomain = String(ev.domain || "");
  ev.company_name = ident.company_name;
  if (
    ident.domain &&
    looksLikeRealDomainWorker(ident.domain) &&
    !EXA_PUBLISHER_HOST_RE.test(ident.domain) &&
    !isVcFirmHost(ident.domain)
  ) {
    ev.domain = ident.domain;
  } else if (domainIsPub) {
    ev.domain = "";
  }
  // Well-known legaltech subjects when the article names them but the publisher host was stored.
  if (!looksLikeRealDomainWorker(ev.domain)) {
    var known = knownSubjectDomainWorker(ev.company_name);
    if (known) ev.domain = known;
  }
  var note = String(ev.entity_note || "");
  if (note.indexOf("redirected_from_publisher") === -1) {
    ev.entity_note =
      (note ? note + "; " : "") +
      "redirected_from_publisher:" +
      fromName +
      (fromDomain ? "/" + fromDomain : "");
  }
  return { redirected: true, publisher: true, subject: ident, from_name: fromName, from_domain: fromDomain };
}

function knownSubjectDomainWorker(companyName) {
  var slug = slugifyTokenWorker(companyName).replace(/-/g, "");
  var map = {
    harvey: "harvey.ai",
    magnar: "magnar.ai",
    crosby: "crosby.ai",
    xapien: "xapien.com",
    chamelio: "chamelio.ai",
    chameilo: "chamelio.ai",
    newcode: "newcode.ai",
    lexroom: "lexroom.ai"
  };
  return map[slug] || "";
}

/**
 * True legaltech = practice-of-law / litigation / e-discovery / court / legal workflow software.
 * KYC, AML, AI due diligence, OSINT, and third-party risk research (e.g. Xapien) are out of ICP
 * even when law firms buy them for compliance onboarding.
 */
function classifyNonLegaltechSignal(blob, companyName, domain) {
  var text = String(blob || "");
  var name = String(companyName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  var host = normalizeHost(domain);
  if (name === "xapien" || host === "xapien.com") {
    return { sector: "kyc_due_diligence", label: "AI due diligence / KYC (not legaltech)" };
  }
  var strongLegal =
    /\b(?:legaltech|legal\s*tech|legal\s*ai|e-?discovery|ediscovery|e-?filing|efiling|litigation\s+(?:software|platform|tech)|practice\s+(?:of\s+)?law|matter\s+management|court\s+(?:workflow|filing|docket)|contract\s+(?:review|lifecycle|drafting)\s+for\s+(?:law|legal)|in-house\s+legal\s+ops(?:erations)?\s+platform)\b/i.test(
      text
    );
  var strongNonLegal =
    /\b(?:know\s+your\s+customer|\bKYC\b|\bAML\b|anti-?money\s+launder|due\s+diligence\s+(?:platform|tool|software|reports?)|AI[- ]powered\s+due\s+diligence|third[- ]party\s+risk|OSINT|open[- ]source\s+intelligence|entity\s+resolution\s+(?:engine|for\s+compliance)|perpetual\s+KYC|background\s+research\s+reports?|risk\s+(?:&|and)\s+compliance\s+research)\b/i.test(
      text
    );
  if (strongNonLegal && !strongLegal) {
    return { sector: "kyc_due_diligence", label: "KYC / due diligence / OSINT (not legaltech)" };
  }
  if (
    /\b(?:entity\s+management|registered\s+agent|corp(?:orate)?\s+sec(?:retary|urity)?|HR\s*tech|fintech)\b/i.test(text) &&
    !strongLegal
  ) {
    return { sector: "entity_management", label: "Entity management / adjacent (not legaltech)" };
  }
  return null;
}

function articleClearlyNonLegaltech(title, text, companyName, domain) {
  return classifyNonLegaltechSignal(
    String(title || "") + "\n" + String(text || "") + "\n" + String(companyName || ""),
    companyName,
    domain
  );
}

function domainCandidatesForCompanyWorker(companyName, textBlob) {
  var slug = slugifyTokenWorker(companyName).replace(/-/g, "");
  var out = [];
  var known = knownSubjectDomainWorker(companyName);
  if (known) out.push(known);
  if (slug && slug.length >= 3) {
    var blob = String(textBlob || "");
    var m = blob.match(
      new RegExp("\\b(" + slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "\\.(?:ai|io|com|co|app|tech))\\b", "i")
    );
    if (m && m[1] && out.indexOf(String(m[1]).toLowerCase()) === -1) {
      out.push(String(m[1]).toLowerCase());
    }
    [".ai", ".com", ".io", ".co"].forEach(function (tld) {
      var d = slug + tld;
      if (out.indexOf(d) === -1) out.push(d);
    });
  }
  return out.filter(function (d) {
    return (
      looksLikeRealDomainWorker(d) &&
      !EXA_PUBLISHER_HOST_RE.test(d) &&
      !isVcFirmHost(d) &&
      !isCustomerPlatformHost(d)
    );
  }).slice(0, 4);
}

/** When publisher redirect left domain blank, probe Hunter on likely company sites (e.g. Magnar → magnar.ai). */
async function ensureSubjectDomainWorker(env, ev) {
  if (!ev) return "";
  if (looksLikeRealDomainWorker(ev.domain)) return normalizeHost(ev.domain);
  var cands = domainCandidatesForCompanyWorker(
    ev.company_name,
    String(ev.event_headline || "") + "\n" + String(ev.event_summary || "") + "\n" + String(ev.source_url || "")
  );
  if (!cands.length) return "";
  // Prefer known map immediately so scoring can continue even if Hunter is temporarily empty.
  var known = knownSubjectDomainWorker(ev.company_name);
  if (known) {
    ev.domain = known;
    return known;
  }
  for (var i = 0; i < cands.length; i++) {
    var hunter = await hunterRosterForDomain(env, cands[i]);
    if (hunter && hunter.ok && hunter.emails && hunter.emails.length) {
      ev.domain = cands[i];
      return cands[i];
    }
  }
  // Last resort: first candidate (.ai/.com) so Move-to-Go / next pass can Hunter again.
  if (cands[0]) {
    ev.domain = cands[0];
    return cands[0];
  }
  return "";
}

function publisherFalsePositiveFields(ev, subjectName) {
  var subject = String(subjectName || "").trim();
  var why = subject
    ? String(ev.company_name || "This publisher") +
      " is a news site that covered " +
      subject +
      ", not the company that raised or hired. Do not outreach the publisher. Confirm " +
      subject +
      "'s real website domain and score that company instead."
    : String(ev.company_name || "This publisher") +
      " looks like a news or media site, not a legaltech vendor. Do not outreach this domain. Find the startup named in the Exa.ai article and confirm its website.";
  return {
    status: "OK",
    table: "Table 2",
    decision: "No-go",
    confidence_rating: "High",
    company_name: ev.company_name,
    domain: ev.domain,
    poc_name: "",
    poc_title: "",
    poc_email: "",
    fit_if_email_secured: "Still-blocked",
    fit_if_email_note: "Publisher false positive. Still-blocked even with email.",
    sector: "media",
    employee_count: "",
    revenue_estimate: "",
    vc_pe_backed: "",
    ta_headcount: "",
    persona_assigned: "",
    persona_used: "",
    trigger_event: String(ev.event_type || ""),
    event_date: String(ev.event_date || ""),
    event_source_url: String(ev.source_url || ""),
    reason_or_ambiguity: "Publisher false positive",
    override_available: "No",
    citations: String(ev.case_id || "") + ", exa-publisher-guard",
    corrected_company_name: subject,
    why: why
  };
}

function subjectNeedsDomainFields(ev, fromPublisher) {
  var subject = String(ev.company_name || "This startup").trim();
  var why =
    "Exa.ai covered " +
    subject +
    (fromPublisher ? " on a news site, not as the article publisher" : "") +
    ". We identified " +
    subject +
    " as the company that raised or hired, but we do not yet have its real website domain. Confirm the domain (company site, not the magazine), then scoring can continue. Do not contact the news publisher.";
  return {
    status: "OK",
    table: "Table 3",
    decision: "Ambiguous",
    confidence_rating: "Ambiguous",
    company_name: ev.company_name,
    domain: ev.domain || "",
    poc_name: "",
    poc_title: "",
    poc_email: "",
    fit_if_email_secured: "Would-go",
    fit_if_email_note: "Would-go once the real company domain is confirmed.",
    sector: String(ev.sector || "legaltech"),
    employee_count: String(ev.employee_count != null ? ev.employee_count : ""),
    revenue_estimate: String(ev.revenue_estimate_mm != null ? ev.revenue_estimate_mm : ""),
    vc_pe_backed: String(ev.vc_pe_backed || ""),
    ta_headcount: String(ev.ta_headcount != null ? ev.ta_headcount : ""),
    persona_assigned: "",
    persona_used: "",
    trigger_event: String(ev.event_type || ""),
    event_date: String(ev.event_date || ""),
    event_source_url: String(ev.source_url || ""),
    reason_or_ambiguity: "Subject company domain not confirmed",
    override_available: "Yes",
    citations: String(ev.case_id || "") + ", exa-publisher-redirect",
    why: why
  };
}

/**
 * Story entity agent: read the Exa article and return the legaltech company that
 * raised / hired — never the VC firm or magazine hosting the post.
 */
async function extractStorySubjectCompany(env, title, text, url) {
  var regexIdent = extractCompanyFromExa(title, text, url);
  if (
    regexIdent &&
    regexIdent.company_name &&
    !isMediaOrVcCompanyName(regexIdent.company_name)
  ) {
    if (!regexIdent.domain) {
      var knownR = knownSubjectDomainWorker(regexIdent.company_name);
      if (knownR) regexIdent.domain = knownR;
    }
    return regexIdent;
  }
  var llmIdent = await callAnthropicStoryEntity(env, title, text, url);
  if (llmIdent && llmIdent.company_name && !isMediaOrVcCompanyName(llmIdent.company_name)) {
    if (!llmIdent.domain) {
      var knownL = knownSubjectDomainWorker(llmIdent.company_name);
      if (knownL) llmIdent.domain = knownL;
    }
    return llmIdent;
  }
  return regexIdent || { company_name: "", domain: "" };
}

async function callAnthropicStoryEntity(env, title, text, url) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    var upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        system: [
          "You extract the outreach target company from a funding or hiring news story.",
          "The target is the startup that raised money or hired — NEVER the venture firm, PE firm, or news publisher writing about them (including Foundernews, LatamList, TechCrunch, Lux Capital).",
          "Possessive funding lines count: \"The deal pushes Xapien's total equity funding past $73 million\" → company_name Xapien, domain xapien.com.",
          "Examples: Lux Capital 'We're Backing Crosby' → Crosby / crosby.ai. LatamList article about Magnar → Magnar.",
          "Return ONLY labeled lines:",
          "company_name:",
          "domain:",
          "confidence: high|medium|low",
          "If unclear, leave company_name blank."
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              "TITLE: " + String(title || ""),
              "URL: " + String(url || ""),
              "ARTICLE:",
              String(text || "").slice(0, 3500)
            ].join("\n")
          }
        ]
      })
    });
    var data = await upstream.json().catch(function () {
      return null;
    });
    if (!upstream.ok || !data) return null;
    var content = "";
    if (data.content && data.content.length) {
      content = data.content
        .map(function (part) {
          return part.text || "";
        })
        .join("\n");
    }
    var fields = parseLabeledFieldsWorker(content);
    var name = String(fields.company_name || "").trim();
    var domain = String(fields.domain || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!name || isMediaOrVcCompanyName(name)) return null;
    if (domain && (EXA_PUBLISHER_HOST_RE.test(domain) || isVcFirmHost(domain))) domain = "";
    if (!looksLikeRealDomainWorker(domain)) domain = "";
    return { company_name: name, domain: domain };
  } catch (e) {
    return null;
  }
}

function extractCompanyFromExa(title, text, url) {
  var titleStr = String(title || "").trim();
  var blob = titleStr + "\n" + String(text || "");
  var name = "";
  var patterns = [
    // "We're Backing Crosby…" / VC post about a portfolio company
    /\b(?:we(?:'re| are)?\s+)?(?:backing|backs|backed)\s+([A-Z][A-Za-z0-9&.-]{1,40})\b/i,
    /\b(?:leading|co-leading|coleading)\s+([A-Z][A-Za-z0-9&.-]{1,40})(?:['’]s)?\s+(?:\$|Series|seed|growth|funding)/i,
    /\binvest(?:ing|ed|s)?\s+in\s+([A-Z][A-Za-z0-9&.-]{1,40})\b/i,
    /\bportfolio\s+compan(?:y|ies)\s+([A-Z][A-Za-z0-9&.-]{1,40})\b/i,
    // "The deal pushes Xapien's total equity funding past $73 million"
    /\b(?:pushes|brings|takes|lifts)\s+([A-Z][A-Za-z0-9&.-]{1,40})['’]s\s+(?:total\s+)?(?:equity\s+)?(?:funding|raise|valuation|capital)/i,
    /\b([A-Z][A-Za-z0-9&.-]{1,40})['’]s\s+(?:total\s+)?(?:equity\s+)?(?:funding|raise|valuation|Series|seed|growth)\b/i,
    // "Chilean legaltech startup Magnar raised..." / "Italian legaltech Lexroom acquires..."
    /(?:chilean|brazilian|mexican|canadian|british|uk|us|american|european|latam|latin\s*american|norwegian|italian)?\s*(?:legaltech|legal\s*ai|ai|fintech)?\s*(?:startup|company|platform)?\s*([A-Z][A-Za-z0-9&.-]{1,32}(?:\s+[A-Z][A-Za-z0-9&.-]{1,32}){0,2})\s+(?:raises|raised|announces|secures|closes|hires|names|appoints|lands|acquires|acquired|buys|bought)/i,
    // "Magnar raises $8M" / "Lexroom acquires Query Juriste"
    /\b([A-Z][A-Za-z0-9&.-]{1,32}(?:\s+[A-Z][A-Za-z0-9&.-]{1,32}){0,2})\s+(?:raises|raised|announces|hires|names|appoints|welcomes|closes|secures|lands|acquires|acquired|buys|bought)\b/i,
    // "startup Magnar,"
    /(?:startup|company|platform)\s+([A-Z][A-Za-z0-9&.-]{1,32}(?:\s+[A-Z][A-Za-z0-9&.-]{1,32}){0,2})\b/,
    /\b(?:joins?|joined)\s+(?:us\s+at\s+|the\s+team\s+at\s+)?([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,2})/i,
    /\b(?:CRO|CEO|CFO|COO|VP Sales|Head of Sales)\s+(?:of|at)\s+([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,2})/i
  ];
  for (var pi = 0; pi < patterns.length; pi++) {
    var m = blob.match(patterns[pi]);
    if (!m || !m[1]) continue;
    var candidate = String(m[1] || "").trim();
    if (isMediaOrVcCompanyName(candidate) || isPlaceholderCompanyNameWorker(candidate)) continue;
    name = candidate;
    break;
  }
  try {
    var path = new URL(url).pathname || "";
    var li = path.match(/\/company\/([a-z0-9-]+)/i);
    if (!name && li) {
      name = String(li[1] || "")
        .split("-")
        .map(function (w) {
          return w ? w.charAt(0).toUpperCase() + w.slice(1) : "";
        })
        .join(" ");
      if (isMediaOrVcCompanyName(name) || isPlaceholderCompanyNameWorker(name)) name = "";
    }
  } catch (e) { /* ignore */ }
  if (!name) {
    var fromPath = companyFromNewsUrlPath(url);
    if (fromPath) name = fromPath;
  }
  var host = guessHostFromUrl(url);
  // Never invent the company from a news/magazine host (e.g. latamlist.com)
  // or from OCR-garbage domains (e.g. 178900472.ai → "178900472").
  if (
    !name &&
    host &&
    looksLikeRealDomainWorker(host) &&
    !isNumericOcrGarbageDomain(host) &&
    !EXA_PUBLISHER_HOST_RE.test(host) &&
    !isVcFirmHost(host) &&
    !isCustomerPlatformHost(host)
  ) {
    name = host.split(".")[0];
    name = name.charAt(0).toUpperCase() + name.slice(1);
    if (
      isMediaOrVcCompanyName(name) ||
      isPlaceholderCompanyNameWorker(name) ||
      isNumericOcrGarbageName(name)
    ) {
      name = "";
    }
  }
  name = String(name || "")
    .replace(/^(Legaltech|Legal AI|Startup|Company|Platform|Chilean|Brazilian|Mexican|Norwegian|Italian)\s+/i, "")
    .replace(/\s+(Inc\.?|LLC|Ltd\.?|Corp\.?)$/i, "")
    .trim();
  if (
    name.length < 3 ||
    name.length > 48 ||
    isMediaOrVcCompanyName(name) ||
    isPlaceholderCompanyNameWorker(name) ||
    isNumericOcrGarbageName(name)
  ) {
    name = "";
  }
  var domain = "";
  var knownMap = name ? knownSubjectDomainWorker(name) : "";
  if (knownMap) domain = knownMap;
  var slug = slugifyTokenWorker(name).replace(/-/g, "");
  if (!domain && slug.length >= 3) {
    var dm = blob.match(
      new RegExp(
        "\\b(?:https?:\\/\\/)?(?:www\\.)?(" +
          slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") +
          "\\.(?:ai|io|com|co|app|so|dev|tech|legal|com\\.br))\\b",
        "i"
      )
    );
    if (dm) domain = String(dm[1] || "").toLowerCase();
  }
  if (
    !domain &&
    host &&
    looksLikeRealDomainWorker(host) &&
    !EXA_PUBLISHER_HOST_RE.test(host) &&
    !isVcFirmHost(host) &&
    !isCustomerPlatformHost(host)
  ) {
    var urlSlug = host.split(".")[0].replace(/-/g, "");
    if (!slug || urlSlug === slug) domain = host;
  }
  // Never adopt a random article domain (customer logos like monday.com, publisher hosts).
  if (domain && !domainMatchesCompanyWorker(name, domain) && !knownSubjectDomainWorker(name)) {
    domain = "";
  }
  if (
    domain &&
    (EXA_PUBLISHER_HOST_RE.test(domain) || isVcFirmHost(domain) || isCustomerPlatformHost(domain))
  ) {
    domain = "";
  }
  if (!domain && name) {
    var knownAgain = knownSubjectDomainWorker(name);
    if (knownAgain) domain = knownAgain;
  }
  return { company_name: name, domain: domain };
}

function sameCompanyWorker(nameA, domainA, nameB, domainB) {
  var da = normalizeHost(domainA);
  var db = normalizeHost(domainB);
  var na = String(nameA || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  var nb = String(nameB || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (da && db && looksLikeRealDomainWorker(da) && looksLikeRealDomainWorker(db) && da === db) return true;
  if (na && nb && na.length >= 3 && na === nb) return true;
  // "Legal-tech Newcode" should match Newcode.
  if (na && nb && na.length >= 4 && nb.length >= 4 && (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1)) {
    return true;
  }
  var slugA = da ? da.split(".")[0].replace(/-/g, "") : "";
  var slugB = db ? db.split(".")[0].replace(/-/g, "") : "";
  if (slugA && slugA.length >= 3 && (slugA === nb || slugA === slugB)) return true;
  if (slugB && slugB.length >= 3 && slugB === na) return true;
  return false;
}

function cleanSubjectCompanyNameWorker(name) {
  var n = String(name || "").trim();
  n = n.replace(/^(legal[\s-]*tech|legaltech|ai|startup|company|platform)\s+/i, "").trim();
  n = n.replace(/\s+(Inc\.?|LLC|Ltd\.?|Corp\.?)$/i, "").trim();
  if (isPlaceholderCompanyNameWorker(n) || isMediaOrVcCompanyName(n)) return "";
  return n;
}

function findQueuedEvent(extras, name, domain, url) {
  var events = (extras && extras.events) || [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev) continue;
    if (url && (ev.source_url === url || (ev.source_urls && ev.source_urls.indexOf(url) !== -1))) return ev;
    if (sameCompanyWorker(name, domain, ev.company_name, ev.domain)) return ev;
  }
  return null;
}

function attachStoryToEvent(ev, result) {
  if (!ev || !result) return;
  var url = String(result.url || "").trim();
  ev.source_urls = Array.isArray(ev.source_urls) ? ev.source_urls : ev.source_url ? [ev.source_url] : [];
  if (url && ev.source_urls.indexOf(url) === -1) ev.source_urls.push(url);
  if (!ev.source_url && url) ev.source_url = url;
}

function upsertExtrasRow(list, row, key) {
  if (!row || !key) return;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i][key] === row[key]) {
      list[i] = row;
      return;
    }
  }
  list.push(row);
}

async function runExaIngest(env, source) {
  var now = new Date();
  var extras = (await kvGet(env, "extras")) || {
    events: [],
    profiles: [],
    contacts: [],
    statuses: [],
    employment: []
  };
  extras.events = extras.events || [];
  extras.profiles = extras.profiles || [];
  extras.contacts = extras.contacts || [];
  extras.statuses = extras.statuses || [];
  extras.employment = extras.employment || [];
  extras.attached_sources = extras.attached_sources || {};
  var clients = (await kvGet(env, "clients")) || [];

  var purged = purgeStaleLiveExaExtras(extras, now);
  var resultsForScrub = (await kvGet(env, "results")) || {};
  var scrubbed = scrubPublisherAndNonLegaltechExtras(extras, resultsForScrub);
  var repaired = repairMisattributedEntities(extras, scrubbed.results || resultsForScrub);
  if (scrubbed.changed || repaired.changed) {
    await kvPut(env, "extras", extras);
    await kvPut(env, "results", repaired.results || scrubbed.results || resultsForScrub);
  }

  var packed = await searchExaResults(env, EXA_DEFAULT_QUERY, 6);
  if (!packed.ok) {
    if (purged.dropped) {
      await kvPut(env, "extras", extras);
    }
    var fail = {
      ok: false,
      at: now.toISOString(),
      source: source || "cron",
      error: packed.error || "exa_failed",
      added: 0,
      attached: 0,
      skipped: 0,
      skipped_old: 0,
      skipped_undated: 0,
      purged_stale: purged.dropped,
      max_age_days: EXA_MAX_AGE_DAYS
    };
    await kvPut(env, "ingest_status", fail);
    return fail;
  }

  var added = 0;
  var attached = 0;
  var skipped = 0;
  var skippedOld = 0;
  var skippedUndated = 0;
  var skipReasons = [];
  var newCaseIds = [];
  (packed.results || []).forEach(function (r) {
    var url = String(r.url || "").trim();
    if (!url) {
      skipped += 1;
      return;
    }
    var freshness = assessExaEventFreshness(r.publishedDate, now);
    if (!freshness.ok) {
      skipped += 1;
      if (freshness.reason === "missing_or_unparseable_date") skippedUndated += 1;
      else skippedOld += 1;
      skipReasons.push({
        title: String(r.title || "").slice(0, 80),
        url: url,
        publishedDate: String(r.publishedDate || ""),
        reason: freshness.reason,
        age_days: freshness.age_days
      });
      return;
    }
    var ident = extractCompanyFromExa(r.title, r.text, url);
    if (matchClientBookWorker(clients, ident.company_name, ident.domain)) {
      skipped += 1;
      return;
    }
    var nonLegalHit = articleClearlyNonLegaltech(r.title, r.text, ident.company_name, ident.domain);
    if (nonLegalHit) {
      skipped += 1;
      skipReasons.push({
        title: String(r.title || "").slice(0, 80),
        url: url,
        publishedDate: String(r.publishedDate || ""),
        reason: "not_legaltech",
        sector: nonLegalHit.sector,
        company_name: ident.company_name || ""
      });
      return;
    }
    var existing = findQueuedEvent(extras, ident.company_name, ident.domain, url);
    if (existing) {
      var existingFresh = assessExaEventFreshness(existing.event_date, now);
      if (!existingFresh.ok && String(existing.case_id || "").indexOf("CE-LX-") === 0) {
        // Stale queued row must not absorb new stories; drop it and continue as a new add.
        removeExtrasEventAndRelated(extras, existing.case_id, existing.company_id);
        purged.dropped += 1;
        existing = null;
      } else {
        attachStoryToEvent(existing, r);
        attached += 1;
        return;
      }
    }
    // Entity Checker gate: never post numeric OCR husks or publisher domains.
    var checked = runEntityCheckerGate(ident, r.title, r.text, url);
    if (!checked.ok) {
      skipped += 1;
      skipReasons.push({
        title: String(r.title || "").slice(0, 80),
        url: url,
        publishedDate: String(r.publishedDate || ""),
        reason: "entity_checker_hold",
        fail_reasons: checked.fail_reasons || [],
        company_name: checked.company_name || ident.company_name || ""
      });
      return;
    }
    ident.company_name = checked.company_name;
    ident.domain = checked.domain;
    if (!ident.company_name || !looksLikeRealDomainWorker(ident.domain)) {
      skipped += 1;
      return;
    }
    var slug = slugifyTokenWorker(ident.company_name).toUpperCase().replace(/-/g, "").slice(0, 10) || "X";
    var stamp = Date.now().toString(36) + added;
    var caseId = "CE-LX-" + slug + "-" + stamp;
    var companyId = "CO-LX-" + slug + "-" + stamp;
    var contactId = "CT-LX-" + slug + "-" + stamp;
    var blob = String(r.title || "") + " " + String(r.text || "");
    var eventType = inferEventTypeWorker(blob);
    var summary = String(r.text || r.title || "").replace(/\s+/g, " ").trim().slice(0, 900);
    var published = freshness.date;
    extras.events.push({
      case_id: caseId,
      company_id: companyId,
      company_name: ident.company_name,
      domain: ident.domain,
      event_type: eventType,
      event_headline: String(r.title || "").slice(0, 160),
      event_summary: summary,
      event_date: published,
      source_url: url,
      source_urls: [url],
      sector: "legaltech",
      employee_count: null,
      revenue_estimate_mm: null,
      vc_pe_backed: "yes",
      ta_headcount: null,
      entity_note: "live_exa_refresh; auto_confirmed_domain",
      live_exa: true
    });
    upsertExtrasRow(
      extras.profiles,
      {
        company_id: companyId,
        company_name: ident.company_name,
        domain: ident.domain,
        sector: "legaltech",
        employee_count: null,
        revenue_estimate_mm: null,
        vc_pe_backed: "yes",
        ta_headcount: null,
        status: "no_prior_contact",
        notes: "Added via scheduled Exa ingest"
      },
      "company_id"
    );
    extras.contacts.push({
      contact_id: contactId,
      company_id: companyId,
      first_name: "",
      last_name: "",
      title: "",
      email: "",
      employment_confirmed: "no",
      linkedin_url: ""
    });
    extras.statuses.push({
      company_name: ident.company_name,
      domain: ident.domain,
      status: "no_prior_contact",
      last_interaction_date: "",
      partner_id: "partner_c",
      notes: "Scheduled Exa ingest; domain auto-confirmed"
    });
    extras.employment.push({ company_id: companyId, contact_id: contactId, works_at_company: false });
    newCaseIds.push(caseId);
    added += 1;
  });

  await kvPut(env, "extras", extras);
  // Always drain unscored pending after ingest (even if added=0), so backlog
  // from a prior failed score still clears without a partner button click.
  // Only unscored cases; decided Go/No-go/Ambiguous are never re-scored.
  var analyze = await drainPendingAutoAnalyze(env, {
    limit: 8,
    maxRounds: added ? 3 : 2
  });
  var status = {
    ok: true,
    at: now.toISOString(),
    source: source || "cron",
    stories: (packed.results || []).length,
    added: added,
    attached: attached,
    skipped: skipped,
    skipped_old: skippedOld,
    skipped_undated: skippedUndated,
    purged_stale: purged.dropped,
    max_age_days: EXA_MAX_AGE_DAYS,
    startPublishedDate: packed.startPublishedDate || "",
    skip_reasons: skipReasons.slice(0, 12),
    new_case_ids: newCaseIds,
    analyze: analyze
  };
  await kvPut(env, "ingest_status", status);
  try {
    await env.DB.prepare(
      "INSERT INTO audit (created_at, case_id, company_name, agent_decision, human_action, detail) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        status.at,
        "EXA",
        "(ingest)",
        "exa_ingest",
        source || "cron",
        "added=" +
          added +
          " attached=" +
          attached +
          " skipped=" +
          skipped +
          " skipped_old=" +
          skippedOld +
          " skipped_undated=" +
          skippedUndated +
          " purged_stale=" +
          purged.dropped +
          " max_age_days=" +
          EXA_MAX_AGE_DAYS
      )
      .run();
  } catch (e) { /* ignore */ }
  return status;
}

async function handleExaIngestRequest(request, env, cors) {
  if (!env.DB) return storeMissing(cors);
  var summary = await runExaIngest(env, "manual");
  return jsonResponse(summary, summary.ok ? 200 : 500, cors);
}

/* ─── Sequence Dispatch Bot (post-approve, email only) ───
 * Human Approve must already have stamped the case (sandbox / In Sequence).
 * This bot never invents outreach. It only checks due Email steps against the
 * cadence, then Graph-sends when Chad's mail secrets + unlock are present.
 * Without Graph secrets: dry-run hold. Never uses Resend for prospects.
 */

var EMAIL4_DAY_OFFSETS = { 1: 0, 2: 3, 3: 7, 4: 14 };

function graphSecretsReady(env) {
  return !!(
    env &&
    String(env.MS_TENANT_ID || "").trim() &&
    String(env.MS_CLIENT_ID || "").trim() &&
    String(env.MS_CLIENT_SECRET || "").trim() &&
    String(env.MS_SEND_AS || "").trim()
  );
}

function liveSendUnlocked(env) {
  return String((env && env.LIVE_SEND_UNLOCK) || "").trim().toLowerCase() === "true";
}

function normalizeEmailKeyWorker(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function looksLikeEmailWorker(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function ymdPartsFromIso(iso) {
  var s = String(iso || "").trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    var d = new Date(iso || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function addCalendarDaysParts(parts, delta) {
  var d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + (delta || 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function rollPartsToWeekday(parts) {
  var d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  var wd = d.getUTCDay();
  if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function partsToYmd(parts) {
  var m = String(parts.month);
  var day = String(parts.day);
  if (m.length < 2) m = "0" + m;
  if (day.length < 2) day = "0" + day;
  return parts.year + "-" + m + "-" + day;
}

function todayYmdUtc() {
  return partsToYmd(ymdPartsFromIso(new Date().toISOString()));
}

function stepDayOffset(fields, stepNum) {
  var day = parseInt(String((fields && fields["draft_" + stepNum + "_day"]) || ""), 10);
  if (day >= 1) return day - 1;
  if (EMAIL4_DAY_OFFSETS[stepNum] != null) return EMAIL4_DAY_OFFSETS[stepNum];
  return Math.max(0, stepNum - 1);
}

function dueYmdForStep(authorizedAt, fields, stepNum) {
  var base = ymdPartsFromIso(authorizedAt);
  var offset = stepDayOffset(fields, stepNum);
  var due = addCalendarDaysParts(base, offset);
  if (stepNum > 1) due = rollPartsToWeekday(due);
  return partsToYmd(due);
}

function isAuthorizedSandboxCase(rec) {
  if (!rec || !rec.humanComplete) return false;
  if (!caseHasDecision(rec)) return false;
  var fields = rec.lastFields || {};
  var decision = String(fields.decision || "").trim().toLowerCase();
  if (decision.indexOf("go") === -1 || decision.indexOf("no-go") !== -1 || decision.indexOf("nogo") !== -1) {
    return false;
  }
  var outcome = String(rec.humanOutcome || "").trim().toLowerCase();
  if (outcome === "approve" || outcome === "in talks" || outcome === "stopped") return true;
  if (/^human action:\s*approve/i.test(String(rec.humanStateText || ""))) return true;
  return false;
}

function sequenceStopBlocks(rec) {
  var stop = rec && rec.sequenceStop;
  if (!stop) return false;
  var kind = String(stop.kind || stop.reason || "").toLowerCase();
  return (
    kind.indexOf("conversation") !== -1 ||
    kind.indexOf("stopped") !== -1 ||
    kind.indexOf("cancel") !== -1 ||
    kind.indexOf("bounce") !== -1 ||
    kind.indexOf("opt") !== -1 ||
    !!stop.stopped
  );
}

function matchDncWorker(dncList, personName, email, companyName, domain) {
  var emailKey = looksLikeEmailWorker(email) ? normalizeEmailKeyWorker(email) : "";
  var nameKey = String(personName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  var list = Array.isArray(dncList) ? dncList : [];
  var host = normalizeHost(domain);
  var company = String(companyName || "")
    .trim()
    .toLowerCase();
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row) continue;
    if (emailKey && row.email && emailKey === normalizeEmailKeyWorker(row.email)) return row;
    var rowName = String(row.person_name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (nameKey && nameKey.length >= 4 && rowName === nameKey) {
      var rowHost = normalizeHost(row.domain);
      var rowCompany = String(row.company_name || "")
        .trim()
        .toLowerCase();
      if (!company && !host) return row;
      if ((host && rowHost && host === rowHost) || (company && rowCompany && company === rowCompany)) return row;
      if (!row.company_name && !row.domain) return row;
    }
  }
  return null;
}

function parseEmailQualityFromAudit(entry) {
  var detail = String((entry && entry.detail) || "");
  var m = detail.match(/(\d+)\s*(?:emails?\s*)?accepted[^\d]*(\d+)\s*(?:emails?\s*)?rewritten/i);
  if (m) return { accepted: Number(m[1]) || 0, rewritten: Number(m[2]) || 0 };
  var m2 = detail.match(/accepted\s*as\s*written[^\d]*(\d+)[^\d]+rewritten[^\d]*(\d+)/i);
  if (m2) return { accepted: Number(m2[1]) || 0, rewritten: Number(m2[2]) || 0 };
  var action = String((entry && entry.human_action) || "").toLowerCase();
  if (action === "approve" && /sequence|4-email|13-step|sandbox/i.test(detail)) {
    return { accepted: 4, rewritten: 0 };
  }
  if (action === "edit" && /sequence|4-email|13-step/i.test(detail)) {
    return { accepted: 0, rewritten: 4 };
  }
  return null;
}

function qualityBarFromAudit(auditRows) {
  var latest = {};
  var rows = Array.isArray(auditRows) ? auditRows : [];
  for (var i = 0; i < rows.length; i++) {
    var entry = rows[i];
    var action = String((entry && entry.human_action) || "").toLowerCase();
    if (action !== "approve" && action !== "edit") continue;
    var counts = parseEmailQualityFromAudit(entry);
    if (!counts) continue;
    var id = String((entry && entry.case_id) || "").trim();
    if (!id) continue;
    latest[id] = counts;
  }
  var accept = 0;
  var rewrite = 0;
  Object.keys(latest).forEach(function (id) {
    accept += latest[id].accepted || 0;
    rewrite += latest[id].rewritten || 0;
  });
  var total = accept + rewrite;
  var rate = total ? accept / total : 0;
  return { total: total, rate: rate, met: total >= 32 && rate >= 0.75 };
}

function maxSequenceSteps(fields) {
  var count = parseInt(String((fields && fields.sequence_step_count) || ""), 10);
  if (count >= 1 && count <= 20) return count;
  if (String((fields && fields.sequence_kind) || "") === "13-step") return 13;
  return 4;
}

function stepChannel(fields, stepNum) {
  return String((fields && fields["draft_" + stepNum + "_channel"]) || "").trim();
}

function isEmailChannel(channel) {
  return /^email$/i.test(String(channel || "").trim());
}

function stepOutcome(rec, stepNum) {
  var outcomes = (rec && rec.emailOutcomes) || {};
  return String(outcomes[stepNum] || outcomes[String(stepNum)] || "").toLowerCase();
}

function isStepSoftDeleted(rec, stepNum) {
  var deleted = (rec && rec.deletedSequenceSteps) || {};
  return !!(deleted[stepNum] || deleted[String(stepNum)]);
}

async function getGraphAccessToken(env) {
  var tenant = String(env.MS_TENANT_ID || "").trim();
  var clientId = String(env.MS_CLIENT_ID || "").trim();
  var clientSecret = String(env.MS_CLIENT_SECRET || "").trim();
  var body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  body.set("grant_type", "client_credentials");
  var upstream = await fetch("https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!upstream.ok) {
    var errText = await upstream.text().catch(function () {
      return "";
    });
    return { ok: false, detail: "Graph token failed: " + errText.slice(0, 200) };
  }
  var data = await upstream.json().catch(function () {
    return null;
  });
  var token = data && data.access_token;
  if (!token) return { ok: false, detail: "Graph token missing access_token" };
  return { ok: true, token: token };
}

async function sendMailViaGraph(env, payload) {
  if (!graphSecretsReady(env)) {
    return { sent: false, held: true, detail: "schedule_matched_waiting_for_mail_server" };
  }
  var tokenRes = await getGraphAccessToken(env);
  if (!tokenRes.ok) return { sent: false, held: false, detail: tokenRes.detail };
  var sendAs = String(env.MS_SEND_AS || "").trim();
  var upstream = await fetch(
    "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(sendAs) + "/sendMail",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tokenRes.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          subject: String(payload.subject || "").slice(0, 200),
          body: {
            contentType: "Text",
            content: String(payload.body || "").slice(0, 20000)
          },
          toRecipients: [
            {
              emailAddress: {
                address: String(payload.to || "").trim(),
                name: String(payload.toName || "").trim() || undefined
              }
            }
          ]
        },
        saveToSentItems: true
      })
    }
  );
  if (!upstream.ok) {
    var errText = await upstream.text().catch(function () {
      return "";
    });
    return { sent: false, held: false, detail: "Graph sendMail failed: " + errText.slice(0, 240) };
  }
  // Graph sendMail returns 202 with empty body; synthesize a stable id for audit.
  var messageId = "graph-" + Date.now().toString(36) + "-" + String(payload.to || "").slice(0, 24);
  return { sent: true, held: false, detail: "email_sent", message_id: messageId };
}

function ensureDispatchBucket(rec) {
  if (!rec.dispatch || typeof rec.dispatch !== "object") rec.dispatch = { steps: {} };
  if (!rec.dispatch.steps || typeof rec.dispatch.steps !== "object") rec.dispatch.steps = {};
  return rec.dispatch;
}

/** Human-facing line shown on Live badges / Sequence dispatch bar. */
function outOfSequenceReport(stepNum, reason, extra) {
  var n = stepNum;
  var r = String(reason || "");
  var channel = String((extra && extra.channel) || "").trim();
  var dueOn = String((extra && extra.due_on) || "").trim();
  var detail = "";
  if (r === "skip_ahead" || r === "prior_email_not_sent") {
    detail =
      "Email " +
      n +
      " blocked until Email " +
      (extra && extra.prior ? extra.prior : "?") +
      " is sent";
  } else if (r === "step_not_human_approved") {
    detail = "Email " + n + " is not partner-approved";
  } else if (r === "missing_recipient_email") {
    detail = "Email " + n + " has no recipient address";
  } else if (r === "empty_subject_or_body") {
    detail = "Email " + n + " has empty subject or body";
  } else if (r === "duplicate_already_sent") {
    detail = "Email " + n + " was already sent";
  } else if (r === "wrong_channel" || r === "channel_not_email") {
    detail = "step " + n + " channel is " + (channel || "not Email") + " (mail bot skips)";
  } else if (r === "body_step_mismatch") {
    detail = "Email " + n + " draft does not match an Email step";
  } else {
    detail = "Email " + n + " (" + r.replace(/_/g, " ") + ")";
  }
  return "Out of sequence: " + detail;
}

/**
 * Earlier Email steps must already be sent before a later due Email may send.
 * Soft-deleted and non-Email steps do not block.
 */
function priorEmailGate(rec, fields, dispatch, stepNum) {
  for (var p = 1; p < stepNum; p++) {
    if (isStepSoftDeleted(rec, p)) continue;
    var ch = stepChannel(fields, p);
    var body = String(fields["draft_" + p + "_body"] || "").trim();
    var subject = String(fields["draft_" + p + "_subject"] || "").trim();
    if (!ch && !body && !subject) continue;
    if (!isEmailChannel(ch)) continue;
    var st = String(((dispatch.steps && dispatch.steps[String(p)]) || {}).status || "");
    if (st !== "sent") {
      return { ok: false, prior: p, priorStatus: st || "not_sent" };
    }
  }
  return { ok: true };
}

function stampOutOfSequence(dispatch, stepNum, reason, fields, started, extra) {
  var channel = stepChannel(fields, stepNum) || (extra && extra.channel) || "";
  var report = outOfSequenceReport(stepNum, reason, Object.assign({ channel: channel }, extra || {}));
  dispatch.steps[String(stepNum)] = {
    status: "out_of_sequence",
    reason: reason,
    report: report,
    channel: channel,
    prior_step: extra && extra.prior != null ? extra.prior : undefined,
    due_on: extra && extra.due_on ? extra.due_on : undefined,
    day_offset: extra && extra.dayOffset != null ? extra.dayOffset : undefined,
    schedule_ok: false,
    stopped: true,
    checked_at: started
  };
  return report;
}

async function auditDispatchBlocked(env, payload) {
  if (!(env && env.DB)) return;
  try {
    await env.DB.prepare(
      "INSERT INTO audit (created_at, case_id, company_name, agent_decision, human_action, detail) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        String(payload.created_at || new Date().toISOString()),
        String(payload.case_id || "").slice(0, 64),
        String(payload.company_name || "").slice(0, 200),
        "Go",
        "sequence_dispatch_blocked",
        String(payload.detail || "").slice(0, 500)
      )
      .run();
  } catch (e) {
    /* keep going */
  }
}

async function runSequenceDispatch(env, source) {
  var started = new Date().toISOString();
  var summary = {
    ok: true,
    source: source || "manual",
    started_at: started,
    graph_ready: graphSecretsReady(env),
    live_send_unlock: liveSendUnlocked(env),
    quality_bar_met: false,
    checked: 0,
    due: 0,
    matched_held: 0,
    sent: 0,
    mismatch: 0,
    out_of_sequence: 0,
    skipped: 0,
    blocked: 0,
    items: [],
    blocked_reports: []
  };
  if (!env.DB) {
    summary.ok = false;
    summary.detail = "D1 missing";
    return summary;
  }

  var results = (await kvGet(env, "results")) || {};
  var clients = (await kvGet(env, "clients")) || [];
  var dnc = (await kvGet(env, "dnc")) || [];
  var extras = (await kvGet(env, "extras")) || {};
  var eventsById = {};
  (Array.isArray(extras.events) ? extras.events : []).forEach(function (ev) {
    if (ev && ev.case_id) eventsById[ev.case_id] = ev;
  });

  var auditRows = [];
  try {
    var audit = await env.DB.prepare(
      "SELECT created_at, case_id, company_name, agent_decision, human_action, detail FROM audit ORDER BY id DESC LIMIT 400"
    ).all();
    auditRows = (audit && audit.results) || [];
  } catch (e) {
    auditRows = [];
  }
  var quality = qualityBarFromAudit(auditRows);
  summary.quality_bar_met = !!quality.met;

  var today = todayYmdUtc();
  var dirty = false;
  var caseIds = Object.keys(results || {});

  function recordOutOfSequence(caseId, company, stepNum, report, reason) {
    summary.out_of_sequence += 1;
    summary.mismatch += 1;
    var item = {
      case_id: caseId,
      company_name: company || "",
      step: stepNum,
      status: "out_of_sequence",
      reason: reason,
      report: report
    };
    summary.items.push(item);
    summary.blocked_reports.push(item);
  }

  for (var c = 0; c < caseIds.length; c++) {
    var caseId = caseIds[c];
    var rec = results[caseId];
    if (!isAuthorizedSandboxCase(rec)) continue;
    if (sequenceStopBlocks(rec)) {
      summary.skipped += 1;
      continue;
    }
    var fields = rec.lastFields || {};
    var ev = eventsById[caseId] || {};
    var companyName = String(ev.company_name || fields.company_name || "").trim();
    var domain = String(ev.domain || fields.domain || "").trim();
    var pocEmail = String(fields.poc_email || "").trim();
    var pocName = String(
      fields.poc_name ||
        [fields.poc_first_name, fields.poc_last_name].filter(Boolean).join(" ") ||
        ""
    ).trim();

    if (matchClientBookWorker(clients, companyName, domain)) {
      summary.blocked += 1;
      summary.items.push({
        case_id: caseId,
        status: "blocked",
        reason: "existing_client"
      });
      continue;
    }
    if (matchDncWorker(dnc, pocName, pocEmail, companyName, domain)) {
      summary.blocked += 1;
      summary.items.push({
        case_id: caseId,
        status: "blocked",
        reason: "dnc"
      });
      continue;
    }

    if (!rec.authorized_at) {
      rec.authorized_at = rec.saved_at || started;
      dirty = true;
    }
    var authorizedAt = rec.authorized_at;
    var dispatch = ensureDispatchBucket(rec);
    var maxSteps = maxSequenceSteps(fields);

    for (var stepNum = 1; stepNum <= maxSteps; stepNum++) {
      summary.checked += 1;
      if (isStepSoftDeleted(rec, stepNum)) {
        summary.skipped += 1;
        continue;
      }
      var channel = stepChannel(fields, stepNum);
      var body = String(fields["draft_" + stepNum + "_body"] || "").trim();
      var subject = String(fields["draft_" + stepNum + "_subject"] || "").trim();
      if (!channel && !body && !subject) {
        summary.skipped += 1;
        continue;
      }
      if (!isEmailChannel(channel)) {
        // LinkedIn / phone / SMS: never auto-send. Stop and report Out of sequence.
        var chReport = stampOutOfSequence(dispatch, stepNum, "channel_not_email", fields, started, {
          channel: channel || "unknown"
        });
        dirty = true;
        recordOutOfSequence(caseId, companyName, stepNum, chReport, "channel_not_email");
        continue;
      }

      var outcome = stepOutcome(rec, stepNum);
      if (outcome !== "approved" && outcome !== "edited") {
        var reportUnapproved = stampOutOfSequence(
          dispatch,
          stepNum,
          "step_not_human_approved",
          fields,
          started,
          { channel: channel }
        );
        dirty = true;
        recordOutOfSequence(caseId, companyName, stepNum, reportUnapproved, "step_not_human_approved");
        continue;
      }

      var prior = dispatch.steps[String(stepNum)] || {};
      if (prior.status === "sent") {
        summary.skipped += 1;
        continue;
      }

      var dueYmd = dueYmdForStep(authorizedAt, fields, stepNum);
      var dayOffset = stepDayOffset(fields, stepNum);
      if (dueYmd > today) {
        // Not due yet: stop send, show clear schedule reason on the step.
        var notDueReport = outOfSequenceReport(stepNum, "not_due", {
          due_on: dueYmd,
          dayOffset: dayOffset,
          channel: channel
        });
        dispatch.steps[String(stepNum)] = {
          status: "sandbox_authorized",
          reason: "not_due",
          report: notDueReport,
          due_on: dueYmd,
          day_offset: dayOffset,
          channel: channel,
          stopped: true,
          checked_at: started
        };
        dirty = true;
        summary.skipped += 1;
        continue;
      }
      summary.due += 1;

      // Final gate: never skip ahead. Earlier Email steps must already be sent.
      var priorGate = priorEmailGate(rec, fields, dispatch, stepNum);
      if (!priorGate.ok) {
        var reportSkip = stampOutOfSequence(dispatch, stepNum, "prior_email_not_sent", fields, started, {
          prior: priorGate.prior,
          due_on: dueYmd,
          channel: channel
        });
        dirty = true;
        recordOutOfSequence(caseId, companyName, stepNum, reportSkip, "prior_email_not_sent");
        await auditDispatchBlocked(env, {
          created_at: started,
          case_id: caseId,
          company_name: companyName,
          detail: reportSkip
        });
        continue;
      }

      if (!looksLikeEmailWorker(pocEmail)) {
        var reportMissing = stampOutOfSequence(
          dispatch,
          stepNum,
          "missing_recipient_email",
          fields,
          started,
          { due_on: dueYmd, channel: channel }
        );
        dirty = true;
        recordOutOfSequence(caseId, companyName, stepNum, reportMissing, "missing_recipient_email");
        await auditDispatchBlocked(env, {
          created_at: started,
          case_id: caseId,
          company_name: companyName,
          detail: reportMissing
        });
        continue;
      }
      if (!subject || !body) {
        var reportEmpty = stampOutOfSequence(
          dispatch,
          stepNum,
          "empty_subject_or_body",
          fields,
          started,
          { due_on: dueYmd, channel: channel }
        );
        dirty = true;
        recordOutOfSequence(caseId, companyName, stepNum, reportEmpty, "empty_subject_or_body");
        await auditDispatchBlocked(env, {
          created_at: started,
          case_id: caseId,
          company_name: companyName,
          detail: reportEmpty
        });
        continue;
      }

      // Schedule match confirmed. Gate live delivery fail-closed.
      if (!quality.met || !liveSendUnlocked(env)) {
        var holdReason = !quality.met
          ? "schedule_matched_waiting_quality_bar"
          : "schedule_matched_waiting_unlock";
        dispatch.steps[String(stepNum)] = {
          status: "held_for_mail_server",
          reason: holdReason,
          report: !quality.met
            ? "Schedule OK. Held until email quality bar is met."
            : "Schedule OK. Held until Chad unlocks live send.",
          due_on: dueYmd,
          channel: channel,
          to: pocEmail,
          schedule_ok: true,
          checked_at: started
        };
        dirty = true;
        summary.matched_held += 1;
        summary.items.push({
          case_id: caseId,
          step: stepNum,
          status: "held_for_mail_server",
          reason: holdReason,
          to: pocEmail
        });
        continue;
      }

      if (!graphSecretsReady(env)) {
        dispatch.steps[String(stepNum)] = {
          status: "held_for_mail_server",
          reason: "schedule_matched_waiting_for_mail_server",
          report: "Schedule OK. Held for mail server (Graph secrets not set).",
          due_on: dueYmd,
          channel: channel,
          to: pocEmail,
          schedule_ok: true,
          checked_at: started
        };
        dirty = true;
        summary.matched_held += 1;
        summary.items.push({
          case_id: caseId,
          step: stepNum,
          status: "held_for_mail_server",
          reason: "schedule_matched_waiting_for_mail_server",
          to: pocEmail
        });
        console.log(
          "sequence_dispatch_hold",
          caseId,
          "step",
          stepNum,
          "schedule matched, waiting for mail server"
        );
        continue;
      }

      var send = await sendMailViaGraph(env, {
        to: pocEmail,
        toName: pocName,
        subject: subject,
        body: body
      });
      if (send.sent) {
        dispatch.steps[String(stepNum)] = {
          status: "sent",
          reason: "graph_sendMail",
          due_on: dueYmd,
          channel: channel,
          to: pocEmail,
          schedule_ok: true,
          message_id: send.message_id || "",
          sent_at: started,
          approved_by: String(rec.humanOutcome || "Approve"),
          checked_at: started
        };
        dirty = true;
        summary.sent += 1;
        summary.items.push({
          case_id: caseId,
          step: stepNum,
          status: "sent",
          to: pocEmail,
          message_id: send.message_id || ""
        });
        try {
          await env.DB.prepare(
            "INSERT INTO audit (created_at, case_id, company_name, agent_decision, human_action, detail) VALUES (?, ?, ?, ?, ?, ?)"
          )
            .bind(
              started,
              String(caseId).slice(0, 64),
              String(companyName).slice(0, 200),
              "Go",
              "sequence_dispatch_sent",
              (
                "step " +
                stepNum +
                " email to " +
                pocEmail +
                "; message_id=" +
                (send.message_id || "") +
                "; authorized=" +
                String(rec.humanOutcome || "Approve")
              ).slice(0, 500)
            )
            .run();
        } catch (auditErr) {
          /* keep going */
        }
      } else {
        dispatch.steps[String(stepNum)] = {
          status: "held_for_mail_server",
          reason: send.detail || "send_failed",
          due_on: dueYmd,
          channel: channel,
          to: pocEmail,
          schedule_ok: true,
          checked_at: started
        };
        dirty = true;
        summary.matched_held += 1;
        summary.items.push({
          case_id: caseId,
          step: stepNum,
          status: "held_for_mail_server",
          reason: send.detail || "send_failed"
        });
        console.log("sequence_dispatch_send_failed", caseId, stepNum, send.detail || "");
      }
    }
    results[caseId] = rec;
  }

  if (dirty) await kvPut(env, "results", results);
  summary.finished_at = new Date().toISOString();
  summary.items = summary.items.slice(0, 50);
  summary.blocked_reports = (summary.blocked_reports || []).slice(0, 20);
  await kvPut(env, "dispatch_status", summary);
  console.log(
    "sequence_dispatch",
    "source=" + summary.source,
    "checked=" + summary.checked,
    "due=" + summary.due,
    "sent=" + summary.sent,
    "held=" + summary.matched_held,
    "out_of_sequence=" + summary.out_of_sequence,
    "mismatch=" + summary.mismatch,
    "graph=" + summary.graph_ready,
    "unlock=" + summary.live_send_unlock,
    "quality=" + summary.quality_bar_met
  );
  return summary;
}

async function handleSequenceDispatchRequest(request, env, cors) {
  if (!env.DB) return storeMissing(cors);
  if (request.method === "GET") {
    var status = (await kvGet(env, "dispatch_status")) || {
      ok: true,
      detail: "No dispatch pass yet",
      graph_ready: graphSecretsReady(env),
      live_send_unlock: liveSendUnlocked(env)
    };
    status.graph_ready = graphSecretsReady(env);
    status.live_send_unlock = liveSendUnlocked(env);
    return jsonResponse(status, 200, cors);
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Use GET or POST /v1/sequence-dispatch" }, 405, cors);
  }
  var summary = await runSequenceDispatch(env, "manual");
  return jsonResponse(summary, summary.ok ? 200 : 500, cors);
}

export default {
  async scheduled(event, env, ctx) {
    var cron = String((event && event.cron) || "");
    // Existing Exa ingest windows (9am / 8pm Eastern as UTC).
    if (cron === "0 13 * * *" || cron === "0 0 * * *" || !cron) {
      ctx.waitUntil(
        runExaIngest(env, "cron").catch(function (e) {
          console.log("exa_ingest_cron_failed", String((e && e.message) || e));
        })
      );
    }
    // Hourly (:15) Sequence Dispatch Bot, and also after ingest crons.
    if (cron === "15 * * * *" || cron === "0 13 * * *" || cron === "0 0 * * *" || !cron) {
      ctx.waitUntil(
        runSequenceDispatch(env, "cron:" + (cron || "legacy")).catch(function (e) {
          console.log("sequence_dispatch_cron_failed", String((e && e.message) || e));
        })
      );
    }
  },

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
          partner_gate: partnerGateRequired(env, origin) ? "required" : "off",
          store: env.DB ? "d1" : "missing",
          auto_analyze: "offline-on-ingest+cron+/v1/auto-analyze-only",
          exa_ingest: "cron 9am+8pm GMT-4",
          sequence_dispatch: "hourly :15 + after ingest; dry-run until Graph+unlock",
          graph_mail: graphSecretsReady(env) ? "configured" : "missing",
          live_send_unlock: liveSendUnlocked(env) ? "true" : "false",
          routes: [
            "/v1/messages",
            "/v1/auto-analyze",
            "/v1/exa-ingest",
            "/v1/repair-entities",
            "/v1/sequence-dispatch",
            "/search",
            "/domain-search",
            "/email-finder",
            "/store/snapshot",
            "/store/audit",
            "/store/escalate"
          ]
        },
        200,
        cors
      );
    }

    const gate = requirePartnerAccess(request, env, cors);
    if (gate) return gate;

    if (path === "/v1/exa-ingest") {
      if (request.method !== "POST" && request.method !== "GET") {
        return jsonResponse({ error: "Use GET or POST /v1/exa-ingest" }, 405, cors);
      }
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Exa ingest");
      return handleExaIngestRequest(request, env, cors);
    }

    if (path === "/v1/repair-entities") {
      if (request.method !== "POST" && request.method !== "GET") {
        return jsonResponse({ error: "Use GET or POST /v1/repair-entities" }, 405, cors);
      }
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Entity repair");
      if (!env.DB) return storeMissing(cors);
      var repairSummary = await runEntityRepairPass(env);
      return jsonResponse(repairSummary, 200, cors);
    }

    if (path === "/v1/auto-analyze") {
      if (request.method !== "POST" && request.method !== "GET") {
        return jsonResponse({ error: "Use GET or POST /v1/auto-analyze" }, 405, cors);
      }
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Auto-analyze");
      return handleAutoAnalyzeRequest(request, env, cors);
    }

    if (path === "/v1/sequence-dispatch") {
      if (request.method !== "POST" && request.method !== "GET") {
        return jsonResponse({ error: "Use GET or POST /v1/sequence-dispatch" }, 405, cors);
      }
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Sequence dispatch");
      return handleSequenceDispatchRequest(request, env, cors);
    }

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
    if (path === "/store/escalate" && request.method === "POST") {
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Store");
      return storeEscalate(request, env, cors);
    }
    if (path.indexOf("/store/blob/") === 0 && request.method === "PUT") {
      if (hunterGithubOrigin(origin)) return githubIoPublicBlocked(cors, "Store");
      var key = path.slice("/store/blob/".length);
      return storePutBlob(request, env, cors, key);
    }

    return jsonResponse({ error: "Not found" }, 404, cors);
  }
};

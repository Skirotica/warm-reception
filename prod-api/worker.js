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
  "Legaltech startup Series A Series B funding round or CRO VP Sales executive hire, including news roundups and company posts, 2026";
var EXA_SEARCH_COUNT = 100;
var EXA_MAX_NEW_PER_INGEST = 80;
var EXA_MAX_COMPANIES_PER_STORY = 6;
var EXA_PUBLISHER_HOST_RE =
  /(law\.com|tech\.eu|prnewswire|linkedin|artificiallawyer|techfundingnews|pulse2|reuters|bloomberg|techcrunch|venturebeat|forbes|businesswire|globenewswire|yahoo\.com|medium\.com|substack\.com|latamlist\.com|latamrepublic\.com|thesaasnews\.com|finsmes\.com|crunchbase\.com|pitchbook\.com|axios\.com|sifted\.eu|tech\.eu|geekwire\.com|theregister\.com|zdnet\.com|wired\.com|theverge\.com|thenextweb\.com|tnw\.to|news\.yahoo|google\.com\/news|msn\.com|foundernews\.eu|foundernews|siliconrepublic\.com|siliconrepublic|globallegalpost\.com|globallegalpost|legaltech\.news|law360\.com|abovethelaw\.com|artificiallawyer\.com|techfundingnews\.com|startupmag\.co\.uk|startupmag\.com|startupmag|thelogic\.co|exame\.com|startups\.com\.br|braziljournal\.com|neofeed\.com\.br|contxto\.com|infomoney\.com\.br|valor\.globo\.com|valor\.com\.br|bloomberglinea\.com|startupi\.com\.br|startse\.com|baguete\.com\.br|estadao\.com\.br|folha\.uol\.com\.br|uol\.com\.br|globo\.com|istoedinheiro\.com\.br|moneyreport\.com\.br)/i;
/** VC / PE firm sites — never the outreach target when the article is about a portfolio company. */
var EXA_VC_HOST_RE =
  /(luxcapital\.com|a16z\.com|andreessen\.com|sequoiacap\.com|indexventures\.com|greylock\.com|accel\.com|benchmark\.com|lightspeedventure|bessemer\.com|khoslaventures\.com|firstround\.com|initialized\.com|ycombinator\.com|softbank\.com|generalcatalyst\.com|insightpartners\.com|baincapital|sequoia|andreessenhorowitz)/i;
var EXA_MEDIA_OR_VC_NAME_RE =
  /^(latamlist|latam\s*republic|latam\s*list|the\s*saas\s*news|saas\s*news|the\s*next\s*web|thenextweb|tnw|the\s*round|techcrunch|venturebeat|forbes|reuters|bloomberg|pr\s*newswire|business\s*wire|finsmes|crunchbase|pitchbook|axios|sifted|medium|substack|geekwire|wired|verge|yahoo|msn|foundernews|founder\s*news|silicon\s*republic|siliconrepublic|global\s*legal\s*post|globallegalpost|startupmag|startup\s*mag|thelogic|the\s*logic|exame|startups|brazil\s*journal|braziljournal|neofeed|contxto|infomoney|info\s*money|bloomberg\s*linea|bloomberglinea|startupi|startse|baguete|istoe\s*dinheiro|epoca\s*negocios|list|news|republic|ventures|capital|partners|fund|media|magazine|blog|company|startup|platform|publisher|press)$/i;
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

function exaStartPublishedDateIso(now, days) {
  var dt = now instanceof Date ? new Date(now.getTime()) : new Date(now || Date.now());
  if (isNaN(dt.getTime())) dt = new Date();
  var windowDays = parseInt(days, 10);
  if (!windowDays || windowDays < 1) windowDays = EXA_MAX_AGE_DAYS;
  var start = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - windowDays);
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
function purgeStaleLiveExaExtras(extras, now, results) {
  var dropped = 0;
  var reasons = [];
  if (!extras || !Array.isArray(extras.events)) return { dropped: 0, reasons: reasons };
  results = results || {};
  var doomed = [];
  (extras.events || []).forEach(function (ev) {
    if (!isLiveExaQueueEvent(ev)) return;
    // Keep embedded pilot seeds (CE-L01…) if they somehow appear; only purge refresh extras.
    if (String(ev.case_id || "").indexOf("CE-LX-") !== 0) return;
    // Never purge an unconfirmed No-go — partner must Confirm No-Go first.
    if (mustRetainUnconfirmedNogo(results[ev.case_id], extras, ev.case_id)) return;
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
    var domainIsPub = !!(host && isPublisherHostWorker(host));
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
        var keptScore = results[ev.case_id];
        if (keptScore && keptScore.lastFields) {
          keptScore.lastFields.company_name = ev.company_name;
          keptScore.lastFields.domain = ev.domain || "";
        }
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
    // Unconfirmed No-go stays visible until partner Confirm No-Go.
    // A news-publisher husk is not a real company No-go and can be removed.
    if (mustRetainUnconfirmedNogo(rec, extras, caseId) && !resultIsPublisherHusk(rec)) {
      actions.push({
        action: "keep_unconfirmed_nogo",
        case_id: caseId,
        reason: reason || ""
      });
      return;
    }
    if (isPartnerConfirmedNogoArchive(rec, extras, caseId)) {
      actions.push({
        action: "keep_confirmed_nogo_archive",
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
    if (
      mustRetainUnconfirmedNogo(results[ev.case_id], extras, ev.case_id) &&
      !eventIsPublisherHusk(ev, results[ev.case_id])
    ) {
      actions.push({
        action: "keep_unconfirmed_nogo_skip_merge",
        from_case_id: ev.case_id,
        to_case_id: best.case_id
      });
      return;
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
    var sourceHost = hostFromAnyUrl(ev.source_url || "");
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
    var nameIsPub = isPublisherBrandNameWorker(ev.company_name);
    var domainIsPub = !!(host && isPublisherHostWorker(host));
    var sourceIsPub = !!(sourceHost && isPublisherHostWorker(sourceHost));
    var rationaleBlob =
      results[ev.case_id] && results[ev.case_id].lastFields
        ? String(results[ev.case_id].lastFields.why || "") +
          "\n" +
          String(results[ev.case_id].lastFields.reason_or_ambiguity || "")
        : "";
    var rationaleSubject = publisherRationaleSubject(rationaleBlob);
    var rationaleHusk = !!(
      rationaleSubject &&
      !sameCompanyWorker(
        rationaleSubject,
        knownSubjectDomainWorker(rationaleSubject),
        ev.company_name,
        host
      )
    );
    // Empty domain + news source URL, or a rationale that names a different company, is a publisher husk.
    if (!nameIsPub && !domainIsPub && !(sourceIsPub && !looksLikeRealDomainWorker(host)) && !rationaleHusk) {
      return;
    }

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
    if (!ident.company_name && rationaleSubject && !isPublisherBrandNameWorker(rationaleSubject)) {
      ident = {
        company_name: rationaleSubject,
        domain: knownSubjectDomainWorker(rationaleSubject) || ""
      };
    }
    if (!ident.company_name || isMediaOrVcCompanyName(ident.company_name) || isPublisherBrandNameWorker(ident.company_name)) {
      // News site with no extractable company: remove the card. Do not leave a Confirm No-Go husk.
      if (!isPartnerConfirmedNogoArchive(results[ev.case_id], extras, ev.case_id)) {
        doomed.push(ev);
        changed = true;
        actions.push({
          action: "drop_publisher_husk",
          case_id: ev.case_id,
          company_name: ev.company_name || "",
          domain: host || sourceHost || ""
        });
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
      var fieldUrl =
        results[ev.case_id] && results[ev.case_id].lastFields
          ? results[ev.case_id].lastFields.event_source_url
          : "";
      if (fieldUrl) attachStoryToEvent(target, { url: fieldUrl });
      if (!looksLikeRealDomainWorker(target.domain) && ident.domain) {
        target.domain = ident.domain;
      }
      var knownT = knownSubjectDomainWorker(target.company_name);
      if (knownT && !looksLikeRealDomainWorker(target.domain)) target.domain = knownT;
      if (
        mustRetainUnconfirmedNogo(results[ev.case_id], extras, ev.case_id) &&
        !eventIsPublisherHusk(ev, results[ev.case_id])
      ) {
        actions.push({
          action: "keep_unconfirmed_nogo_skip_merge",
          from_case_id: ev.case_id,
          to_case_id: target.case_id
        });
        return;
      }
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

  // Pass 2e: one card per real company domain (Magnar articles from Exame + Startups.com.br).
  var keptByKey = {};
  extras.events.forEach(function (ev) {
    if (!ev || !isLiveExaQueueEvent(ev)) return;
    if (String(ev.case_id || "").indexOf("CE-LX-") !== 0) return;
    if (doomed.indexOf(ev) !== -1) return;
    var hostKey = normalizeHost(ev.domain);
    var slugKey = slugifyTokenWorker(ev.company_name).replace(/-/g, "");
    if (!hostKey || !looksLikeRealDomainWorker(hostKey) || isPublisherHostWorker(hostKey)) return;
    if (slugKey && isPublisherBrandNameWorker(ev.company_name)) return;
    var key = "d:" + hostKey;
    var prior = keptByKey[key];
    if (!prior) {
      keptByKey[key] = ev;
      return;
    }
    function preferRow(a, b) {
      var aNogo = mustRetainUnconfirmedNogo(results[a.case_id], extras, a.case_id);
      var bNogo = mustRetainUnconfirmedNogo(results[b.case_id], extras, b.case_id);
      var aRedirect = String(a.entity_note || "").indexOf("redirected_from_publisher") !== -1;
      var bRedirect = String(b.entity_note || "").indexOf("redirected_from_publisher") !== -1;
      if (aRedirect !== bRedirect) return aRedirect ? b : a;
      if (aNogo !== bNogo) return aNogo ? a : b;
      return a;
    }
    var keep = preferRow(prior, ev);
    var drop = keep === prior ? ev : prior;
    keptByKey[key] = keep;
    attachStoryToEvent(keep, { url: drop.source_url, title: drop.event_headline, text: drop.event_summary });
    if (Array.isArray(drop.source_urls)) {
      drop.source_urls.forEach(function (u) {
        attachStoryToEvent(keep, { url: u });
      });
    }
    drop._merged_duplicate = true;
    doomed.push(drop);
    changed = true;
    actions.push({
      action: "collapse_same_company",
      from_case_id: drop.case_id,
      to_case_id: keep.case_id,
      domain: hostKey
    });
  });

  doomed.forEach(function (ev) {
    var husk = eventIsPublisherHusk(ev, results[ev.case_id]);
    var duplicate = ev && ev._merged_duplicate === true;
    if (!husk && !duplicate && mustRetainUnconfirmedNogo(results[ev.case_id], extras, ev.case_id)) {
      actions.push({
        action: "keep_unconfirmed_nogo_event",
        case_id: ev.case_id,
        company_name: ev.company_name || ""
      });
      return;
    }
    removeExtrasEventAndRelated(extras, ev.case_id, ev.company_id);
    if (results[ev.case_id] && !isPartnerConfirmedNogoArchive(results[ev.case_id], extras, ev.case_id)) {
      delete results[ev.case_id];
      changed = true;
    }
  });

  syncAttachedSources(extras);

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
    var chamelioProfile =
      (extras.profiles || []).filter(function (p) {
        return p && p.company_id === ev.company_id;
      })[0] || null;
    var chamelioProbe = {
      decision: "Go",
      company_name: "Chamelio",
      domain: "chamelio.ai",
      poc_title: pocTitle,
      why: ""
    };
    fillIcpDetailFields(chamelioProbe, ev, chamelioProfile);
    var chamelioMissing = goIcpFactsMissing(chamelioProbe);
    if (chamelioMissing.length) {
      actions.push({
        action: "chamelio_skip_go_missing_icp",
        case_id: ev.case_id,
        missing: chamelioMissing.join(",")
      });
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
      employee_count: chamelioProbe.employee_count,
      revenue_estimate: chamelioProbe.revenue_estimate,
      vc_pe_backed: chamelioProbe.vc_pe_backed,
      ta_headcount: chamelioProbe.ta_headcount,
      persona_used: chamelioProbe.persona_used || "CRO / CEO / Founder (company event)",
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
        // Numeric husk with no repair: hold as draft, but never remove an
        // unconfirmed No-go that the partner has not Confirm No-Go'd yet.
        if (mustRetainUnconfirmedNogo(results[ev.case_id], extras, ev.case_id)) {
          actions.push({
            action: "keep_unconfirmed_nogo_over_entity_hold",
            case_id: ev.case_id,
            fail_reasons: check.fail_reasons || []
          });
        } else {
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
    }
  });
  checkerHoldDoomed.forEach(function (ev) {
    if (mustRetainUnconfirmedNogo(results[ev.case_id], extras, ev.case_id)) return;
    removeExtrasEventAndRelated(extras, ev.case_id, ev.company_id);
    if (results[ev.case_id] && !isPartnerConfirmedNogoArchive(results[ev.case_id], extras, ev.case_id)) {
      delete results[ev.case_id];
    }
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

/**
 * Restore unconfirmed No-go cards that repairs wrongly archived or orphaned
 * (result exists, event missing). Only Confirm No-Go may keep them archived.
 */
function restoreUnconfirmedNogosToQueue(extras, results) {
  results = results || {};
  extras = extras || {};
  extras.events = extras.events || [];
  extras.profiles = extras.profiles || [];
  if (!extras.archived_cases) extras.archived_cases = {};
  var changed = false;
  var restored = [];
  var byCase = {};
  extras.events.forEach(function (ev) {
    if (ev && ev.case_id) byCase[ev.case_id] = ev;
  });

  Object.keys(results).forEach(function (caseId) {
    var rec = results[caseId];
    if (!rec || !rec.lastFields) return;
    if (!fieldsLookLikeNogoDecisionWorker(rec.lastFields)) return;
    if (extras.archived_cases && extras.archived_cases[caseId]) {
      if (String(rec.humanOutcome || "") !== "Archived" || !rec.confirmed_nogo) {
        rec.archived = true;
        rec.confirmed_nogo = true;
        rec.humanOutcome = "Archived";
        rec.humanComplete = true;
        rec.archived_at = rec.archived_at || extras.archived_cases[caseId].at || "";
        if (!/confirm\s*no-?go|confirm_nogo/i.test(String(rec.humanStateText || ""))) {
          rec.humanStateText = "Archived from review queue (Confirm No-Go).";
        }
        changed = true;
      }
      return;
    }
    if (isPartnerConfirmedNogoArchive(rec, extras, caseId)) return;

    // Undo soft-archive that was not Confirm No-Go.
    if (rec.archived) {
      rec.archived = false;
      rec.archived_at = "";
      if (String(rec.humanOutcome || "") === "Archived") {
        rec.humanOutcome = "";
        rec.humanComplete = false;
        rec.humanStateText = "";
      }
      changed = true;
    }

    if (byCase[caseId]) return;

    var fields = rec.lastFields;
    if (resultIsPublisherHusk(rec)) return;
    var companyName = String(fields.company_name || "").trim() || "Unknown company";
    var domain = normalizeHost(fields.domain) || "";
    var companyId = "CO-RESTORE-" + String(caseId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    var ev = {
      case_id: caseId,
      company_id: companyId,
      company_name: companyName,
      domain: domain,
      event_type: String(fields.trigger_event || "funding_round"),
      event_summary: String(fields.why || fields.reason_or_ambiguity || "").slice(0, 280),
      event_headline: companyName + " (restored No-go)",
      event_date: String(fields.event_date || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      source_url: String(fields.event_source_url || ""),
      source_urls: String(fields.event_source_url || "") ? [String(fields.event_source_url)] : [],
      sector: String(fields.sector || ""),
      employee_count: fields.employee_count || null,
      revenue_estimate_mm: null,
      vc_pe_backed: String(fields.vc_pe_backed || ""),
      ta_headcount: fields.ta_headcount || null,
      live_exa: true,
      entity_note: "restored_unconfirmed_nogo"
    };
    extras.events.push(ev);
    byCase[caseId] = ev;
    extras.profiles.push({
      company_id: companyId,
      company_name: companyName,
      domain: domain,
      sector: String(fields.sector || ""),
      notes: "restored_unconfirmed_nogo"
    });
    changed = true;
    restored.push(caseId);
  });

  return { changed: changed, restored: restored, results: results, extras: extras };
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
  var restored = restoreUnconfirmedNogosToQueue(extras, results);
  results = restored.results || results;
  var lexroom = await enrichAndPromoteLexroom(env, extras, results);
  var magnar = await rescoreMagnarAfterNewsMerge(env, extras, results);
  var exameAttached = ensureMagnarExameSource(extras);
  var icpFacts = backfillStoredGoIcpFacts(extras, results);
  if (scrubbed.changed || repaired.changed || restored.changed || lexroom.changed || magnar.changed || exameAttached || icpFacts.changed) {
    await kvPut(env, "extras", extras);
    await kvPut(env, "results", results);
  }
  return {
    ok: true,
    scrub_nogo: (scrubbed.nogo || []).length,
    repair_actions: (repaired.actions || []).concat(lexroom.actions || []).concat(magnar.actions || []).concat(icpFacts.actions || []),
    restored_nogo: restored.restored || [],
    changed: !!(scrubbed.changed || repaired.changed || restored.changed || lexroom.changed || magnar.changed || exameAttached || icpFacts.changed),
    lexroom: lexroom,
    magnar: magnar,
    exame_source_attached: exameAttached
  };
}

/**
 * The Exame husk was removed before its article URL was copied.
 * Put the Exame story about Magnar's round onto the Magnar card.
 */
function ensureMagnarExameSource(extras) {
  if (!extras || !Array.isArray(extras.events)) return false;
  var exameUrl =
    "https://exame.com/negocios/apos-rodada-de-us-8-milhoes-ia-juridica-que-atende-30-mil-advogados-chega-ao-brasil/";
  var ev = null;
  extras.events.forEach(function (row) {
    if (!row || String(row.case_id || "").indexOf("CE-LX-") !== 0) return;
    var slug = slugifyTokenWorker(row.company_name).replace(/-/g, "");
    if (slug === "magnar" || normalizeHost(row.domain) === "magnar.ai") ev = row;
  });
  if (!ev) return false;
  var before = (ev.source_urls || []).join("|");
  attachStoryToEvent(ev, { url: exameUrl });
  syncAttachedSources(extras);
  return (ev.source_urls || []).join("|") !== before;
}

/**
 * One Magnar card after news-site husks are merged. Re-score magnar.ai with the
 * normal persona rules. Does not Approve or send. Runs once.
 */
async function rescoreMagnarAfterNewsMerge(env, extras, results) {
  extras.repairs = extras.repairs || {};
  var ev = null;
  (extras.events || []).forEach(function (row) {
    if (!row || String(row.case_id || "").indexOf("CE-LX-") !== 0) return;
    var slug = slugifyTokenWorker(row.company_name).replace(/-/g, "");
    var host = normalizeHost(row.domain);
    if (slug !== "magnar" && host !== "magnar.ai") return;
    if (!ev) ev = row;
    var redirected = String(row.entity_note || "").indexOf("redirected_from_publisher") !== -1;
    if (host === "magnar.ai" && !redirected) ev = row;
  });
  if (!ev) return { changed: false, actions: [{ action: "magnar_not_in_queue" }] };
  var noteAlready = String(ev.entity_note || "").indexOf("magnar_news_rescore_v1") !== -1;
  if (extras.repairs.magnar_news_rescore_v1 || noteAlready) {
    extras.repairs.magnar_news_rescore_v1 = true;
    var keepRec = results[ev.case_id];
    if (keepRec && keepRec.lastFields && /^go$/i.test(String(keepRec.lastFields.decision || "").trim())) {
      var keepProfile =
        ((extras.profiles || []).filter(function (p) {
          return p && p.company_id === ev.company_id;
        })[0] || null);
      fillIcpDetailFields(keepRec.lastFields, ev, keepProfile);
      copyFilledIcpOntoRecord(ev, keepProfile, keepRec.lastFields);
      return {
        changed: true,
        actions: [
          {
            action: "magnar_keep_go_fill_icp",
            case_id: ev.case_id,
            employee_count: keepRec.lastFields.employee_count || "",
            revenue_estimate: keepRec.lastFields.revenue_estimate || "",
            vc_pe_backed: keepRec.lastFields.vc_pe_backed || "",
            ta_headcount: keepRec.lastFields.ta_headcount || "",
            persona_used: keepRec.lastFields.persona_used || ""
          }
        ]
      };
    }
    return { changed: false, actions: [{ action: "magnar_rescore_already_done", case_id: ev.case_id }] };
  }
  var rec = results[ev.case_id];
  if (rec && (rec.authorized_at || String(rec.humanOutcome || "") === "Approved")) {
    extras.repairs.magnar_news_rescore_v1 = true;
    return { changed: true, actions: [{ action: "magnar_skip_approved", case_id: ev.case_id }] };
  }
  if (isPartnerConfirmedNogoArchive(rec, extras, ev.case_id)) {
    extras.repairs.magnar_news_rescore_v1 = true;
    return { changed: true, actions: [{ action: "magnar_skip_confirmed_nogo", case_id: ev.case_id }] };
  }
  if (
    rec &&
    rec.lastFields &&
    /^go$/i.test(String(rec.lastFields.decision || "").trim()) &&
    String(rec.lastFields.poc_email || "").trim()
  ) {
    fillIcpDetailFields(rec.lastFields, ev, null);
    extras.repairs.magnar_news_rescore_v1 = true;
    return {
      changed: true,
      actions: [{ action: "magnar_skip_existing_go", case_id: ev.case_id }]
    };
  }
  ev.company_name = "Magnar";
  ev.domain = "magnar.ai";
  (extras.profiles || []).forEach(function (p) {
    if (!p || p.company_id !== ev.company_id) return;
    p.company_name = "Magnar";
    p.domain = "magnar.ai";
  });
  extras.contacts = (extras.contacts || []).filter(function (c) {
    if (!c || c.company_id !== ev.company_id) return true;
    var emailHost = String(c.email || "").split("@")[1] || "";
    if (emailHost && isPublisherHostWorker(emailHost)) return false;
    return true;
  });
  var clients = [];
  try {
    clients = (await kvGet(env, "clients")) || [];
  } catch (eClients) {
    clients = [];
  }
  var outcome = await analyzeOnePendingEvent(env, ev, extras, clients);
  if (!outcome || !outcome.ok || !outcome.fields) {
    return {
      changed: true,
      actions: [
        {
          action: "magnar_rescore_failed",
          case_id: ev.case_id,
          detail: (outcome && outcome.detail) || "failed"
        }
      ]
    };
  }
  applyPublisherRationaleRetarget(ev, outcome.fields);
  if (!outcome.fields.company_name) outcome.fields.company_name = "Magnar";
  if (!normalizeHost(outcome.fields.domain) || isPublisherHostWorker(outcome.fields.domain)) {
    outcome.fields.domain = "magnar.ai";
    ev.domain = "magnar.ai";
  }
  var decision = String(outcome.fields.decision || "");
  holdGoUntilIcpFacts(outcome.fields, ev, null);
  includeDespiteEmployeeCount(outcome.fields, ev, null);
  decision = String(outcome.fields.decision || "");
  var isGo = /^go$/i.test(decision.trim());
  results[ev.case_id] = {
    lastFields: outcome.fields,
    humanOutcome: "",
    humanStateText: isGo ? "Go, waiting approval" : "",
    humanComplete: false,
    archived: false,
    confirmed_nogo: false,
    partner_rerun: true,
    last_rerun_at: new Date().toISOString(),
    saved_at: new Date().toISOString(),
    hunterStatus: outcome.hunterStatus || "",
    auto_analyze_mode: outcome.mode || "llm"
  };
  var note = String(ev.entity_note || "");
  if (note.indexOf("magnar_news_rescore_v1") === -1) {
    ev.entity_note = (note ? note + "; " : "") + "magnar_news_rescore_v1";
  }
  extras.repairs.magnar_news_rescore_v1 = true;
  syncAttachedSources(extras);
  return {
    changed: true,
    actions: [
      {
        action: "magnar_rescore",
        case_id: ev.case_id,
        decision: decision,
        domain: normalizeHost(ev.domain),
        sources: (ev.source_urls || []).length,
        poc: outcome.fields.poc_name || ""
      }
    ]
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
    extras.repairs = extras.repairs || {};
    if (extras.repairs.lexroom_enrich_v1 || String(ev.entity_note || "").indexOf("lexroom_enrich_v1") !== -1) {
      continue;
    }

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
      if (hunter && hunter.ok) {
        extras.repairs.lexroom_enrich_v1 = true;
        if (String(ev.entity_note || "").indexOf("lexroom_enrich_v1") === -1) {
          ev.entity_note = (ev.entity_note ? String(ev.entity_note) + "; " : "") + "lexroom_enrich_v1";
        }
      }
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
      extras.repairs.lexroom_enrich_v1 = true;
      if (String(ev.entity_note || "").indexOf("lexroom_enrich_v1") === -1) {
        ev.entity_note = (ev.entity_note ? String(ev.entity_note) + "; " : "") + "lexroom_enrich_v1";
      }
      if (rec && !rec.partner_rerun) {
        rec.partner_rerun = true;
        if (!rec.last_rerun_at) rec.last_rerun_at = new Date().toISOString();
        changed = true;
      }
      actions.push({ action: "lexroom_already_go", case_id: ev.case_id, poc: pocName });
      continue;
    }
    var lexProfile =
      (extras.profiles || []).filter(function (p) {
        return p && p.company_id === ev.company_id;
      })[0] || null;
    var lexProbe = {
      decision: "Go",
      company_name: "Lexroom",
      domain: "lexroom.ai",
      poc_title: pocTitle,
      why: ""
    };
    fillIcpDetailFields(lexProbe, ev, lexProfile);
    var lexMissing = goIcpFactsMissing(lexProbe);
    if (lexMissing.length) {
      actions.push({
        action: "lexroom_skip_go_missing_icp",
        case_id: ev.case_id,
        missing: lexMissing.join(",")
      });
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
        employee_count: lexProbe.employee_count,
        revenue_estimate: lexProbe.revenue_estimate,
        vc_pe_backed: lexProbe.vc_pe_backed,
        ta_headcount: lexProbe.ta_headcount,
        persona_used: lexProbe.persona_used || "CRO / CEO / Founder (company event)",
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
    extras.repairs.lexroom_enrich_v1 = true;
    if (String(ev.entity_note || "").indexOf("lexroom_enrich_v1") === -1) {
      ev.entity_note = (ev.entity_note ? String(ev.entity_note) + "; " : "") + "lexroom_enrich_v1";
    }
    actions.push({
      action: "lexroom_promote_go",
      case_id: ev.case_id,
      domain: "lexroom.ai",
      poc: pocName
    });
  }

  return { changed: changed, actions: actions };
}

async function searchExaResults(env, q, num, windowDays) {
  if (!env.EXA_API_KEY) {
    return { ok: false, error: "EXA_API_KEY secret not set on worker", results: [] };
  }
  var query = q || EXA_DEFAULT_QUERY;
  var n = Math.min(Math.max(parseInt(num || "8", 10) || 8, 1), 100);
  var startPublishedDate = exaStartPublishedDateIso(new Date(), windowDays);
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
      detail: "The D1 binding DB is missing on this Worker. Confirm database_id in wrangler.toml, then redeploy prod-api."
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
        to: send.to || "",
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
  const subject = String((payload && payload.subject) || "Black Gavel escalation").slice(0, 200);
  const text = String((payload && payload.body) || "").slice(0, 12000);
  if (graphSecretsReady(env)) {
    const graph = await sendMailViaGraph(env, {
      to: to,
      toName: "GeeTM help desk",
      subject: subject,
      body: text
    });
    if (graph && graph.sent) return { sent: true, detail: "email_sent", to: to };
    if (!(env && env.RESEND_API_KEY)) {
      return {
        sent: false,
        detail: (graph && graph.detail) || "graph_send_failed",
        to: to
      };
    }
  }
  const key = env && env.RESEND_API_KEY;
  if (!key) {
    return {
      sent: false,
      detail: "Help desk mail is not configured. Ticket was logged only.",
      to: to
    };
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
        subject: subject,
        text: text
      })
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(function () { return ""; });
      return { sent: false, detail: "Resend failed: " + errText.slice(0, 200), to: to };
    }
    return { sent: true, detail: "email_sent", to: to };
  } catch (e) {
    return { sent: false, detail: String((e && e.message) || e), to: to };
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
    if (key === "extras") {
      var existingExtras = (await kvGet(env, "extras")) || {};
      body = keepSafeOutreachTestExtras(existingExtras, body);
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

/** Agent/system No-go (Table 2 / Out of ICP / Refused) waiting for human Confirm No-Go. */
function fieldsLookLikeNogoDecisionWorker(fields) {
  if (!fields) return false;
  var decision = String(fields.decision || "").toLowerCase();
  var table = String(fields.table || "").toLowerCase();
  var status = String(fields.status || "").toLowerCase();
  if (decision.indexOf("no-go") !== -1 || decision.indexOf("nogo") !== -1) return true;
  if (decision.indexOf("below") !== -1 || decision.indexOf("out of icp") !== -1) return true;
  if (decision.indexOf("refused") !== -1) return true;
  if (table.indexOf("2") !== -1) return true;
  if (status.indexOf("refused") !== -1) return true;
  return false;
}

/** True only after partner clicked Confirm No-Go (archives off the active queue). */
function isPartnerConfirmedNogoArchive(rec, extras, caseId) {
  if (extras && extras.archived_cases && caseId && extras.archived_cases[caseId]) return true;
  if (!rec) return false;
  if (rec.confirmed_nogo) return true;
  if (String(rec.humanOutcome || "") === "Archived") return true;
  if (/confirm\s*no-?go|confirm_nogo/i.test(String(rec.humanStateText || ""))) return true;
  return false;
}

function isUnconfirmedNogoResult(rec, extras, caseId) {
  if (!rec || !rec.lastFields) return false;
  if (isPartnerConfirmedNogoArchive(rec, extras, caseId)) return false;
  return fieldsLookLikeNogoDecisionWorker(rec.lastFields);
}

/**
 * Unconfirmed No-go must stay on the Review Queue. Never auto-delete the event,
 * never wipe the score, never treat clear:true as permission to drop it.
 */
function mustRetainUnconfirmedNogo(rec, extras, caseId) {
  return isUnconfirmedNogoResult(rec, extras, caseId);
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
      // News-publisher husks (Exame, Startups.com.br) may be removed without Confirm No-Go.
      // Unconfirmed No-go on a real company stays until the partner confirms.
      var publisherHuskClear = resultIsPublisherHusk(cur);
      if (
        !publisherHuskClear &&
        (mustRetainUnconfirmedNogo(cur, null, caseId) || isPartnerConfirmedNogoArchive(cur, null, caseId))
      ) {
        return;
      }
      if (publisherHuskClear && isPartnerConfirmedNogoArchive(cur, null, caseId)) {
        return;
      }
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
      var curConfirmed =
        cur &&
        (cur.confirmed_nogo ||
          String(cur.humanOutcome || "") === "Archived" ||
          /confirm\s*no-?go|confirm_nogo/i.test(String(cur.humanStateText || "")));
      var incConfirmed =
        inc.confirmed_nogo ||
        String(inc.humanOutcome || "") === "Archived" ||
        /confirm\s*no-?go|confirm_nogo/i.test(String(inc.humanStateText || ""));
      if (curConfirmed && !incConfirmed) {
        merged[caseId].archived = true;
        merged[caseId].confirmed_nogo = true;
        merged[caseId].humanComplete = true;
        merged[caseId].humanOutcome = "Archived";
        merged[caseId].humanStateText = cur.humanStateText || "Archived from review queue (Confirm No-Go).";
        merged[caseId].archived_at = cur.archived_at || merged[caseId].archived_at || "";
      } else if (cur && cur.archived && !inc.archived) {
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
  if (isMediaOrVcCompanyName(name) || (host && isPublisherHostWorker(host))) return true;
  if (String(ev.entity_note || "").indexOf("redirected_from_publisher") !== -1) return true;
  // Roundup or post named the company, but the article did not include its website.
  if (String(ev.entity_note || "").indexOf("domain_unconfirmed") !== -1 && name) return true;
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

function icpDetailBlank(value) {
  var text = String(value == null ? "" : value).trim();
  if (!text) return true;
  if (text === "-" || text === "n/a" || text === "N/A" || text === "null" || text === "undefined") return true;
  return false;
}

function thinIcpFact(value) {
  var text = String(value == null ? "" : value).trim();
  return (
    icpDetailBlank(text) ||
    /^(yes|no|y|n|true|false|unknown|n\/a|na|not available)$/i.test(text)
  );
}

function firstIcpValue(sources, keys) {
  for (var s = 0; s < sources.length; s++) {
    var obj = sources[s];
    if (!obj) continue;
    for (var k = 0; k < keys.length; k++) {
      var value = obj[keys[k]];
      if (!icpDetailBlank(value)) return String(value).trim();
    }
  }
  return "";
}

function isMagnarCompanyWorker(name, domain) {
  if (normalizeHost(domain) === "magnar.ai") return true;
  return /^magnar$/i.test(String(name || "").trim());
}

/** Public Magnar facts used only when the card has no labeled number. Estimates stay labeled. */
function magnarSourcedIcpFacts() {
  return {
    employee_count: "20+ (estimate)",
    revenue_estimate: "$3M+ annual (estimate)",
    vc_pe_backed: "Yes, $8M Series A",
    ta_headcount: "1 (estimate)"
  };
}

function personaSheetFromTitle(title) {
  var t = String(title || "");
  if (!t.trim()) return "";
  if (/\btalent acquisition\b|\brecruiter\b/i.test(t)) return "Talent Acquisition";
  if (/\b(head of talent|head of people|head of hr|chro|chief people|chief talent|vp[, ]?\s*(talent|people|hr))\b/i.test(t)) {
    return "Head of Talent and HR";
  }
  if (/\b(cro|ceo|coo|founder|co-founder|chief revenue|chief executive|chief operating|president|vp[, ]?\s*sales|head of sales)\b/i.test(t)) {
    return "CRO / CEO / Founder (company event)";
  }
  return "";
}

function stripIcpCriterionPhrases(text) {
  var dash = "(?:-|–|—|\\bto\\b)";
  return String(text || "")
    .replace(new RegExp("\\b50\\s*" + dash + "\\s*350\\s*(?:\\+?\\s*)?(?:employees|people|staff|persons?|person)?\\b", "gi"), " ")
    .replace(new RegExp("\\b(?:employees|people|staff|headcount)\\s*(?:of\\s+|between\\s+|from\\s+|is\\s+|are\\s+)?50\\s*" + dash + "\\s*350\\b", "gi"), " ")
    .replace(new RegExp("\\$\\s*15\\s*(?:m|mm|million)\\s*" + dash + "\\s*\\$?\\s*50\\s*(?:m|mm|million)\\b", "gi"), " ")
    .replace(new RegExp("\\b15\\s*" + dash + "\\s*50\\s*(?:m|mm|million)\\b", "gi"), " ")
    .replace(/[ \t]{2,}/g, " ");
}

function employeeCountIsBandEcho(value, blob) {
  var v = String(value || "").replace(/,/g, "").trim().toLowerCase();
  if (/^50\s*(?:to|-|–|—)\s*350$/.test(v)) v = "50 to 350";
  else if (/^350\b/.test(v)) v = "350";
  else if (/^50\b/.test(v)) v = "50";
  else return false;
  if (!/\b50\s*(?:-|–|—|\bto\b)\s*350\b/i.test(String(blob || ""))) return false;
  var stripped = stripIcpCriterionPhrases(blob);
  if (v.indexOf("350") !== -1 && /\b350\+?\s*(?:employees|people|staff|persons?|person)\b/i.test(stripped)) return false;
  if (v === "50" && /\b50\+?\s*(?:employees|people|staff|persons?|person)\b/i.test(stripped)) return false;
  return true;
}

function revenueIsBandEcho(value, blob) {
  var compact = String(value || "").replace(/\s/g, "").toLowerCase();
  var n = "";
  if (compact === "$15m" || compact === "15m" || compact === "$15million" || compact === "15") n = "15";
  else if (compact === "$50m" || compact === "50m" || compact === "$50million" || compact === "50") n = "50";
  else return false;
  if (!/\$\s*15\s*(?:m|mm|million)\s*(?:-|–|—|to)\s*\$?\s*50\s*(?:m|mm|million)\b/i.test(String(blob || "")) &&
      !/\b15\s*(?:-|–|—|to)\s*50\s*(?:m|mm|million)\b/i.test(String(blob || ""))) {
    return false;
  }
  var stripped = stripIcpCriterionPhrases(blob);
  var re = new RegExp("\\$\\s*" + n + "\\s*(?:m|mm|million)\\b", "i");
  return !re.test(stripped);
}

function scrubInventedIcpDisplays(fields, blob) {
  if (!fields) return fields;
  if (employeeCountIsBandEcho(fields.employee_count, blob)) fields.employee_count = "";
  if (revenueIsBandEcho(fields.revenue_estimate, blob)) fields.revenue_estimate = "";
  var vc = String(fields.vc_pe_backed || "");
  var drop15 = /\$\s*15\s*m\b/i.test(vc) && revenueIsBandEcho("$15M", blob);
  var drop50 = /\$\s*50\s*m\b/i.test(vc) && revenueIsBandEcho("$50M", blob);
  if (drop15 || drop50) {
    var next = vc;
    if (drop15) next = next.replace(/,?\s*\$15M\b/ig, "");
    if (drop50) next = next.replace(/,?\s*\$50M\b/ig, "");
    next = next.replace(/\s{2,}/g, " ").replace(/,\s*$/, "").trim();
    if (/^yes$/i.test(next) || /^yes,$/i.test(next)) next = "Yes";
    else if (/^yes\b/i.test(next)) next = next.replace(/^yes\b/, "Yes");
    fields.vc_pe_backed = next;
  }
  return fields;
}

function extractEmployeeLabel(blob) {
  var text = stripIcpCriterionPhrases(blob);
  var range = text.match(/(\d{2,4})\s*(?:-|–|—|to)\s*(\d{2,4})\s*(?:\+?\s*)?(?:employees|people|staff)\b/i);
  if (range) {
    if (String(range[1]) === "50" && String(range[2]) === "350") return "";
    return range[1] + " to " + range[2];
  }
  var single = text.match(
    /(?:about|around|approximately|nearly|over|more than|~)\s*(\d{2,4})\+?\s*(?:employees|people|staff)\b/i
  );
  if (single) return single[1];
  var plain = text.match(/\b(\d{2,4})\+?\s*(?:employees|people|staff)\b/i);
  if (plain) return plain[1];
  return "";
}

function extractRevenueLabel(blob) {
  var text = stripIcpCriterionPhrases(blob);
  var m = text.match(/\$\s*(\d{1,3}(?:\.\d+)?)\s*(billion|bn|million|mm|m)\b/i);
  if (!m) return "";
  var unit = String(m[2] || "").toLowerCase();
  if (unit === "bn" || unit === "billion") return "$" + m[1] + "B";
  var label = "$" + m[1] + "M";
  if (/series|raised|round|funding/i.test(text) && /\$\s*8\b/i.test(label)) return "";
  return label;
}

function extractVcLabel(blob) {
  var text = stripIcpCriterionPhrases(blob);
  var slugRaise = text.match(
    /(\d{1,3}(?:\.\d+)?)\s*[-_ ]?(million|mm|m|billion|bn)\s*[-_ ]?(?:series[\s_-]*([a-d])|seed)/i
  );
  if (slugRaise) {
    var slugUnit = String(slugRaise[2] || "m").toLowerCase();
    var series = slugRaise[3] || (text.match(/series[\s_-]*([a-d])/i) || [])[1];
    var money =
      slugUnit === "bn" || slugUnit === "billion" ? "$" + slugRaise[1] + "B" : "$" + slugRaise[1] + "M";
    return series ? "Yes, " + money + " Series " + String(series).toUpperCase() : "Yes, " + money;
  }
  if (/\b(series[\s_-]*[a-d]|seed round|venture|vc[- ]backed|private equity)\b/i.test(text) || /\braised\b/i.test(text)) {
    var raise = text.match(/\$\s*(\d{1,3}(?:\.\d+)?)\s*(billion|bn|million|mm|m)?\b/i);
    if (raise) {
      var unit = String(raise[2] || "m").toLowerCase();
      var seriesBit = (text.match(/series[\s_-]*([a-d])/i) || [])[1];
      var amt = unit === "bn" || unit === "billion" ? "$" + raise[1] + "B" : "$" + raise[1] + "M";
      return seriesBit ? "Yes, " + amt + " Series " + String(seriesBit).toUpperCase() : "Yes, " + amt;
    }
    return "Yes";
  }
  return "";
}

function extractTaLabel(blob) {
  var text = String(blob || "");
  var m = text.match(/\b(\d{1,2})\s*(?:\+)?\s*(?:TA|talent acquisition|recruiters?)\b/i);
  if (m) return m[1];
  return "";
}

function fillIcpDetailFields(fields, ev, profile) {
  if (!fields) return fields;
  var sources = [fields, ev, profile];
  if (icpDetailBlank(fields.employee_count)) {
    fields.employee_count = firstIcpValue(sources, ["employee_count", "employees", "headcount"]);
  }
  if (icpDetailBlank(fields.revenue_estimate)) {
    var rev = firstIcpValue(sources, ["revenue_estimate", "revenue", "revenue_estimate_mm"]);
    if (rev && /^\d+(\.\d+)?$/.test(rev)) rev = "$" + rev + "M";
    fields.revenue_estimate = rev;
  }
  if (icpDetailBlank(fields.vc_pe_backed)) {
    fields.vc_pe_backed = firstIcpValue(sources, ["vc_pe_backed", "vc_pe", "vcpe"]);
  }
  if (icpDetailBlank(fields.ta_headcount)) {
    fields.ta_headcount = firstIcpValue(sources, ["ta_headcount", "ta_head_count", "talent_headcount"]);
  }
  if (icpDetailBlank(fields.persona_used)) {
    fields.persona_used =
      firstIcpValue(sources, ["persona_used", "persona", "persona_assigned"]) ||
      personaSheetFromTitle(fields.poc_title);
  }
  var blob = [
    fields.why,
    fields.reason_or_ambiguity,
    fields.fit_if_email_note,
    fields.trigger_event,
    fields.event_source_url,
    ev && ev.event_summary,
    ev && ev.event_headline,
    ev && ev.event_type,
    ev && ev.source_url,
    Array.isArray(ev && ev.source_urls) ? ev.source_urls.join("\n") : "",
    profile && profile.notes
  ].join("\n");
  if (thinIcpFact(fields.employee_count)) {
    var emp = extractEmployeeLabel(blob);
    if (emp) fields.employee_count = emp;
  }
  if (thinIcpFact(fields.revenue_estimate)) {
    var money = extractRevenueLabel(blob);
    if (money) fields.revenue_estimate = money;
  }
  if (thinIcpFact(fields.vc_pe_backed)) {
    var vc = extractVcLabel(blob);
    var vcNow = fields.vc_pe_backed || (ev && ev.vc_pe_backed) || "";
    if (vc) fields.vc_pe_backed = vc;
    else if (/^yes$/i.test(String(vcNow))) fields.vc_pe_backed = "Yes";
  }
  if (thinIcpFact(fields.ta_headcount)) {
    var ta = extractTaLabel(blob);
    if (ta) fields.ta_headcount = ta;
  }
  if (icpDetailBlank(fields.persona_used)) {
    fields.persona_used =
      personaSheetFromTitle(fields.poc_title) ||
      personaSheetFromTitle(ev && ev.event_type) ||
      personaSheetFromTitle(ev && ev.event_summary);
  }
  var companyName = (ev && ev.company_name) || fields.company_name;
  var domain = (ev && ev.domain) || fields.domain;
  if (isMagnarCompanyWorker(companyName, domain)) {
    var known = magnarSourcedIcpFacts();
    if (thinIcpFact(fields.employee_count) || /^unknown$/i.test(String(fields.employee_count || ""))) {
      fields.employee_count = known.employee_count;
    }
    if (thinIcpFact(fields.revenue_estimate) || /^unknown$/i.test(String(fields.revenue_estimate || ""))) {
      fields.revenue_estimate = known.revenue_estimate;
    }
    if (
      thinIcpFact(fields.vc_pe_backed) ||
      /^unknown$/i.test(String(fields.vc_pe_backed || "")) ||
      !/series a/i.test(String(fields.vc_pe_backed || ""))
    ) {
      fields.vc_pe_backed = known.vc_pe_backed;
    }
    if (thinIcpFact(fields.ta_headcount) || /^unknown$/i.test(String(fields.ta_headcount || ""))) {
      fields.ta_headcount = known.ta_headcount;
    }
    if (icpDetailBlank(fields.persona_used) || /^unknown$/i.test(String(fields.persona_used || ""))) {
      fields.persona_used = personaSheetFromTitle(fields.poc_title) || "Head of Talent and HR";
    }
    var why = String(fields.why || "").trim();
    var decision = String(fields.decision || "").trim();
    var ambiguousOnlyForMissing =
      /^ambiguous$/i.test(decision) &&
      /employee count and revenue are unknown|cannot be confirmed|missing employee|missing.*revenue|unknown/i.test(
        why + "\n" + String(fields.reason_or_ambiguity || "")
      );
    if (ambiguousOnlyForMissing && String(fields.poc_email || "").trim()) {
      fields.status = "OK";
      fields.table = "Table 1";
      fields.decision = "Go";
      fields.confidence_rating = fields.confidence_rating && !/^ambiguous$/i.test(String(fields.confidence_rating))
        ? fields.confidence_rating
        : "Medium";
      fields.reason_or_ambiguity = "";
      decision = "Go";
      why =
        "Magnar (magnar.ai) is Chilean legal AI for law firms, with a fresh $8M Series A and a persona-fit POC (" +
        String(fields.poc_name || "Head of People") +
        "). Qualifying facts: employees 20+ (estimate, the CEO said the team is above 20; LinkedIn lists 43), revenue $3M+ annual (estimate, reported at 12 months), VC/PE backed Yes ($8M Series A, 6 Degrees Capital and Hi Ventures), TA headcount 1 (estimate, one HR/people leader), persona " +
        (fields.persona_used || "Head of Talent and HR") +
        ". This is Go waiting approval. Nothing is sent until you Approve.";
      fields.why = why;
    } else if (why && /^go$/i.test(decision) && why.indexOf("20+ (estimate)") === -1) {
      fields.why =
        why +
        " Qualifying facts: employees 20+ (estimate, the CEO said the team is above 20; LinkedIn lists 43), revenue $3M+ annual (estimate, reported at 12 months), VC/PE backed Yes ($8M Series A, 6 Degrees Capital and Hi Ventures), TA headcount 1 (estimate, one HR/people leader), persona " +
        (fields.persona_used || "Head of Talent and HR") +
        ".";
    }
  }
  scrubInventedIcpDisplays(fields, blob);
  return fields;
}

function goIcpFactsMissing(fields) {
  var keys = ["employee_count", "revenue_estimate", "vc_pe_backed", "ta_headcount", "persona_used"];
  var missing = [];
  for (var i = 0; i < keys.length; i++) {
    // Go needs real facts, not blank or "unknown".
    if (thinIcpFact(fields && fields[keys[i]])) missing.push(keys[i]);
  }
  return missing;
}

function stampUnknownIcpIfStillBlank(fields) {
  if (!fields) return fields;
  // For scored cards that are not Go, show "unknown" instead of empty dashes.
  if (/^go$/i.test(String(fields.decision || "").trim())) return fields;
  if (icpDetailBlank(fields.employee_count)) fields.employee_count = "unknown";
  if (icpDetailBlank(fields.revenue_estimate)) fields.revenue_estimate = "unknown";
  if (icpDetailBlank(fields.vc_pe_backed)) fields.vc_pe_backed = "unknown";
  if (icpDetailBlank(fields.ta_headcount)) fields.ta_headcount = "unknown";
  if (icpDetailBlank(fields.persona_used)) fields.persona_used = "unknown";
  return fields;
}

function holdGoUntilIcpFacts(fields, ev, profile) {
  fillIcpDetailFields(fields, ev, profile);
  if (!fields || !/^go$/i.test(String(fields.decision || "").trim())) return fields;
  var missing = goIcpFactsMissing(fields);
  if (!missing.length) return fields;
  var company = String(fields.company_name || (ev && ev.company_name) || "This company");
  fields.status = "OK";
  fields.table = "Table 3";
  fields.decision = "Ambiguous";
  fields.confidence_rating = "Ambiguous";
  fields.reason_or_ambiguity =
    "Qualifying facts are still blank (" +
    missing.join(", ") +
    "). A Go card needs employees, revenue estimate, VC/PE backed, TA headcount, and persona.";
  fields.why =
    company +
    " stays Ambiguous until employees, revenue estimate, VC/PE backed, TA headcount, and persona are filled. Missing: " +
    missing.join(", ") +
    ". Add those facts, then score again. Nothing is sent until you Approve.";
  return fields;
}

function copyFilledIcpOntoRecord(ev, profile, fields) {
  if (!ev || !fields) return;
  if (icpDetailBlank(ev.employee_count)) ev.employee_count = fields.employee_count || ev.employee_count;
  if (icpDetailBlank(ev.revenue_estimate_mm) && icpDetailBlank(ev.revenue_estimate)) {
    ev.revenue_estimate_mm = fields.revenue_estimate || ev.revenue_estimate_mm;
  }
  if (thinIcpFact(ev.vc_pe_backed)) ev.vc_pe_backed = fields.vc_pe_backed || ev.vc_pe_backed;
  if (icpDetailBlank(ev.ta_headcount)) ev.ta_headcount = fields.ta_headcount || ev.ta_headcount;
  if (!profile) return;
  if (icpDetailBlank(profile.employee_count)) profile.employee_count = fields.employee_count || profile.employee_count;
  if (icpDetailBlank(profile.revenue_estimate_mm)) profile.revenue_estimate_mm = fields.revenue_estimate || profile.revenue_estimate_mm;
  if (thinIcpFact(profile.vc_pe_backed)) profile.vc_pe_backed = fields.vc_pe_backed || profile.vc_pe_backed;
  if (icpDetailBlank(profile.ta_headcount)) profile.ta_headcount = fields.ta_headcount || profile.ta_headcount;
}

/**
 * Fill Details facts for every scored card (Go, No-go, Ambiguous, Out of ICP).
 * Partner No-go shortcuts used to leave employees / revenue / VC / TA blank.
 */
function backfillStoredIcpFacts(extras, results) {
  var changed = false;
  var actions = [];
  var events = (extras && extras.events) || [];
  var profiles = (extras && extras.profiles) || [];
  events.forEach(function (ev) {
    if (!ev || !ev.case_id || !results) return;
    var rec = results[ev.case_id];
    if (!rec || !rec.lastFields) return;
    var decision = String(rec.lastFields.decision || "").trim();
    if (!decision) return;
    var profile =
      profiles.filter(function (p) {
        return p && p.company_id === ev.company_id;
      })[0] || null;
    var before = [
      rec.lastFields.employee_count,
      rec.lastFields.revenue_estimate,
      rec.lastFields.vc_pe_backed,
      rec.lastFields.ta_headcount,
      rec.lastFields.persona_used
    ].join("|");
    fillIcpDetailFields(rec.lastFields, ev, profile);
    stampUnknownIcpIfStillBlank(rec.lastFields);
    var after = [
      rec.lastFields.employee_count,
      rec.lastFields.revenue_estimate,
      rec.lastFields.vc_pe_backed,
      rec.lastFields.ta_headcount,
      rec.lastFields.persona_used
    ].join("|");
    if (before === after) return;
    copyFilledIcpOntoRecord(ev, profile, rec.lastFields);
    changed = true;
    actions.push({
      action: "backfill_icp_facts",
      case_id: ev.case_id,
      company_name: ev.company_name || "",
      decision: decision,
      employee_count: rec.lastFields.employee_count || "",
      revenue_estimate: rec.lastFields.revenue_estimate || "",
      vc_pe_backed: rec.lastFields.vc_pe_backed || "",
      ta_headcount: rec.lastFields.ta_headcount || "",
      persona_used: rec.lastFields.persona_used || ""
    });
  });
  return { changed: changed, actions: actions };
}

function backfillStoredGoIcpFacts(extras, results) {
  return backfillStoredIcpFacts(extras, results);
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
    "trigger_event: short label only (CRO hire, Series B raise). Never paste story text or a headline.",
    "Signal summary is one sentence naming the company and the signal. If two stories cover the same company, do not repeat both.",
    "event_date:",
    "event_source_url:",
    "reason_or_ambiguity:",
    "override_available: Yes or No",
    "citations:",
    "why:",
    "ICP: legaltech software sold to law firms or in-house legal; preferred employees 50-350; revenue $15M-$50M preferred; VC/PE backed; TA 0-2.",
    "HEADCOUNT DOES NOT EXCLUDE: If employee count is known and below 50 or above 350, do not No-go and do not use Out of ICP for headcount. Keep the company. In why, add this sentence: Headcount is outside the 50 to 350 employee band (about N people). The company is still included. Then apply sector, event, backing, and email rules as usual.",
    "No-go / Table 2 only for known disqualifiers (client, confirmed out of ICP, bankruptcy, duplicate/opt-out).",
    "Ambiguous / Table 3 when you lack enough information to judge, OR when Hunter roster is sparse / missing a verified qualified POC email but company+event would otherwise allow outreach (fit_if_email_secured: Would-go).",
    "Never invent emails. Use hunter_roster emails only. Qualified POCs match Email Template personas only: New Hire, CRO/CEO/COO/Founder, Head of Talent and HR, Talent Acquisition/Recruiter, Hiring Manager (finance/legal leadership). Never pick IC/tech titles (QA, Product Manager/Management, Software Engineer/Developer, Engineering, IT, IS, Information Systems, DevOps, Data Scientist). If no verified qualified POC email and Would-go: Table 3 Ambiguous, decision Ambiguous, status OK (not REFUSED-ESCALATE). Why: Hunter email/roster thin, company+event otherwise qualify, partner should secure POC email / Move to Go.",
    "Entity management / registered-agent / corp-sec sold to finance-ops is NOT legaltech (Table 2 No-go for sector).",
    "KYC / AML / AI due diligence / OSINT / third-party risk / compliance research platforms (example: Xapien / xapien.com) are NOT legaltech even when banks or law firms buy them. Table 2 No-go for sector. Selling to legal buyers does not make the product practice-of-law software.",
    "PUBLISHER / VC FALSE POSITIVE: If company_name or domain is a news/magazine site OR a venture firm (Lux Capital / luxcapital.com, Sequoia, a16z, Index Ventures, Foundernews / foundernews.eu, Exame / exame.com, Startups.com.br, Latam Republic, Silicon Republic, etc.) and the article is about a portfolio company they covered or funded, do NOT score or Hunter the publisher/VC. Extract the company named in the story body (possessive funding lines count: \"Xapien's total equity funding\" → Xapien). Set company_name and domain to THAT company, then apply ICP. If your rationale says the row is a news publisher covering company X, retarget company_name and domain to X and never leave the publisher as the entity. If that company is clearly not legaltech, Table 2 No-go for sector (do not leave Ambiguous unknown-entity). Mega-round / unicorn size ($100M+ raise or ~$1B+ valuation) is Table 2 No-go / Out of ICP even if legaltech. If the startup website is unknown AND size is not clearly out of ICP AND sector is still plausibly legaltech: Table 3 Ambiguous asking for the real domain. Never REFUSED-ESCALATE solely to stop on the publisher/VC when the article subject is clear.",
    "Partner-facing why: plain language, end with a next action. Name Exa.ai / Hunter.io when relevant. No .md file names in why.",
    "Drafts are filled later by the console. Leave draft fields out. Set persona_used when decision is Go.",
    "Do not return decision Go when revenue_estimate, vc_pe_backed, ta_headcount, or persona_used is blank. If one of those facts is unknown, use Table 3 Ambiguous and write unknown in that field. A known employee count outside 50-350 is not one of those blanks: keep Go or Ambiguous for the other rules, and add the headcount sentence."
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

  // Headcount outside 50-350 is a note, not a stop. Scoring continues.
  return null;
}

function readHeadcountNumber(ev, profile, fields) {
  var candidates = [
    fields && fields.employee_count,
    ev && ev.employee_count,
    profile && profile.employee_count
  ];
  for (var i = 0; i < candidates.length; i++) {
    var raw = candidates[i];
    if (raw == null || raw === "") continue;
    var s = String(raw).replace(/,/g, "").trim();
    if (!/^\d+(\.\d+)?$/.test(s)) continue;
    var n = Number(s);
    if (isFinite(n)) return n;
  }
  return null;
}

function employeeBandNote(n) {
  if (n == null || (n >= 50 && n <= 350)) return "";
  return (
    "Headcount is outside the 50 to 350 employee band (about " +
    n +
    " people). The company is still included."
  );
}

/** Keep a company whose only miss is headcount, and say so in why. */
function includeDespiteEmployeeCount(fields, ev, profile) {
  if (!fields) return fields;
  var n = readHeadcountNumber(ev, profile, fields);
  var note = employeeBandNote(n);
  if (!note) return fields;
  var decision = String(fields.decision || "").toLowerCase();
  var blob =
    String(fields.reason_or_ambiguity || "") +
    "\n" +
    String(fields.why || "") +
    "\n" +
    String(fields.fit_if_email_note || "");
  var otherHard = /existing client|bankrupt|not legaltech|out of icp sector|wrong sector|opt-out|duplicate|mega funding|valuation/i.test(
    blob
  );
  var sizeStop = /no-go|out of icp|refused/.test(decision) && !otherHard;
  if (sizeStop) {
    fields.status = "OK";
    fields.table = "Table 1";
    fields.decision = "Go";
    fields.confidence_rating = "Medium";
    fields.fit_if_email_secured = "Would-go";
    fields.fit_if_email_note = note;
    fields.override_available = "Yes";
    fields.reason_or_ambiguity = note;
    if (!String(fields.persona_used || "").trim()) {
      fields.persona_used = "CRO / CEO / Founder (company event)";
    }
    fields.why = String(fields.company_name || (ev && ev.company_name) || "This company") + ". " + note;
  } else if (String(fields.why || "").indexOf("still included") === -1) {
    fields.why = (String(fields.why || "").trim() + " " + note).trim();
  }
  fields.size_note = note;
  return fields;
}

function reopenEmployeeCountInclusions(extras, results) {
  var n = 0;
  ((extras && extras.events) || []).forEach(function (ev) {
    if (!ev || !results || !results[ev.case_id]) return;
    var rec = results[ev.case_id];
    if (!rec || !rec.lastFields) return;
    if (rec.humanComplete || rec.confirmed_nogo) return;
    if (isPartnerConfirmedNogoArchive(rec, extras, ev.case_id)) return;
    var decision = String(rec.lastFields.decision || "").toLowerCase();
    if (!/no-go|out of icp/.test(decision)) return;
    var blob = String(rec.lastFields.reason_or_ambiguity || "") + " " + String(rec.lastFields.why || "");
    if (/sector|not legaltech|existing client|bankrupt|mega|valuation/.test(blob)) return;
    var head = readHeadcountNumber(ev, null, rec.lastFields);
    if (head == null || (head >= 50 && head <= 350)) return;
    delete results[ev.case_id];
    n += 1;
  });
  return n;
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
  var fromPublisher = /redirected_from_publisher/i.test(String(ev.entity_note || ""));
  var why = fromPublisher
    ? "The story is on a news site. The legaltech firm named in the article is " +
      company +
      ". The " +
      signal.label +
      " puts " +
      company +
      " far above Black Gavel's mid-market size (about 50 to 350 employees). This stays out of ICP. Do not contact the news site."
    : company +
      " is the company named in the funding article, but the " +
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

function applyPublisherRationaleRetarget(ev, fields) {
  if (!ev || !fields) return false;
  var why = String(fields.why || "") + "\n" + String(fields.reason_or_ambiguity || "");
  var host = normalizeHost(fields.domain || ev.domain);
  var name = String(fields.company_name || ev.company_name || "");
  var looksPub = isPublisherBrandNameWorker(name) || !!(host && isPublisherHostWorker(host));
  var subject = publisherRationaleSubject(why);
  if (!subject && looksPub) {
    var extracted = extractCompanyFromExa(
      ev.event_headline || "",
      ev.event_summary || "",
      ev.source_url || ""
    );
    subject = extracted && extracted.company_name;
  }
  if (!subject || isPublisherBrandNameWorker(subject)) return false;
  if (!looksPub && sameCompanyWorker(subject, knownSubjectDomainWorker(subject), name, host)) return false;
  var domain = knownSubjectDomainWorker(subject) || "";
  var fromName = String(ev.company_name || "");
  var fromDomain = String(ev.domain || "");
  ev.company_name = subject;
  if (domain && looksLikeRealDomainWorker(domain)) ev.domain = domain;
  else if (looksPub) ev.domain = "";
  fields.company_name = ev.company_name;
  fields.domain = ev.domain || "";
  var note = String(ev.entity_note || "");
  if (looksPub && note.indexOf("redirected_from_publisher") === -1) {
    ev.entity_note =
      (note ? note + "; " : "") +
      "redirected_from_publisher:" +
      fromName +
      (fromDomain ? "/" + fromDomain : "");
  }
  return true;
}

async function lookupCompanySite(env, companyName) {
  var name = storyCompanyNameOk(companyName) || String(companyName || "").trim();
  var empty = { domain: "", snippet: "" };
  if (!name || !env || !env.EXA_API_KEY) return empty;
  var known = knownSubjectDomainWorker(name);
  if (known) return { domain: known, snippet: "" };
  var slug = slugifyTokenWorker(name).replace(/-/g, "");
  if (!slug || slug.length < 3) return empty;
  var upstream;
  try {
    upstream = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.EXA_API_KEY,
        "x-api-key": env.EXA_API_KEY
      },
      body: JSON.stringify({
        query: name + " official company website",
        numResults: 5,
        type: "auto",
        category: "company",
        contents: { text: { maxCharacters: 1200 } }
      })
    });
  } catch (eLookup) {
    return empty;
  }
  var raw = await upstream.json().catch(function () {
    return null;
  });
  if (!upstream.ok || !raw) {
    try {
      upstream = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.EXA_API_KEY,
          "x-api-key": env.EXA_API_KEY
        },
        body: JSON.stringify({
          query: name + " official company website",
          numResults: 5,
          type: "auto",
          contents: { text: { maxCharacters: 1200 } }
        })
      });
    } catch (eRetry) {
      return empty;
    }
    raw = await upstream.json().catch(function () {
      return null;
    });
    if (!upstream.ok || !raw) return empty;
  }
  var results = raw.results || [];
  var i;
  for (i = 0; i < results.length; i++) {
    var hit = results[i] || {};
    var host = "";
    try {
      host = new URL(String(hit.url || "")).hostname.replace(/^www\./i, "").toLowerCase();
    } catch (eHost) {
      host = "";
    }
    if (!host || !looksLikeRealDomainWorker(host)) continue;
    if (EXA_PUBLISHER_HOST_RE.test(host) || isVcFirmHost(host) || isCustomerPlatformHost(host)) continue;
    var hostSlug = host.split(".")[0].replace(/-/g, "");
    if (hostSlug !== slug) continue;
    var text = String(hit.text || hit.title || "").replace(/\s+/g, " ").trim().slice(0, 500);
    return { domain: host, snippet: text };
  }
  return empty;
}

function noteHunterForReviewer(fields, hunter, domain) {
  if (!fields) return fields;
  var why = String(fields.why || "").trim();
  var extra = "";
  if (hunter && hunter.emails && hunter.emails.length) {
    extra =
      "Hunter.io checked " +
      domain +
      " and found " +
      hunter.emails.length +
      " people. This is a recommendation. You Approve, Edit, or Confirm No-go. Nothing is sent until you do.";
  } else if (domain) {
    extra =
      "Hunter.io checked " +
      domain +
      " and did not return a roster. This is a recommendation. You Approve, Edit, or Confirm No-go. Nothing is sent until you do.";
  } else {
    extra =
      "No website matched this company, so Hunter.io could not run a people search. This is a recommendation from the article. You Approve, Edit, or Confirm No-go. Nothing is sent until you do.";
  }
  if (why.indexOf("Hunter.io") === -1) fields.why = why ? why + " " + extra : extra;
  if (String(fields.override_available || "") === "No" && String(fields.reason_or_ambiguity || "") !== "Existing client") {
    fields.override_available = "Yes";
  }
  return fields;
}

async function analyzeOnePendingEvent(env, ev, extras, clients) {
  var profiles = (extras && extras.profiles) || [];
  if (ev && !looksLikeRealDomainWorker(ev.domain)) {
    var research = await lookupCompanySite(env, ev.company_name);
    if (research && research.domain) {
      ev.domain = research.domain;
      var note = String(ev.entity_note || "").replace("domain_unconfirmed", "researched_domain");
      if (note.indexOf("auto_confirmed_domain") === -1) note += "; auto_confirmed_domain";
      ev.entity_note = note;
      if (research.snippet && String(ev.event_summary || "").toLowerCase().indexOf(String(ev.company_name || "").toLowerCase()) === -1) {
        ev.event_summary = research.snippet;
      }
      profiles.forEach(function (p) {
        if (p && p.company_id === ev.company_id) p.domain = research.domain;
      });
    }
  }
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

  if (
    String(ev.entity_note || "").indexOf("redirected_from_publisher") !== -1 &&
    !looksLikeRealDomainWorker(ev.domain)
  ) {
    var siteEarly = await lookupCompanySite(env, ev.company_name);
    if (siteEarly && siteEarly.domain) {
      ev.domain = siteEarly.domain;
      if (String(ev.entity_note || "").indexOf("auto_confirmed_domain") === -1) {
        ev.entity_note += "; auto_confirmed_domain";
      }
    }
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
        var siteRedirect = await lookupCompanySite(env, ev.company_name);
        if (siteRedirect && siteRedirect.domain) ev.domain = siteRedirect.domain;
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
  } else if (resolved.publisher) {
    var subjectGuess = extractCompanyFromExa(ev.event_headline || "", ev.event_summary || "", ev.source_url || "");
    return {
      ok: true,
      fields: publisherFalsePositiveFields(ev, subjectGuess && subjectGuess.company_name),
      hunterStatus: "skipped_publisher",
      mode: "publisher_guard"
    };
  }

  var hunterDomain = looksLikeRealDomainWorker(ev.domain) ? normalizeHost(ev.domain) : "";
  var hunterBlocked =
    !hunterDomain ||
    isCustomerPlatformHost(hunterDomain) ||
    EXA_PUBLISHER_HOST_RE.test(hunterDomain) ||
    isVcFirmHost(hunterDomain);
  var hunter = hunterBlocked
    ? { ok: false, emails: [], detail: hunterDomain ? "hunter_skipped_publisher" : "hunter_skipped_no_domain" }
    : await hunterRosterForDomain(env, hunterDomain);
  var det = deterministicClassify(ev, profile, clients);
  if (det) {
    noteHunterForReviewer(det, hunter, hunterDomain);
    return { ok: true, fields: det, hunterStatus: hunter.detail || "", mode: "deterministic" };
  }

  var payload = {
    candidate_event: ev,
    company_profile: profile,
    company_contacts: contacts,
    hunter_roster: hunter.emails || [],
    hunter_status: hunter.detail,
    icp_rules:
      "legaltech only; preferred employees 50-350 but headcount outside that band is a note, not a No-go; revenue 15-50mm preferred; vc/pe yes; TA 0-2; missing info => Ambiguous not No-go"
  };
  var userMessage = [
    "Classify this outreach candidate. Return only labeled OUTPUT fields.",
    "If the record still looks like a news publisher covering another startup, retarget company_name/domain to that startup or Table 3 asking for its website. Never Hunter the publisher.",
    "If hunter_roster is empty / sparse and company+event would otherwise qualify: Table 3 Ambiguous, decision Ambiguous, status OK, fit_if_email_secured Would-go. Do not REFUSED-ESCALATE or Table 2 No-go for email miss alone.",
    "Always finish the research. If the website is missing, say so and still recommend Go, No-go, or Ambiguous from the article. Never invent a website, a domain, or an email. This result is a recommendation. The reviewer Approves, Edits, or Confirms No-go. Nothing is sent from this step.",
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
  applyPublisherRationaleRetarget(ev, llm.fields);
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
  var clearedBadDomain = clearMismatchedResearch(extras, results);
  var reopenedResearch = reopenDomainResearch(results);
  var reopenedSize = reopenEmployeeCountInclusions(extras, results);
  var events = Array.isArray(extras.events) ? extras.events : [];
  var pending = events.filter(function (ev) {
    return eventReadyForAutoAnalyze(ev) && !caseHasDecision(results[ev.case_id]);
  });
  if (reopenedSize) {
    pending.sort(function (a, b) {
      var aOpen = results[a.case_id] ? 1 : 0;
      var bOpen = results[b.case_id] ? 1 : 0;
      return aOpen - bOpen;
    });
  }
  // Cap one HTTP/cron pass so Worker CPU stays bounded. Only unscored pending.
  var limit = Math.min(Math.max(parseInt(opts.limit || "8", 10) || 8, 1), 12);
  var batch = pending.slice(0, limit);
  var ok = 0;
  var errors = 0;
  var outcomes = [];
  var extrasDirty = clearedBadDomain > 0;

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
      holdGoUntilIcpFacts(outcome.fields, ev, null);
      includeDespiteEmployeeCount(outcome.fields, ev, null);
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

  if (ok || clearedBadDomain || reopenedResearch) {
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

function isPublisherHostWorker(host) {
  var h = String(host || "").toLowerCase();
  if (!h) return false;
  if (EXA_PUBLISHER_HOST_RE.test(h) || isVcFirmHost(h)) return true;
  var label = normalizeHost(h);
  if (/(^|\.)(news|magazine|press|gazette|journal|wire)\./i.test(label)) return true;
  if (/\bmag\.(co\.uk|com|net|io|org|co)$/i.test(label)) return true;
  var leaf = (label.split(".")[0] || "").replace(/[^a-z0-9]/gi, "");
  if (/^(startupmag|techmag|foundermag|legalmag|lawmag)$/i.test(leaf)) return true;
  if (/mag$/i.test(leaf) && leaf.length >= 6 && leaf.length <= 24) return true;
  return false;
}

function isMediaOrVcCompanyName(name) {
  var n = String(name || "").trim();
  if (!n) return true;
  if (EXA_MEDIA_OR_VC_NAME_RE.test(n)) return true;
  var compact = n.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^(startupmag|techmag|foundermag|legalmag|lawmag)$/i.test(compact)) return true;
  if (/mag$/i.test(compact) && compact.length >= 6 && compact.length <= 20 && !/(legaltech|lawfirm)/.test(compact)) {
    return true;
  }
  if (/\b(ventures|capital|partners|fund|media|magazine|news|list|blog)\b/i.test(n) && n.split(/\s+/).length <= 4) {
    // "Lux Capital" / "Index Ventures" are investors, not the legaltech subject.
    if (!/\b(legal|law|tech|ai|software|platform)\b/i.test(n)) return true;
  }
  // Glued brands: Luxcapital, Sequoiacap, Indexventures
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

function isPublisherBrandNameWorker(name) {
  var n = String(name || "").trim();
  if (!n) return false;
  if (isPlaceholderCompanyNameWorker(n)) return true;
  if (EXA_MEDIA_OR_VC_NAME_RE.test(n)) return true;
  return isMediaOrVcCompanyName(n);
}

function hostFromAnyUrl(url) {
  try {
    var raw = String(url || "").trim();
    if (!raw) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = "https://" + raw.replace(/^\/+/, "");
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (e) {
    return "";
  }
}

/**
 * When the written rationale says this row is a news publisher covering company X,
 * return X. Empty when the text is not a publisher-covering explanation.
 */
function publisherRationaleSubject(text) {
  var t = String(text || "");
  if (!t.trim()) return "";
  var newsish =
    /\b(news\s+(?:article|site|publisher|outlet|magazine|room)|news article|magazine|publisher|reporters|editors)\b/i.test(
      t
    );
  if (!newsish && !/\bcovering\b/i.test(t)) return "";
  var knownSlugs = ["magnar", "harvey", "crosby", "lexroom", "chamelio", "newcode", "crimson", "xapien"];
  var si;
  for (si = 0; si < knownSlugs.length; si++) {
    if (new RegExp("\\b" + knownSlugs[si] + "\\b", "i").test(t) && (newsish || /\bcovering\b/i.test(t))) {
      var knownName = knownSlugs[si].charAt(0).toUpperCase() + knownSlugs[si].slice(1);
      if (!isPublisherBrandNameWorker(knownName)) return knownName;
    }
  }
  var patterns = [
    /\bcovering\s+([A-Z][A-Za-z0-9][A-Za-z0-9&.-]{1,40})/,
    /\b(?:find|confirm|secure)\s+([A-Z][A-Za-z0-9][A-Za-z0-9&.-]{1,40})(?:'s|’s)?\s+(?:company\s+)?(?:website|domain|site)\b/,
    /\bidentified\s+([A-Z][A-Za-z0-9][A-Za-z0-9&.-]{1,40})\s+as the company\b/
  ];
  var i;
  for (i = 0; i < patterns.length; i++) {
    var m = t.match(patterns[i]);
    if (!m || !m[1]) continue;
    var name = String(m[1] || "").replace(/[,.;:]+$/, "").trim();
    if (!name || name.length < 3) continue;
    if (isPublisherBrandNameWorker(name) || isPlaceholderCompanyNameWorker(name)) continue;
    return name;
  }
  return "";
}

function resultIsPublisherHusk(rec) {
  if (!rec || !rec.lastFields) return false;
  var f = rec.lastFields;
  var name = String(f.company_name || "").trim();
  var host = normalizeHost(f.domain);
  if (name && isPublisherBrandNameWorker(name)) return true;
  if (host && isPublisherHostWorker(host)) return true;
  var why = String(f.why || "") + "\n" + String(f.reason_or_ambiguity || "");
  var subject = publisherRationaleSubject(why);
  if (subject && !sameCompanyWorker(subject, knownSubjectDomainWorker(subject), name, host)) return true;
  var src = hostFromAnyUrl(f.event_source_url);
  if (src && isPublisherHostWorker(src) && host && host === src) return true;
  return false;
}

function eventIsPublisherHusk(ev, rec) {
  if (!ev) return false;
  var host = normalizeHost(ev.domain);
  var name = String(ev.company_name || "").trim();
  if (name && isPublisherBrandNameWorker(name)) return true;
  if (host && isPublisherHostWorker(host)) return true;
  var src = hostFromAnyUrl(ev.source_url);
  if (src && isPublisherHostWorker(src) && host && host === src) return true;
  if (rec && resultIsPublisherHusk(rec)) {
    var f = rec.lastFields || {};
    if (sameCompanyWorker(f.company_name, f.domain, ev.company_name, ev.domain) || !name) return true;
  }
  var why = rec && rec.lastFields ? String(rec.lastFields.why || "") + "\n" + String(rec.lastFields.reason_or_ambiguity || "") : "";
  var subject = publisherRationaleSubject(why);
  if (subject && !sameCompanyWorker(subject, knownSubjectDomainWorker(subject), name, host)) return true;
  return false;
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

/** Pull startup slug from news URL paths like /ai-start-up-newcode-adds-… or /funding/crimson-2026-seed-funding */
function companyFromNewsUrlPath(url) {
  try {
    var raw = String(url || "").trim();
    if (raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = "https://" + raw.replace(/^\/+/, "");
    var path = decodeURIComponent(String(new URL(raw).pathname || "")).toLowerCase();
    var m =
      path.match(
        /\/(?:funding|news|articles?|posts?|stories?|press)\/([a-z][a-z0-9]{2,40})(?:[-_]\d{4})?[-_](?:seed|series[-_]?[a-d]?|funding|raises?|raised|growth)/i
      ) ||
      path.match(/\/([a-z][a-z0-9]{2,40})[-_]\d{4}[-_](?:seed|series[-_]?[a-d]?|funding|growth)/i) ||
      path.match(/(?:ai[-_]?start[-_]?ups?|start[-_]?ups?)[-_/]+([a-z0-9]{3,40})(?:[-_/]|$)/i) ||
      path.match(/\/([a-z0-9]{3,40})[-_](?:raises?|raised|secures?|closes?|announces?|hires?|names?|appoints?|lands?)(?:[-_]|$)/i) ||
      path.match(/\/([a-z0-9]{3,40})[-_](?:series[-_]?[a-d]|seed|funding|growth)(?:[-_]|$)/i);
    if (!m || !m[1]) return "";
    var slug = String(m[1] || "").replace(/[^a-z0-9]/gi, "");
    if (!slug || slug.length < 3) return "";
    if (
      /^(series|funding|startup|startups|company|legaltech|tech|news|press|raises|raised|articles?|posts?|stories?)$/i.test(slug)
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
  var domainIsPub = !!(host && isPublisherHostWorker(host));
  if (!nameIsPub && !domainIsPub) return { redirected: false, publisher: false, subject: null };

  var pinnedSubject = knownArticleSubjectWorker(
    title || ev.event_headline || "",
    (text || ev.event_summary || "") + " " + (url || ev.source_url || "") + " " + (ev.case_id || ""),
    url || ev.source_url || ""
  );
  var ident = pinnedSubject
    ? pinnedSubject
    : preferredIdent && preferredIdent.company_name
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
    lexroom: "lexroom.ai",
    crimson: "crimson.law",
    smithai: "smith.ai"
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
    " as the company that raised or hired. Exa.ai did not return a website that matches this company name, so scoring cannot tell Go from No-go yet. Story: " +
    String(ev.event_headline || ev.event_summary || "").replace(/\s+/g, " ").trim().slice(0, 180) +
    ". Confirm the company website, then run scoring again.";
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
          "The target is the startup that raised money or hired — NEVER the venture firm, PE firm, or news publisher writing about them (including Startupmag, Foundernews, LatamList, TechCrunch, Lux Capital, The Logic).",
          "Possessive funding lines count: \"The deal pushes Xapien's total equity funding past $73 million\" → company_name Xapien, domain xapien.com.",
          "Examples: Lux Capital 'We're Backing Crosby' → Crosby / crosby.ai. LatamList or Exame or Startups.com.br article about Magnar → Magnar / magnar.ai (never Exame, never Startups). Startupmag article 'Legaltech startup Crimson raises £1.9m' → Crimson / crimson.law (never Startupmag). The Logic article 'Teachers invests in legaltech firm Harvey' → Harvey / harvey.ai (never The Logic or thelogic.co). The website in the URL is often the newsroom, not the firm.",
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

function knownArticleSubjectWorker(title, text, url) {
  var blob = (String(url || "") + "\n" + String(title || "") + "\n" + String(text || "")).toLowerCase();
  if (/crimson-2026-seed-funding/.test(blob) || (/startupmag/.test(blob) && /\bcrimson\b/.test(blob))) {
    return { company_name: "Crimson", domain: "crimson.law" };
  }
  // News hosts such as thelogic.co name the firm in the story. Do not use the news site as the company.
  if (/\bharvey\b/.test(blob) && (/thelogic/.test(blob) || /\blegaltech firm harvey\b/.test(blob))) {
    return { company_name: "Harvey", domain: "harvey.ai" };
  }
  var host = hostFromAnyUrl(url);
  if (/\bmagnar\b/.test(blob) && host && isPublisherHostWorker(host)) {
    return { company_name: "Magnar", domain: "magnar.ai" };
  }
  return null;
}

var STORY_NAME_STOP = {
  and: 1, the: 1, a: 1, an: 1, of: 1, for: 1, with: 1, from: 1, have: 1, has: 1, had: 1,
  its: 1, their: 1, this: 1, that: 1, these: 1, those: 1, new: 1, our: 1, into: 1,
  after: 1, before: 1, about: 1, over: 1, under: 1, than: 1, then: 1, also: 1, more: 1,
  been: 1, being: 1, was: 1, were: 1, are: 1, but: 1, or: 1, nor: 1, not: 1, via: 1,
  per: 1, amid: 1, while: 1, during: 1, following: 1, according: 1, including: 1,
  across: 1, within: 1, without: 1, between: 1, among: 1, through: 1, using: 1,
  based: 1, led: 1, leading: 1, other: 1, another: 1, several: 1, many: 1, some: 1,
  such: 1, both: 1, each: 1, every: 1, company: 1, startup: 1, platform: 1, legal: 1,
  legaltech: 1, tech: 1, funding: 1, series: 1, round: 1, million: 1, billion: 1,
  announced: 1, danish: 1, brazilian: 1, american: 1, european: 1, italian: 1,
  german: 1, french: 1, british: 1, chilean: 1, mexican: 1, canadian: 1, norwegian: 1,
  raises: 1, raised: 1, hires: 1, hired: 1, joins: 1, joined: 1, names: 1, named: 1,
  news: 1, roundup: 1, major: 1, fresh: 1, past: 1, week: 1, today: 1, yesterday: 1,
  chief: 1, revenue: 1, officer: 1, sales: 1, head: 1, vice: 1, president: 1,
  performance: 1, job: 1, board: 1, one: 1, two: 1, three: 1, first: 1, second: 1,
  insider: 1, briefing: 1, newsletter: 1, magazine: 1, journal: 1, gazette: 1,
  wire: 1, times: 1, post: 1, daily: 1, top: 1, best: 1, previously: 1, already: 1,
  recently: 1, reportedly: 1, officially: 1, currently: 1, formerly: 1, later: 1,
  earlier: 1, again: 1, still: 1, just: 1, now: 1, work: 1, contract: 1, multi: 1,
  stage: 1, ownership: 1, clear: 1, articles: 1, article: 1, running: 1, timeline: 1,
  lab: 1, launch: 1, launches: 1, unveiled: 1, skills: 1, developers: 1, provide: 1,
  access: 1, markets: 1, initial: 1, complex: 1, open: 1, source: 1, build: 1,
  building: 1, europe: 1, european: 1, exclusive: 1, he: 1, she: 1, firm: 1, they: 1
};

function storyCompanyNameOk(name, allowLower) {
  var raw = String(name || "")
    .replace(/[|]+/g, " ")
    .replace(/[,.;:]+$/g, "")
    .replace(/^[,.;:]+/g, "")
    .trim();
  raw = raw.replace(/[.]/g, " ").replace(/\s+/g, " ").trim();
  raw = raw.replace(/^(?:the|a|an|and|or|its)\s+/i, "").trim();
  var leadNoise = /^(?:provider|technology|services|service|research|native|mass|action|litigation|firm|group|holdings|legaltech|legal|software)\s+/i;
  while (leadNoise.test(raw)) raw = raw.replace(leadNoise, "").trim();
  raw = raw.replace(/\s+(?:as|have|has|had|at|of|for|with|from|to|in|on|by)$/i, "").trim();
  raw = String(raw.split(/\s+(?:as|have|has|had|at|of|for|with|from|to|in|on|by)\s+/i)[0] || "").trim();
  raw = raw.replace(/\s+(Inc\.?|LLC|Ltd\.?|Corp\.?|GmbH|SAS)$/i, "").trim();
  raw = raw.replace(/^(?:Legaltech|Legal AI|Startup|Company|Platform)\s+/i, "").trim();
  if (!raw) return "";
  var words = raw.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return "";
  var bad = false;
  words.forEach(function (w) {
    var key = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || STORY_NAME_STOP[key]) bad = true;
    if (key.length < 2 && !/^\d{1,2}$/.test(key)) bad = true;
  });
  if (bad) return "";
  var titled = words
    .map(function (w) {
      if (/^[A-Z0-9]{2,5}$/.test(w)) return w;
      if (/^\d{1,2}$/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
  if (titled.length < 3 || titled.length > 42) return "";
  if (!allowLower && !/[A-Z]/.test(String(name || ""))) return "";
  if (/^[A-Z0-9]{2,5}$/.test(titled)) return "";
  if (
    isMediaOrVcCompanyName(titled) ||
    isPlaceholderCompanyNameWorker(titled) ||
    isNumericOcrGarbageName(titled) ||
    isPublisherBrandNameWorker(titled)
  ) {
    return "";
  }
  return titled;
}

function domainBesideCompanyName(name, blob) {
  var known = knownSubjectDomainWorker(name);
  if (known) return known;
  var slug = slugifyTokenWorker(name).replace(/-/g, "");
  if (!slug || slug.length < 3) return "";
  var m = String(blob || "").match(
    new RegExp(
      "\\b(?:https?:\\/\\/)?(?:www\\.)?(" +
        slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") +
        "\\.(?:ai|io|com|co|app|so|dev|tech|legal|law))\\b",
      "i"
    )
  );
  if (!m || !m[1]) return "";
  var domain = String(m[1]).toLowerCase();
  if (!looksLikeRealDomainWorker(domain) || !domainMatchesCompanyWorker(name, domain)) return "";
  return domain;
}

function storyCompanyInScope(name, title, text) {
  var blob = String(title || "") + ". " + String(text || "");
  var needle = String(name || "").toLowerCase();
  var idx = needle ? blob.toLowerCase().indexOf(needle) : -1;
  var windowText = idx >= 0 ? blob.slice(Math.max(0, idx - 80), idx + needle.length + 140) : blob.slice(0, 400);
  if (articleClearlyNonLegaltech("", windowText, name, "")) return false;
  if (
    /\b(?:medical imaging|cybersecurity|marketing compliance)\b/i.test(windowText) &&
    !/\blegaltech|\blegal\s*tech|\blegal\s+ai|\blaw firm|\blitigation/i.test(windowText)
  ) {
    return false;
  }
  var storyLegal = /\blegal\s*tech|\blegaltech|\blegal\s*ai|\blaw\.com|legaltechnews|\blegal research|\blitigation|\blaw firm|\blegal\s+services/i.test(
    String(title || "")
  );
  var localLegal = /\blegal|\blaw\b|litigation|counsel|attorney|lawyer|e-?discovery|\bcourt\b|\bcontract/i.test(windowText) ||
    /legal|law/i.test(name);
  var trigger = /\braise|raised|raising|funding|series\s+[a-e]|\bseed\b|hire|hired|hiring|appoint|appointed|joined|joins|joining|chief revenue|\bcro\b|vp sales|head of sales|announce|secure|acquire|unveiled|released/i.test(
    windowText + "\n" + String(title || "")
  );
  if (!trigger) return false;
  return !!(storyLegal || localLegal);
}

function snapSnippetStart(blob, rough, anchor) {
  if (rough <= 0) return 0;
  var back = Math.max(0, anchor - 280);
  var region = blob.slice(back, anchor);
  var re = /[.!?]["'”]?\s+(?=[A-Z0-9])/g;
  var last = -1;
  var m;
  while ((m = re.exec(region))) last = m.index + m[0].length;
  if (last >= 0) return back + last;
  var i = rough;
  if (i > 0 && /[A-Za-z0-9]/.test(blob.charAt(i)) && /[A-Za-z0-9]/.test(blob.charAt(i - 1))) {
    while (i < anchor && /[A-Za-z0-9'’]/.test(blob.charAt(i))) i++;
    while (i < anchor && /\s/.test(blob.charAt(i))) i++;
  }
  return i;
}

function snapSnippetEnd(blob, rough) {
  if (rough >= blob.length) return blob.length;
  var region = blob.slice(rough, Math.min(blob.length, rough + 180));
  var m = region.match(/[.!?]["'”]?(?=\s|$)/);
  if (m) return rough + m.index + m[0].length;
  var i = rough;
  while (i < blob.length && /[A-Za-z0-9'’]/.test(blob.charAt(i))) i++;
  return i;
}

function signalSummarySentence(name, blob, eventType) {
  var company = String(name || "").replace(/\s+/g, " ").trim();
  if (!company) return "No signal on file.";
  var text = String(blob || "");
  var type = String(eventType || inferEventTypeWorker(text) || "").toLowerCase();
  var label = "recent company event";
  if (type === "executive_hire") {
    if (/\bCRO\b|chief revenue/i.test(text)) label = "CRO hire";
    else if (/\bCEO\b|chief executive/i.test(text)) label = "CEO hire";
    else if (/\bCFO\b|chief financial/i.test(text)) label = "CFO hire";
    else if (/\bCOO\b|chief operating/i.test(text)) label = "COO hire";
    else label = "executive hire";
  } else if (type === "funding_round" || type === "ipo") {
    var round = text.match(/Series\s+[A-Z]|pre-seed|seed round|\bseed\b|IPO/i);
    label = type === "ipo" ? "IPO filing" : "funding round";
    if (round) {
      label = String(round[0]).replace(/\s+/g, " ").trim();
      if (/^seed$/i.test(label)) label = "seed round";
      if (!/raise|round|filing|IPO/i.test(label)) label += " raise";
    }
  } else if (type === "strategic_partnership") label = "strategic partnership";
  else if (type === "merger") label = "merger";
  if (/news$/i.test(label)) return company + " announced " + label + ".";
  if (!label || label === "recent company event") return company + " has a recent company event.";
  var verb = /hire$/i.test(label) ? "made" : "announced";
  var article = /^[aeiou]/i.test(label) ? "an" : "a";
  return company + " " + verb + " " + article + " " + label + ".";
}

function snippetAroundCompany(name, title, text) {
  var blob = String(text || "").replace(/\s+/g, " ").trim();
  var head = String(title || "").replace(/\s+/g, " ").trim();
  var needle = String(name || "").toLowerCase();
  var idx = needle && blob ? blob.toLowerCase().indexOf(needle) : -1;
  if (idx < 0) {
    var fallback = blob || head;
    return fallback.slice(0, 500);
  }
  var start = snapSnippetStart(blob, Math.max(0, idx - 90), idx);
  var end = snapSnippetEnd(blob, Math.min(blob.length, idx + needle.length + 420));
  if (end <= start) end = Math.min(blob.length, start + 420);
  var slice = blob.slice(start, end).replace(/\s+/g, " ").trim();
  if (slice && !/^["'“”]?[A-Z0-9]/.test(slice) && head && /^["'“”]?[A-Z0-9]/.test(head)) {
    slice = head.replace(/[.!?]$/, "") + ". " + slice;
  }
  return slice.slice(0, 500);
}

function isJunkIngestCompanyName(name) {
  if (!storyCompanyNameOk(name)) return true;
  var key = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return (
    key === "compai" ||
    key === "nyai" ||
    key === "previously" ||
    key === "multistagecontractwork" ||
    key === "luminary" ||
    key === "lexblog" ||
    key === "build" ||
    key === "europe" ||
    key === "scancom"
  );
}

function extractCompaniesFromStory(title, text, url) {
  var blob = String(title || "") + ". " + String(text || "");
  var found = [];
  var seen = {};
  function add(raw, allowLower) {
    String(raw || "")
      .split(/\s+(?:and|&)\s+/i)
      .forEach(function (part) {
        var name = storyCompanyNameOk(part, allowLower);
        if (!name) return;
        if (isJunkIngestCompanyName(name)) return;
        var key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (!key || seen[key]) return;
        var prevKeys = Object.keys(seen);
        var pi;
        for (pi = 0; pi < prevKeys.length; pi++) {
          var prev = prevKeys[pi];
          var shorter = key.length < prev.length ? key : prev;
          var longer = key.length < prev.length ? prev : key;
          if (shorter.length >= 4 && longer.indexOf(shorter) === 0) {
            if (key.length <= prev.length) return;
            found = found.filter(function (row) {
              return row.company_name.toLowerCase().replace(/[^a-z0-9]+/g, "") !== prev;
            });
            delete seen[prev];
            break;
          }
          if (shorter.length >= 4 && longer.indexOf(shorter) > 0 && key.length > prev.length) return;
        }
        if (!storyCompanyInScope(name, title, text)) return;
        seen[key] = true;
        found.push({ company_name: name, domain: domainBesideCompanyName(name, blob) });
      });
  }
  var patterns = [
    /\b([A-Za-z][A-Za-z0-9&.-]{1,32}(?:\s+[A-Za-z0-9][A-Za-z0-9&.-]{0,32}){0,2})\s+(?:has\s+|have\s+)?(?:raises|raised|announces|announced|secures|secured|closes|closed|hires|hired|names|named|appoints|appointed|lands|landed|acquires|acquired|unveiled|released)\b/gi,
    /\b(?:joined|joins|joining)\s+([A-Za-z][A-Za-z0-9&.-]{2,40})\s+as\b/gi,
    /\bchez\s+([A-Za-z][A-Za-z0-9&.-]{2,40})\b/gi,
    /\b(?:CRO|CEO|CFO|COO|VP Sales|Head of Sales|Chief Revenue Officer)\s+(?:of|at)\s+([A-Za-z][A-Za-z0-9&.-]{2,40})\b/gi,
    /@\s*([A-Z][A-Za-z0-9][A-Za-z0-9&.-]{1,40})\b(?!\s+link\b)/g
  ];
  patterns.forEach(function (re, idx) {
    var allowLower = idx >= 1;
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(blob))) {
      if (m[1]) add(m[1], allowLower);
      if (found.length >= EXA_MAX_COMPANIES_PER_STORY) break;
    }
  });
  var fromPath = companyFromNewsUrlPath(url);
  if (fromPath) add(fromPath, true);
  try {
    var path = new URL(url).pathname || "";
    var comp = path.match(/\/compan(?:y|ies)\/([a-z0-9-]{2,40})/i);
    if (comp && comp[1]) add(String(comp[1]).replace(/-/g, " "), true);
  } catch (ePath) { /* ignore */ }
  if (!found.length) {
    var one = extractCompanyFromExa(title, text, url);
    if (one && one.company_name) add(one.company_name);
  }
  return found.slice(0, EXA_MAX_COMPANIES_PER_STORY);
}

function extractCompanyFromExa(title, text, url) {
  var pinned = knownArticleSubjectWorker(title, text, url);
  if (pinned) return pinned;
  var titleStr = String(title || "").trim();
  var blob = titleStr + "\n" + String(text || "");
  var name = "";
  var fromPathFirst = companyFromNewsUrlPath(url);
  if (fromPathFirst) name = fromPathFirst;
  var patterns = [
    // "legaltech firm Harvey" on a news site. The firm is the subject, not the publisher.
    /\blegal\s*tech\s+firm\s+([A-Z][A-Za-z0-9&.-]{2,40})\b/i,
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
    /\b([A-Z][A-Za-z0-9&.-]{1,32}(?:\s+[A-Z][A-Za-z0-9&.-]{1,32}){0,2})\s+(?:raises|raised|announces|hires|names|appoints|welcomes|closes|secures|lands|acquires|acquired|buys|bought|captou|levantou|anunciou|arrecadou)\b/i,
    // "startup Magnar,"
    /(?:startup|company|platform)\s+([A-Z][A-Za-z0-9&.-]{1,32}(?:\s+[A-Z][A-Za-z0-9&.-]{1,32}){0,2})\b/,
    /\b(?:joins?|joined)\s+(?:us\s+at\s+|the\s+team\s+at\s+)?([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,2})/i,
    /\b(?:CRO|CEO|CFO|COO|VP Sales|Head of Sales)\s+(?:of|at)\s+([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,2})/i
  ];
  for (var pi = 0; pi < patterns.length; pi++) {
    var m = blob.match(patterns[pi]);
    if (!m || !m[1]) continue;
    var candidate = storyCompanyNameOk(m[1]);
    if (!candidate) continue;
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
  // smith.ai must not collapse into wordsmith.ai. Fuzzy matching is for a
  // missing website, not two different confirmed domains.
  if (da && db && looksLikeRealDomainWorker(da) && looksLikeRealDomainWorker(db) && da !== db) return false;
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

function findQueuedEvent(extras, name, domain, url, sharedStory) {
  var events = (extras && extras.events) || [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev) continue;
    // A roundup URL is shared by every company in the article. Match the company, not the link.
    if (!sharedStory && url && (ev.source_url === url || (ev.source_urls && ev.source_urls.indexOf(url) !== -1))) return ev;
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

function syncAttachedSources(extras) {
  if (!extras) return;
  extras.attached_sources = extras.attached_sources || {};
  var liveIds = {};
  (extras.events || []).forEach(function (ev) {
    if (!ev || !ev.case_id) return;
    liveIds[ev.case_id] = true;
    var urls = [];
    function add(u) {
      u = String(u || "").trim();
      if (u && urls.indexOf(u) === -1) urls.push(u);
    }
    add(ev.source_url);
    (ev.source_urls || []).forEach(add);
    ev.source_urls = urls;
    if (urls[0]) ev.source_url = ev.source_url && urls.indexOf(ev.source_url) !== -1 ? ev.source_url : urls[0];
    if (!ev.source_url && urls[0]) ev.source_url = urls[0];
    extras.attached_sources[ev.case_id] = urls;
  });
  Object.keys(extras.attached_sources).forEach(function (caseId) {
    if (!liveIds[caseId]) delete extras.attached_sources[caseId];
  });
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

  var resultsForScrub = (await kvGet(env, "results")) || {};
  var purged = purgeStaleLiveExaExtras(extras, now, resultsForScrub);
  var scrubbed = scrubPublisherAndNonLegaltechExtras(extras, resultsForScrub);
  var repaired = repairMisattributedEntities(extras, scrubbed.results || resultsForScrub);
  var restored = restoreUnconfirmedNogosToQueue(extras, repaired.results || scrubbed.results || resultsForScrub);
  if (scrubbed.changed || repaired.changed || restored.changed) {
    await kvPut(env, "extras", extras);
    await kvPut(env, "results", restored.results || repaired.results || scrubbed.results || resultsForScrub);
  }

  var purgedWeak = 0;
  (extras.events || []).slice().forEach(function (ev) {
    if (!ev || String(ev.entity_note || "").indexOf("domain_unconfirmed") === -1) return;
    var rec = resultsForScrub[ev.case_id];
    if (rec && (rec.humanComplete || rec.humanOutcome)) return;
    var cleaned = storyCompanyNameOk(ev.company_name);
    if (cleaned && cleaned === String(ev.company_name || "").trim() && !isJunkIngestCompanyName(ev.company_name)) return;
    removeExtrasEventAndRelated(extras, ev.case_id, ev.company_id);
    if (resultsForScrub[ev.case_id]) delete resultsForScrub[ev.case_id];
    purgedWeak += 1;
  });
  if (purgedWeak) {
    await kvPut(env, "extras", extras);
    await kvPut(env, "results", resultsForScrub);
  }

  var recent = await searchExaResults(env, EXA_DEFAULT_QUERY, EXA_SEARCH_COUNT, 14);
  var packed = await searchExaResults(env, EXA_DEFAULT_QUERY, EXA_SEARCH_COUNT);
  if (recent && recent.ok && recent.results && recent.results.length) {
    var seenUrls = {};
    var merged = [];
    recent.results.concat((packed && packed.results) || []).forEach(function (r) {
      var url = String((r && r.url) || "").trim();
      if (!url || seenUrls[url]) return;
      seenUrls[url] = true;
      merged.push(r);
    });
    merged.sort(function (a, b) {
      return String(b.publishedDate || "").localeCompare(String(a.publishedDate || ""));
    });
    if (!packed || !packed.ok) {
      packed = recent;
    }
    packed.results = merged;
    packed.ok = true;
  }
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
  var resultsDirty = false;
  function queueNamedCompany(ident, r, freshness, sharedStory) {
    var url = String(r.url || "").trim();
    var name = storyCompanyNameOk(ident && ident.company_name);
    if (!name) {
      skipped += 1;
      skipReasons.push({
        title: String(r.title || "").slice(0, 80),
        url: url,
        publishedDate: String(r.publishedDate || ""),
        reason: "invalid_company_name",
        company_name: (ident && ident.company_name) || ""
      });
      return;
    }
    if (matchClientBookWorker(clients, name, ident.domain)) {
      skipped += 1;
      return;
    }
    var checked = runEntityCheckerGate(
      { company_name: name, domain: ident.domain || "" },
      r.title,
      r.text,
      url
    );
    var gatedName = storyCompanyNameOk(checked.company_name || name);
    if (!gatedName) {
      skipped += 1;
      skipReasons.push({
        title: String(r.title || "").slice(0, 80),
        url: url,
        publishedDate: String(r.publishedDate || ""),
        reason: "entity_checker_hold",
        fail_reasons: checked.fail_reasons || [],
        company_name: checked.company_name || name
      });
      return;
    }
    var domain = "";
    if (
      checked.ok &&
      looksLikeRealDomainWorker(checked.domain) &&
      domainMatchesCompanyWorker(gatedName, checked.domain)
    ) {
      domain = normalizeHost(checked.domain);
    } else {
      var beside = domainBesideCompanyName(gatedName, String(r.title || "") + "\n" + String(r.text || ""));
      if (beside) domain = beside;
    }
    var domainUnconfirmed = !looksLikeRealDomainWorker(domain);
    var existing = findQueuedEvent(extras, gatedName, domain, url, sharedStory);
    if (existing) {
      var existingFresh = assessExaEventFreshness(existing.event_date, now);
      if (!existingFresh.ok && String(existing.case_id || "").indexOf("CE-LX-") === 0) {
        var existingRec =
          (restored && restored.results && restored.results[existing.case_id]) ||
          (repaired && repaired.results && repaired.results[existing.case_id]) ||
          resultsForScrub[existing.case_id];
        if (mustRetainUnconfirmedNogo(existingRec, extras, existing.case_id)) {
          attachStoryToEvent(existing, r);
          attached += 1;
          return;
        }
        removeExtrasEventAndRelated(extras, existing.case_id, existing.company_id);
        purged.dropped += 1;
        existing = null;
      } else {
        attachStoryToEvent(existing, r);
        attached += 1;
        return;
      }
    }
    if (added >= EXA_MAX_NEW_PER_INGEST) {
      skipped += 1;
      skipReasons.push({
        title: String(r.title || "").slice(0, 80),
        url: url,
        publishedDate: String(r.publishedDate || ""),
        reason: "ingest_add_cap",
        company_name: gatedName
      });
      return;
    }
    var slug = slugifyTokenWorker(gatedName).toUpperCase().replace(/-/g, "").slice(0, 10) || "X";
    var stamp = Date.now().toString(36) + added;
    var caseId = "CE-LX-" + slug + "-" + stamp;
    var companyId = "CO-LX-" + slug + "-" + stamp;
    var contactId = "CT-LX-" + slug + "-" + stamp;
    var blob = String(r.title || "") + " " + String(r.text || "");
    var eventType = inferEventTypeWorker(blob);
    var summary = signalSummarySentence(gatedName, blob, eventType);
    var note = domainUnconfirmed
      ? "live_exa_refresh; domain_unconfirmed"
      : "live_exa_refresh; auto_confirmed_domain";
    var ev = {
      case_id: caseId,
      company_id: companyId,
      company_name: gatedName,
      domain: domain,
      event_type: eventType,
      event_headline: String(r.title || "").slice(0, 160),
      event_summary: summary,
      event_date: freshness.date,
      source_url: url,
      source_urls: [url],
      sector: "legaltech",
      employee_count: null,
      revenue_estimate_mm: null,
      vc_pe_backed: "yes",
      ta_headcount: null,
      entity_note: note,
      live_exa: true
    };
    extras.events.push(ev);
    upsertExtrasRow(
      extras.profiles,
      {
        company_id: companyId,
        company_name: gatedName,
        domain: domain,
        sector: "legaltech",
        employee_count: null,
        revenue_estimate_mm: null,
        vc_pe_backed: "yes",
        ta_headcount: null,
        status: "no_prior_contact",
        notes: domainUnconfirmed
          ? "Added from an Exa roundup or post. Website still needs confirm."
          : "Added via scheduled Exa ingest"
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
      company_name: gatedName,
      domain: domain,
      status: "no_prior_contact",
      last_interaction_date: "",
      partner_id: "partner_c",
      notes: domainUnconfirmed
        ? "Scheduled Exa ingest; company named in a roundup or post; domain not in the article"
        : "Scheduled Exa ingest; domain auto-confirmed"
    });
    extras.employment.push({ company_id: companyId, contact_id: contactId, works_at_company: false });
    newCaseIds.push(caseId);
    added += 1;
  }
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
    var subjects = extractCompaniesFromStory(r.title, r.text, url);
    if (!subjects.length) {
      skipped += 1;
      skipReasons.push({
        title: String(r.title || "").slice(0, 80),
        url: url,
        publishedDate: String(r.publishedDate || ""),
        reason: "no_named_company"
      });
      return;
    }
    var sharedStory = subjects.length > 1;
    subjects.forEach(function (ident) {
      queueNamedCompany(ident, r, freshness, sharedStory);
    });
  });

  await kvPut(env, "extras", extras);
  var reopened = reopenDomainResearch(resultsForScrub);
  if (resultsDirty || reopened) await kvPut(env, "results", resultsForScrub);
  // Always drain unscored pending after ingest (even if added=0), so backlog
  // from a prior failed score still clears without a partner button click.
  // Only unscored cases; decided Go/No-go/Ambiguous are never re-scored.
  var analyze = await drainPendingAutoAnalyze(env, {
    limit: 4,
    maxRounds: reopened || added ? 4 : 2
  });
  var status = {
    ok: true,
    at: now.toISOString(),
    source: source || "cron",
    stories: (packed.results || []).length,
    recent_stories: (recent && recent.results && recent.results.length) || 0,
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

function domainMatchesCompanyName(name, domain) {
  var host = normalizeHost(domain);
  if (!host) return false;
  var known = knownSubjectDomainWorker(name);
  if (known && known === host) return true;
  var slug = slugifyTokenWorker(name).replace(/-/g, "");
  if (!slug) return false;
  return host.split(".")[0].replace(/-/g, "") === slug;
}

function clearMismatchedResearch(extras, results) {
  var n = 0;
  ((extras && extras.events) || []).forEach(function (ev) {
    if (!ev || !looksLikeRealDomainWorker(ev.domain)) return;
    if (domainMatchesCompanyName(ev.company_name, ev.domain)) return;
    var rec = results && results[ev.case_id];
    if (rec && (rec.humanComplete || String(rec.humanOutcome || "").trim())) return;
    ev.domain = "";
    ev.entity_note = String(ev.entity_note || "")
      .replace(/researched_domain/g, "domain_unconfirmed")
      .replace(/auto_confirmed_domain/g, "domain_unconfirmed");
    ((extras && extras.profiles) || []).forEach(function (p) {
      if (p && p.company_id === ev.company_id) p.domain = "";
    });
    if (rec) delete results[ev.case_id];
    n += 1;
  });
  return n;
}

function reopenDomainResearch(results) {
  var n = 0;
  if (!results) return 0;
  Object.keys(results).forEach(function (id) {
    var rec = results[id];
    if (!rec) return;
    if (rec.humanComplete || String(rec.humanOutcome || "").trim()) return;
    var mode = String(rec.mode || rec.auto_analyze_mode || "");
    var hunterStatus = String(rec.hunterStatus || "");
    var why = rec.lastFields ? String(rec.lastFields.reason_or_ambiguity || "") : "";
    var skippedResearch =
      mode === "domain_unconfirmed" ||
      mode === "scrub_non_legaltech" ||
      mode === "publisher_redirect" ||
      why === "Subject company domain not confirmed" ||
      hunterStatus.indexOf("skipped_") === 0;
    if (skippedResearch) {
      delete results[id];
      n += 1;
    }
  });
  return n;
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

var SEQUENCE_DAY_OFFSETS = [0, 1, 3, 5, 7, 9, 11, 13, 15, 18, 21, 25, 29];

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

function outreachTestCase(caseId) {
  return String(caseId || "").indexOf("CE-LX-OUTREACHTEST") === 0;
}

function sequenceStartYmd(caseId, rec, authorizedAt) {
  var pinned = rec && rec.sequence_started_on;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(pinned || ""))) return String(pinned).slice(0, 10);
  return "";
}

function stepDayOffset(fields, stepNum, caseId) {
  var day = parseInt(String((fields && fields["draft_" + stepNum + "_day"]) || ""), 10);
  if (day >= 1) return outreachTestCase(caseId) ? day : day - 1;
  if (SEQUENCE_DAY_OFFSETS[stepNum - 1] != null) return SEQUENCE_DAY_OFFSETS[stepNum - 1];
  return Math.max(0, stepNum - 1);
}

function dueYmdForStep(authorizedAt, fields, stepNum, caseId, rec) {
  var pinned = sequenceStartYmd(caseId, rec, authorizedAt);
  var base = ymdPartsFromIso(pinned || authorizedAt);
  var offset = stepDayOffset(fields, stepNum, caseId);
  var due = addCalendarDaysParts(base, offset);
  // Every email, including step 1. Saturday and Sunday move to Monday.
  due = rollPartsToWeekday(due);
  return partsToYmd(due);
}

var RECIPIENT_ZONE_BY_COUNTRY = {
  "united kingdom": "Europe/London",
  uk: "Europe/London",
  brazil: "America/Sao_Paulo",
  germany: "Europe/Berlin",
  france: "Europe/Paris",
  canada: "America/Toronto",
  australia: "Australia/Sydney",
  india: "Asia/Kolkata",
  netherlands: "Europe/Amsterdam",
  ireland: "Europe/Dublin",
  sweden: "Europe/Stockholm",
  switzerland: "Europe/Zurich",
  spain: "Europe/Madrid",
  italy: "Europe/Rome",
  portugal: "Europe/Lisbon",
  japan: "Asia/Tokyo",
  singapore: "Asia/Singapore",
  mexico: "America/Mexico_City",
  argentina: "America/Argentina/Buenos_Aires",
  israel: "Asia/Jerusalem",
  china: "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  "south korea": "Asia/Seoul",
  korea: "Asia/Seoul",
  "united arab emirates": "Asia/Dubai",
  uae: "Asia/Dubai",
  "new zealand": "Pacific/Auckland",
  "south africa": "Africa/Johannesburg",
  "european union": "Europe/Paris",
  belgium: "Europe/Brussels",
  austria: "Europe/Vienna",
  denmark: "Europe/Copenhagen",
  finland: "Europe/Helsinki",
  norway: "Europe/Oslo",
  poland: "Europe/Warsaw",
  czechia: "Europe/Prague",
  taiwan: "Asia/Taipei",
  malaysia: "Asia/Kuala_Lumpur",
  indonesia: "Asia/Jakarta",
  thailand: "Asia/Bangkok",
  philippines: "Asia/Manila",
  chile: "America/Santiago",
  peru: "America/Lima",
  colombia: "America/Bogota"
};

var RECIPIENT_TLD_COUNTRY = {
  uk: "united kingdom",
  br: "brazil",
  de: "germany",
  fr: "france",
  ca: "canada",
  au: "australia",
  in: "india",
  nl: "netherlands",
  ie: "ireland",
  se: "sweden",
  ch: "switzerland",
  es: "spain",
  it: "italy",
  pt: "portugal",
  jp: "japan",
  sg: "singapore",
  nz: "new zealand",
  za: "south africa",
  mx: "mexico",
  ar: "argentina",
  be: "belgium",
  at: "austria",
  dk: "denmark",
  fi: "finland",
  no: "norway",
  pl: "poland",
  cz: "czechia",
  il: "israel",
  ae: "united arab emirates",
  kr: "south korea",
  cn: "china",
  tw: "taiwan",
  hk: "hong kong",
  my: "malaysia",
  id: "indonesia",
  th: "thailand",
  ph: "philippines",
  cl: "chile",
  pe: "peru"
};

function isKnownTimeZone(timeZone) {
  var tz = String(timeZone || "").trim();
  if (!tz || tz.toLowerCase() === "local") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

function countryFromHost(host) {
  var d = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  if (!d || d.indexOf(".") === -1) return "";
  var multi = [
    ["com.br", "brazil"],
    ["co.uk", "united kingdom"],
    ["org.uk", "united kingdom"],
    ["ac.uk", "united kingdom"],
    ["com.au", "australia"],
    ["co.nz", "new zealand"],
    ["co.jp", "japan"],
    ["co.in", "india"],
    ["com.mx", "mexico"],
    ["com.ar", "argentina"],
    ["com.sg", "singapore"],
    ["co.za", "south africa"],
    ["co.kr", "south korea"]
  ];
  for (var i = 0; i < multi.length; i++) {
    var suffix = multi[i][0];
    if (d === suffix || d.slice(-(suffix.length + 1)) === "." + suffix) return multi[i][1];
  }
  var tld = d.split(".").pop();
  var ambiguous = {
    com: 1, net: 1, org: 1, io: 1, ai: 1, app: 1, dev: 1, tech: 1, legal: 1,
    so: 1, co: 1, info: 1, biz: 1, xyz: 1, cloud: 1, online: 1
  };
  if (ambiguous[tld]) return "";
  return RECIPIENT_TLD_COUNTRY[tld] || "";
}

function zoneFromCountryName(name) {
  var key = String(name || "").trim().toLowerCase();
  return RECIPIENT_ZONE_BY_COUNTRY[key] || "";
}

function estimateRecipientTimeZone(ev, profile, fields, pocEmail) {
  var explicit = String(
    (fields && (fields.recipient_timezone || fields.timezone)) ||
      (ev && (ev.recipient_timezone || ev.timezone)) ||
      (profile && (profile.recipient_timezone || profile.timezone)) ||
      ""
  ).trim();
  if (isKnownTimeZone(explicit)) {
    return { timeZone: explicit, source: "saved", label: explicit };
  }
  var bits = [
    ev && ev.country,
    ev && ev.hq_country,
    ev && ev.hq_location,
    ev && ev.headquarters,
    ev && ev.location,
    ev && ev.company_country,
    profile && profile.country,
    profile && profile.hq_country,
    profile && profile.hq_location,
    profile && profile.headquarters,
    profile && profile.location
  ]
    .map(function (v) { return String(v || "").trim(); })
    .filter(Boolean);
  var blob = bits.join("\n");
  var usState = [
    [/\bwashington,?\s*d\.?c\.?\b|\bdistrict of columbia\b|\bnew york\b|\bboston\b|\bmiami\b|\batlanta\b|\beastern time\b/i, "America/New_York"],
    [/\bchicago\b|\billinois\b|\bdallas\b|\baustin\b|\bhouston\b|\btexas\b|\bcentral time\b/i, "America/Chicago"],
    [/\bdenver\b|\bcolorado\b|\bphoenix\b|\barizona\b|\butah\b|\bsalt lake\b|\bmountain time\b/i, "America/Denver"],
    [/\bcalifornia\b|\bsan francisco\b|\blos angeles\b|\bseattle\b|\bportland\b|\boregon\b|\bpacific time\b/i, "America/Los_Angeles"]
  ];
  for (var s = 0; s < usState.length; s++) {
    if (usState[s][0].test(blob)) {
      return { timeZone: usState[s][1], source: "headquarters", label: usState[s][1] };
    }
  }
  var countries = Object.keys(RECIPIENT_ZONE_BY_COUNTRY);
  for (var c = 0; c < countries.length; c++) {
    var country = countries[c];
    if (country.length < 3) continue;
    var re = new RegExp("\\b" + country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    if (re.test(blob)) {
      return {
        timeZone: RECIPIENT_ZONE_BY_COUNTRY[country],
        source: "headquarters",
        label: RECIPIENT_ZONE_BY_COUNTRY[country]
      };
    }
  }
  var domainCountry = countryFromHost(ev && ev.domain) || countryFromHost(profile && profile.domain) || countryFromHost(fields && fields.domain);
  if (domainCountry && zoneFromCountryName(domainCountry)) {
    var domainZone = zoneFromCountryName(domainCountry);
    return { timeZone: domainZone, source: "website", label: domainZone };
  }
  var emailHost = String(pocEmail || "").split("@")[1] || "";
  var emailCountry = countryFromHost(emailHost);
  if (emailCountry && zoneFromCountryName(emailCountry)) {
    var emailZone = zoneFromCountryName(emailCountry);
    return { timeZone: emailZone, source: "email", label: emailZone };
  }
  return { timeZone: "America/New_York", source: "us_default", label: "America/New_York" };
}

function zonedNowParts(timeZone, now) {
  var tz = isKnownTimeZone(timeZone) ? timeZone : "America/New_York";
  var fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  var map = {};
  fmt.formatToParts(now || new Date()).forEach(function (p) {
    if (p.type !== "literal") map[p.type] = p.value;
  });
  var weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var hour = Number(map.hour === "24" ? "0" : map.hour);
  return {
    weekday: weekdayMap[map.weekday],
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: hour,
    minute: Number(map.minute)
  };
}

function inRecipientMorningWindow(parts) {
  var mins = parts.hour * 60 + parts.minute;
  return mins >= 8 * 60 + 15 && mins <= 10 * 60 + 15;
}

function recipientZoneNote(zone) {
  if (!zone) return "US Eastern estimate";
  if (zone.source === "saved") return zone.label;
  if (zone.source === "headquarters") return zone.label + ", from headquarters text";
  if (zone.source === "website") return zone.label + ", from the company website";
  if (zone.source === "email") return zone.label + ", from the email address";
  return "America/New_York, US Eastern estimate because no headquarters was found";
}

function isSafeOutreachTestSend(caseId, fields) {
  if (String(caseId || "").indexOf("CE-LX-OUTREACHTEST") !== 0) return false;
  var company = String((fields && fields.company_name) || "")
    .trim()
    .toLowerCase();
  if (company !== "outreachtest") return false;
  var email = String((fields && fields.poc_email) || "")
    .trim()
    .toLowerCase();
  return email === "cryandean@gmail.com";
}

function extrasHasCase(extras, caseId) {
  var events = extras && Array.isArray(extras.events) ? extras.events : [];
  for (var i = 0; i < events.length; i++) {
    if (events[i] && events[i].case_id === caseId) return true;
  }
  return false;
}

function copyMissingById(incomingList, existingList, idKey) {
  var out = Array.isArray(incomingList) ? incomingList.slice() : [];
  var seen = {};
  out.forEach(function (row) {
    if (row && row[idKey]) seen[row[idKey]] = true;
  });
  (Array.isArray(existingList) ? existingList : []).forEach(function (row) {
    if (!row || !row[idKey] || seen[row[idKey]]) return;
    var caseId = String(row.case_id || "");
    var companyId = String(row.company_id || "");
    var contactId = String(row.contact_id || "");
    if (
      caseId.indexOf("CE-LX-OUTREACHTEST") === 0 ||
      companyId.indexOf("CO-LX-OUTREACHTEST") === 0 ||
      contactId.indexOf("CT-LX-OUTREACHTEST") === 0
    ) {
      out.push(row);
    }
  });
  return out;
}

/** A stale browser save must not erase the safe-inbox test company. */
function keepSafeOutreachTestExtras(existing, incoming) {
  var cur = existing && typeof existing === "object" ? existing : {};
  var next = incoming && typeof incoming === "object" ? incoming : {};
  if (!extrasHasCase(cur, "CE-LX-OUTREACHTEST-safemail")) return next;
  if (extrasHasCase(next, "CE-LX-OUTREACHTEST-safemail")) return next;
  next.events = copyMissingById(next.events, cur.events, "case_id");
  next.profiles = copyMissingById(next.profiles, cur.profiles, "company_id");
  next.contacts = copyMissingById(next.contacts, cur.contacts, "contact_id");
  next.employment = copyMissingById(next.employment, cur.employment, "contact_id");
  return next;
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

/** Partner checkbox on LinkedIn, phone, and SMS. Emails do not wait on this. */
function manualStepRecord(rec, stepNum) {
  var bag = rec && rec.manualCompleted;
  if (!bag || typeof bag !== "object") return null;
  var row = bag[stepNum] || bag[String(stepNum)];
  if (!row) return null;
  if (row === true) return { completed: true };
  if (row.completed || row.done) return row;
  return null;
}

function skippedManualReport(channel) {
  var ch = String(channel || "");
  if (/linkedin/i.test(ch)) return "Skipped. This LinkedIn message was not sent, and the sequence moved on.";
  if (/phone|call/i.test(ch)) return "Skipped. This call was not made, and the sequence moved on.";
  if (/sms/i.test(ch)) return "Skipped. This text was not sent, and the sequence moved on.";
  return "Skipped. This step was not done, and the sequence moved on.";
}

function stampManualUserStep(dispatch, stepNum, fields, started, doneRow) {
  var channel = stepChannel(fields, stepNum) || "Manual";
  var done = !!doneRow;
  var report = done
    ? channel + " step " + stepNum + " marked completed. Email steps keep going."
    : channel + " step " + stepNum + " is yours to send. Use Step Completed when you have done it. Email steps keep going on schedule.";
  dispatch.steps[String(stepNum)] = {
    status: done ? "manual_done" : "manual_pending",
    reason: done ? "user_completed" : "awaiting_user",
    report: report,
    channel: channel,
    schedule_ok: true,
    stopped: false,
    manual_completed: done,
    completed_at: done && doneRow.completed_at ? doneRow.completed_at : undefined,
    checked_at: started
  };
  return report;
}

function stampSkippedManualStep(dispatch, stepNum, fields, started, dueYmd) {
  var channel = stepChannel(fields, stepNum) || "Manual";
  var report = skippedManualReport(channel);
  dispatch.steps[String(stepNum)] = {
    status: "skipped_channel",
    reason: "manual_not_done",
    report: report,
    channel: channel,
    due_on: dueYmd,
    schedule_ok: true,
    stopped: false,
    manual_completed: false,
    skipped: true,
    checked_at: started
  };
  return report;
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
    var profile = null;
    var profileRows = Array.isArray(extras.profiles) ? extras.profiles : [];
    for (var pi = 0; pi < profileRows.length; pi++) {
      if (profileRows[pi] && ev.company_id && profileRows[pi].company_id === ev.company_id) {
        profile = profileRows[pi];
        break;
      }
    }
    var recipientZone = estimateRecipientTimeZone(ev, profile, fields, pocEmail);
    var localNow = zonedNowParts(recipientZone.timeZone, new Date(started));
    var localYmd = partsToYmd(localNow);

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
        // LinkedIn, phone, and SMS are done by the partner. They do not stop email steps.
        // A manual step whose day has passed, and was not marked done, is skipped.
        var doneRow = manualStepRecord(rec, stepNum);
        var manualDue = dueYmdForStep(authorizedAt, fields, stepNum, caseId, rec);
        if (!doneRow && manualDue && manualDue < localYmd) {
          stampSkippedManualStep(dispatch, stepNum, fields, started, manualDue);
        } else {
          stampManualUserStep(dispatch, stepNum, fields, started, doneRow);
        }
        dirty = true;
        summary.skipped += 1;
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

      var dueYmd = dueYmdForStep(authorizedAt, fields, stepNum, caseId, rec);
      var dayOffset = stepDayOffset(fields, stepNum, caseId);
      if (dueYmd > localYmd) {
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
      var weekend = localNow.weekday === 0 || localNow.weekday === 6;
      var morning = inRecipientMorningWindow(localNow);
      if (weekend || !morning) {
        var windowReason = weekend ? "weekend_hold" : "waiting_recipient_morning";
        var windowReport = weekend
          ? "Email " + stepNum + " does not go out on Saturday or Sunday. Next send is the next weekday between 8:15 and 10:15 (" + recipientZoneNote(recipientZone) + ")."
          : "Email " + stepNum + " waits for 8:15 to 10:15 recipient local time (" + recipientZoneNote(recipientZone) + ").";
        dispatch.steps[String(stepNum)] = {
          status: "waiting_send_window",
          reason: windowReason,
          report: windowReport,
          due_on: dueYmd,
          day_offset: dayOffset,
          channel: channel,
          recipient_timezone: recipientZone.timeZone,
          timezone_source: recipientZone.source,
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
      // The Outreachtest card may mail cryandean@gmail.com only, so a safe inbox
      // can be tested without unlocking real prospect mail.
      var safeTest = isSafeOutreachTestSend(caseId, fields);
      if ((!quality.met || !liveSendUnlocked(env)) && !safeTest) {
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
          story_extract: "new-company-cap-80",
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

export { extractCompaniesFromStory, storyCompanyNameOk };

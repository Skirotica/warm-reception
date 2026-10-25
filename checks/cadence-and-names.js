// Plain checks for the name helper and the 13-step calendar.
// Run: node checks/cadence-and-names.js

function normalizePersonName(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/annah$/, "anna");
}

function normalizeHireePhrase(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

var SEQUENCE_DAY_OFFSETS = [0, 1, 3, 5, 7, 9, 11, 13, 15, 18, 21, 25, 29];

function stepDayOffset(fields, stepNum) {
  var day = parseInt(String((fields && fields["draft_" + stepNum + "_day"]) || ""), 10);
  if (day >= 1) return day - 1;
  if (SEQUENCE_DAY_OFFSETS[stepNum - 1] != null) return SEQUENCE_DAY_OFFSETS[stepNum - 1];
  return Math.max(0, stepNum - 1);
}

function rollPartsToWeekday(parts) {
  var d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  var wd = d.getUTCDay();
  if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

var failed = 0;
function check(name, actual, expected) {
  var ok = actual === expected;
  if (!ok) {
    failed += 1;
    console.log("FAIL " + name + " got " + actual + " expected " + expected);
  }
}

check("Hannah matches Hanna", normalizePersonName("Hannah"), "hanna");
check("Hanna stays Hanna", normalizePersonName("Hanna"), "hanna");
check("letters only", normalizePersonName("Rafael B."), "rafaelb");
check("hiree keeps the space", normalizeHireePhrase("Jordan Ellis"), "jordan ellis");
check("missing email 2 uses day offset 1", stepDayOffset({}, 2), 1);
check("missing email 4 uses day offset 5", stepDayOffset({}, 4), 5);
check("stamped day 4 is offset 3", stepDayOffset({ draft_3_day: "4" }, 3), 3);
check("old 4-email fallback is not offset 3 for step 2", stepDayOffset({}, 2) === 3, false);

var saturday = rollPartsToWeekday({ year: 2026, month: 10, day: 24 });
check("Saturday rolls to Monday year", saturday.year, 2026);
check("Saturday rolls to Monday month", saturday.month, 10);
check("Saturday rolls to Monday day", saturday.day, 26);

var sunday = rollPartsToWeekday({ year: 2026, month: 10, day: 25 });
check("Sunday rolls to Monday", sunday.day, 26);

if (failed) {
  console.log(failed + " failed");
  process.exit(1);
}
console.log("cadence and name checks passed");

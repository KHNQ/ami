// Standing invariant audit (idea.md Section 10 item 8): scans every
// historical transaction and exits non-zero if any violation is found.
// GET /admin/monitoring/reports/audit-invariants exposes the same check
// over HTTP for a dashboard; this script exists so the check can also be
// run from a cron job / external monitor and actually page someone on
// failure, since nothing watches that endpoint on its own.
//
// Usage: bun run scripts/check-invariants.js
// Exit code 0 = clean, 1 = violations found (wire this into your
// scheduler's failure/alerting path).
import { reportService } from "../src/services/reportService.js";

const result = reportService.auditInvariants();
console.log(`Checked ${result.checked} transactions.`);

if (!result.ok) {
  console.error(`${result.violations.length} invariant violation(s) found:`);
  for (const v of result.violations) console.error(" ", JSON.stringify(v));
  process.exit(1);
}

console.log("All invariants hold.");

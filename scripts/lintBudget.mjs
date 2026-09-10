#!/usr/bin/env node
/**
 * Lint, against a budget that can only shrink.
 *
 * `npm run lint` reports 147 problems today, nearly all `no-explicit-any` in
 * code that predates this check. Two bad options and one good one:
 *
 *   - Gate on zero and CI is red from its first run. A permanently red build
 *     teaches everyone to ignore it, which is worse than having no CI.
 *   - Let lint fail silently and it never improves.
 *   - Freeze the current count. New problems fail the build; fixing old ones
 *     lowers the ceiling. The number is visible and only goes one way.
 *
 * Lower `BUDGET` whenever you clear some. It cannot go up without someone
 * deciding to type a bigger number here, in the same commit, with a reason.
 *
 *   node scripts/lintBudget.mjs          # check against the budget
 *   node scripts/lintBudget.mjs --report # break the budget down by rule
 *
 * Uses eslint's own API rather than spawning the CLI: the .cmd shim cannot be
 * spawned on Windows, and its bin is not exposed through the package exports.
 */

import { ESLint } from "eslint";

/** The count on 2026-09-11, when CI was introduced. Only ever lower this. */
const BUDGET = 147;

const results = await new ESLint().lintFiles(["src"]);

const errors = results.reduce((n, r) => n + r.errorCount, 0);
const warnings = results.reduce((n, r) => n + r.warningCount, 0);
const total = errors + warnings;

if (process.argv.includes("--report")) {
  const byRule = new Map();
  for (const r of results) {
    for (const m of r.messages) {
      const rule = m.ruleId ?? "(no rule)";
      byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    }
  }
  console.log("Problems by rule:");
  for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${rule}`);
  }
  console.log("");
}

console.log(`eslint: ${total} problems (${errors} errors, ${warnings} warnings), budget ${BUDGET}`);

if (total > BUDGET) {
  console.error(
    `\nThis change adds ${total - BUDGET} lint problem(s).\n` +
      `Fix them, or — if they are genuinely unavoidable — raise BUDGET in\n` +
      `scripts/lintBudget.mjs deliberately, in the same commit, with a reason.`,
  );
  process.exit(1);
}

if (total < BUDGET) {
  console.log(
    `\n${BUDGET - total} fewer than the budget. Lower BUDGET to ${total} in ` +
      `scripts/lintBudget.mjs so it cannot creep back.`,
  );
}

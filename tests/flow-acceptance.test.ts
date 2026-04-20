import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..");

function read(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/**
 * Lightweight static UX guards:
 *  - FlowStrip must NOT render an inline CTA link to the recommended step —
 *    that role belongs to the page-level NextActionBanner.
 *  - Each flow page should render at most ONE NextActionBanner at a time.
 *  - The app shell's "Start/Continue Day" button must route via the
 *    computed daily-flow step (getStepRoute), not hard-coded to /board.
 */

test("flow strip is orientation-only (no CTA button)", () => {
  const source = read("components/layout/flow-strip.tsx");
  assert.ok(
    !/href=\{hint\.ctaHref\}/.test(source),
    "flow-strip.tsx should not render a Link to hint.ctaHref",
  );
  assert.ok(
    !/\{hint\.ctaLabel\}/.test(source),
    "flow-strip.tsx should not render hint.ctaLabel as a button",
  );
});

test("app shell routes Start/Continue CTA to the computed step", () => {
  const source = read("components/layout/app-shell.tsx");
  assert.ok(
    /getStepRoute\(flow\.step\)/.test(source),
    "app-shell.tsx must derive the CTA href from getStepRoute(flow.step)",
  );
});

test("each step page imports exactly one NextActionBanner source", () => {
  const pages = [
    "app/board/page.tsx",
    "app/blocks/page.tsx",
    "app/page.tsx",
    "app/today/page.tsx",
  ];
  for (const page of pages) {
    const source = read(page);
    const imports = source.match(/from "@\/components\/layout\/next-action-banner"/g) ?? [];
    assert.equal(
      imports.length,
      1,
      `${page} must import NextActionBanner exactly once`,
    );
  }
});

test("home does not render a second 'Open focus mode' link/button next to the banner", () => {
  const source = read("app/page.tsx");
  const jsxChildMatches = source.match(/>\s*Open focus mode\s*</g) ?? [];
  assert.equal(
    jsxChildMatches.length,
    0,
    "home should let the NextActionBanner provide the 'Open focus mode' CTA, not a separate <Link>/<button>",
  );
});

test("blocks active card has exactly one primary 'Open focus mode' action", () => {
  const source = read("app/blocks/page.tsx");
  const jsxChildMatches = source.match(/>\s*Open focus mode\s*</g) ?? [];
  assert.equal(
    jsxChildMatches.length,
    1,
    "the active block card should expose one primary 'Open focus mode' CTA, not multiple",
  );
});

test("reflect page does not render a duplicate Start Day button", () => {
  const source = read("app/today/page.tsx");
  assert.ok(
    !/Start Day →/.test(source),
    "today/page.tsx should not duplicate the Start Day CTA from the banner",
  );
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The two themes define the same tokens, checked rather than remembered.
 *
 * `globals.css` declares the semantic layer twice: once on `:root` for light,
 * once on `:root[data-theme="dark"]`. Nothing in CSS makes the second list
 * complete, and an omission does not fail a build or a type check — it ships a
 * component that silently inherits the light value.
 *
 * That had already happened. The dark block was missing
 * `--color-foreground-on-primary`, so it kept the light theme's `white` while
 * `--color-primary` moved to a pale blue: white text on a light blue button, on
 * every primary action in the application. Nothing caught it, because nothing
 * was looking.
 *
 * This is a text check on a stylesheet, not a rendering test. It cannot tell
 * whether a colour is *right*; it tells you whether a colour was *chosen*.
 */

const stylesheet = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8",
);

/**
 * The stylesheet with its comments removed.
 *
 * Used by the checks that search for a construct rather than for a value. The
 * header comment explains *why* there is no `prefers-color-scheme` block, and
 * a naive substring search found those words and failed on the explanation.
 */
const code = stylesheet.replaceAll(/\/\*[\s\S]*?\*\//g, "");

/** The body of a top-level rule, by its selector. */
function blockFor(selector: string): string {
  const start = stylesheet.indexOf(`\n${selector} {`);
  expect(start, `no \`${selector}\` rule in globals.css`).toBeGreaterThan(-1);

  const end = stylesheet.indexOf("\n}", start);
  expect(end, `\`${selector}\` is never closed`).toBeGreaterThan(start);

  return stylesheet.slice(start, end);
}

/** Custom properties declared in a block, ignoring the ones only read. */
function declaredIn(block: string): ReadonlySet<string> {
  const withoutComments = block.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const declarations = withoutComments.matchAll(/^\s*(--[\w-]+)\s*:/gm);

  return new Set([...declarations].map((match) => match[1] ?? ""));
}

const LIGHT = declaredIn(blockFor(":root"));
const DARK = declaredIn(blockFor(':root[data-theme="dark"]'));

describe("the light and dark themes define the same tokens", () => {
  it("found both blocks", () => {
    // Guards against a selector rename turning this whole file into a no-op.
    expect(LIGHT.size).toBeGreaterThan(20);
    expect(DARK.size).toBeGreaterThan(20);
  });

  it.each([...LIGHT].filter((token) => token.startsWith("--color-")).sort())(
    "%s has a dark value",
    (token) => {
      expect(
        DARK.has(token),
        `${token} is declared for the light theme and not for the dark one, so dark mode ` +
          `silently inherits the light colour. Add it to :root[data-theme="dark"].`,
      ).toBe(true);
    },
  );

  it("declares no dark-only colour token", () => {
    // The reverse direction matters too: a token that exists only in dark is a
    // token no light screen can use, which is a half-finished decision.
    const darkOnly = [...DARK].filter(
      (token) => token.startsWith("--color-") && !LIGHT.has(token),
    );

    expect(darkOnly, `declared only for dark: ${darkOnly.join(", ")}`).toEqual([]);
  });

  it("restates elevation for the dark theme", () => {
    // A 5%-black shadow is invisible on a near-black page. Inheriting the light
    // values would leave every card, dialog and menu without an edge.
    expect(DARK.has("--shadow-card")).toBe(true);
    expect(DARK.has("--shadow-raised")).toBe(true);
  });

  it("sets color-scheme in both themes", () => {
    // Without it the browser renders its own widgets — <select>, the date
    // picker, the scrollbars — in the wrong scheme. This application is built
    // almost entirely from native form controls, so it is not cosmetic.
    expect(blockFor(":root")).toContain("color-scheme: light");
    expect(blockFor(':root[data-theme="dark"]')).toContain("color-scheme: dark");
  });

  it("carries no prefers-color-scheme block", () => {
    // The theme script resolves the system preference to an explicit
    // `data-theme` before first paint, so a media query here would be a second
    // copy of the dark palette — and the copy that drifts is always the one
    // nothing checks.
    expect(code).not.toContain("@media (prefers-color-scheme");
  });

  it("exposes every semantic token to Tailwind", () => {
    // `@theme inline` is what turns a custom property into a `bg-*` utility. A
    // token missing from it is a token no component can actually use.
    const bridge = code.slice(code.indexOf("@theme inline"));

    const missing = [...LIGHT]
      .filter((token) => token.startsWith("--color-"))
      .filter((token) => !bridge.includes(`${token}: var(${token})`));

    expect(missing, `not exposed as a utility: ${missing.join(", ")}`).toEqual([]);
  });
});

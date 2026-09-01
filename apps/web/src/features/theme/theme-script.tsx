/**
 * Resolves the theme before the first paint.
 *
 * A blocking inline script, deliberately. Reading the stored preference from a
 * `useEffect` would render the page light and flip it one frame later — the
 * flash that makes a dark-mode toggle feel broken. The server cannot know the
 * preference, so there is no way to avoid this from React alone.
 *
 * It resolves rather than merely restores: a stored "system", or no stored
 * value at all, is turned into an explicit `data-theme="light"` or
 * `data-theme="dark"` here. That is what lets the stylesheet carry exactly one
 * dark block instead of an attribute block and a `prefers-color-scheme` copy
 * that drift apart.
 *
 * `suppressHydrationWarning` on `<html>` covers the attribute this adds.
 *
 * The nonce comes from the middleware, which mints one per request for the
 * Content-Security-Policy. Without it this script is exactly what a strict CSP
 * blocks — and the alternative, `'unsafe-inline'`, would be a policy that looks
 * present in a header and stops nothing.
 */
const SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("leoni-theme");
    var choice = stored === "dark" || stored === "light" ? stored : null;
    var system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", choice || system);
  } catch (error) {
    // Storage or matchMedia refused. Light is the readable default for a
    // warehouse desktop, and it is what :root already declares.
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;

export interface ThemeScriptProps {
  /** Per-request CSP nonce, read from the `x-nonce` header by the layout. */
  readonly nonce: string | undefined;
}

export function ThemeScript({ nonce }: ThemeScriptProps) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The shape of a feature module, checked rather than described.
 *
 * CLAUDE.md says every feature is four files and says "copy the article
 * module". ESLint enforces the *direction* of the dependencies between those
 * files — a router may not import a repository, a service may not import
 * `@leoni/db` — but it has nothing to say about a module that simply does not
 * have them. A `request/` folder containing one 400-line `request.ts` breaks no
 * lint rule at all.
 *
 * This closes that: the layers exist, they are named consistently, and the
 * module is tested. It is a structural check only — it says nothing about
 * whether the code inside is any good.
 */

const modulesDir = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_LAYERS = ["router", "service", "repository", "mapper"] as const;

function featureModules(): string[] {
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

const MODULES = featureModules();

describe("feature module layout (CLAUDE.md section 3)", () => {
  it("finds the modules", () => {
    // Guards against a glob that silently matches nothing.
    expect(MODULES.length).toBeGreaterThan(0);
  });

  it.each(MODULES)("%s has one file per layer, named <feature>.<layer>.ts", (feature) => {
    const files = readdirSync(path.join(modulesDir, feature));

    for (const layer of REQUIRED_LAYERS) {
      expect(files, `${feature} is missing ${feature}.${layer}.ts`).toContain(
        `${feature}.${layer}.ts`,
      );
    }
  });

  it.each(MODULES)("%s has no file outside the four layers", (feature) => {
    // A fifth file is where the layering quietly stops being true — a
    // `helpers.ts` that both the router and the repository import has no
    // position in the dependency order and no rule constraining it.
    const allowed = new Set([
      ...REQUIRED_LAYERS.map((layer) => `${feature}.${layer}.ts`),
      `${feature}.service.test.ts`,
      `${feature}.mapper.test.ts`,
      `${feature}.router.test.ts`,
    ]);

    const unexpected = readdirSync(path.join(modulesDir, feature)).filter(
      (file) => !allowed.has(file),
    );

    expect(
      unexpected,
      `${feature} has files outside the four layers: ${unexpected.join(", ")}. ` +
        `Shared code belongs in src/shared/, not in a feature folder.`,
    ).toEqual([]);
  });

  it.each(MODULES)("%s tests its service", (feature) => {
    // The service is where a request becomes a decision. A module whose service
    // has no test has no test of the thing worth testing.
    const files = readdirSync(path.join(modulesDir, feature));
    expect(files, `${feature}.service.ts has no test`).toContain(`${feature}.service.test.ts`);
  });

  it.each(MODULES)("%s keeps business conditionals out of the router", (feature) => {
    // A cheap textual proxy for the rule in CLAUDE.md: "a router that contains
    // an `if` about business state is a bug". A router validates, declares a
    // permission and delegates; it has nothing to branch on.
    const router = readFileSync(path.join(modulesDir, feature, `${feature}.router.ts`), "utf8");
    const code = router
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");

    expect(code, `${feature}.router.ts branches — move the condition to the service`).not.toMatch(
      /\bif\s*\(/,
    );
  });

  it.each(MODULES)("%s declares a permission on every procedure", (feature) => {
    // An unguarded procedure is readable by anyone with a session. Every
    // procedure must be built from permissionProcedure or roleProcedure —
    // `publicProcedure` exists for the health check and the session probe, which
    // live in root.ts, not in a feature module.
    const router = readFileSync(path.join(modulesDir, feature, `${feature}.router.ts`), "utf8");

    const procedures = router.match(/\b\w+Procedure\b/g) ?? [];
    expect(procedures.length, `${feature}.router.ts declares no procedures`).toBeGreaterThan(0);

    for (const procedure of procedures) {
      expect(
        ["permissionProcedure", "roleProcedure"].includes(procedure),
        `${feature}.router.ts uses ${procedure} — a feature procedure must declare a permission`,
      ).toBe(true);
    }
  });
});

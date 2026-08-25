import { base, restrictedSyntax, restrictedSyntaxWithoutEnv } from "./base.js";

/** Plain TypeScript package: no React, no framework. */
export const library = [...base];

// Re-exported so a package config can extend the shared bans rather than
// replace them. @leoni/env needs the variant without the process.env entries.
export { restrictedSyntax, restrictedSyntaxWithoutEnv };

export default library;

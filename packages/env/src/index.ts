/**
 * `@leoni/env` — the only place in the workspace that reads `process.env`.
 *
 * The bare entry point is the **server** environment, because that is what
 * every server package wants: `import { env } from "@leoni/env"`.
 *
 * `clientEnv` is deliberately *not* re-exported here. A client component must
 * name the boundary it is crossing — `import { clientEnv } from
 * "@leoni/env/client"` — so that pulling browser-safe configuration can never
 * be a side effect of importing the server schema.
 */
export { env } from "./server";

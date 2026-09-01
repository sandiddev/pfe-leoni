/**
 * `@leoni/api` — the application layer.
 *
 * Exposes only what a host needs to serve or call the API: the router type, the
 * router itself, the context factory and the direct caller. The feature modules
 * are internal; reaching into them from the web app would couple the UI to the
 * service layer, which a lint rule forbids.
 */
export { type Actor, type Context, type CreateContextOptions, createContext } from "./context";
export { type NightlyResult, runNightlyMaintenance } from "./jobs/nightly";
export { type AppRouter, appRouter, createCaller } from "./root";

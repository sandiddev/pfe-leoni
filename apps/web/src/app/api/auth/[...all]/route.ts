/**
 * better-auth mounts its whole surface — sign in, sign out, session — under
 * this one catch-all route. The handlers come from @leoni/auth, which owns the
 * configuration; nothing else in the application handles credentials.
 */
export { GET, POST } from "@leoni/auth/next";

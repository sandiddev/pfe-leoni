import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "./server";

/**
 * The Next.js route handlers for authentication.
 *
 * Exported from here rather than assembled in the web app so that `better-auth`
 * stays a dependency of this package alone. The app mounts what it is given and
 * never has the auth library — or the ability to reconfigure it — in reach.
 */
export const { GET, POST } = toNextJsHandler(auth);

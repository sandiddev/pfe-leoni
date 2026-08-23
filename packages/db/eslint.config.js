import { library } from "@leoni/eslint-config/library";

export default [
  ...library,
  // The Prisma client is emitted code, not authored code.
  { ignores: ["src/generated/**"] },
];

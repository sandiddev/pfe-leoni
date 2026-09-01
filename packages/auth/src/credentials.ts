import { hashPassword } from "better-auth/crypto";
import { createLocalAccountIssuer } from "better-auth/db";

/**
 * Provisioning a password for an account the Administrator creates.
 *
 * This lives in `@leoni/auth` rather than in the API module that calls it,
 * because the exact shape of a credential row is better-auth's business, not
 * the application's. Sign-in matches on all three of `providerId`, `issuer` and
 * `accountId` together: getting any one of them wrong produces a row that looks
 * correct in Adminer and fails authentication, which is a bad afternoon. The
 * seed already learned that (`packages/db/src/seed.ts`), and this is the same
 * knowledge in one reusable place instead of two copies.
 *
 * Sign-up stays disabled. Accounts are provisioned by an Administrator, never
 * self-served — this is the mechanism for that, not a way around it.
 */

/** Characters a password is generated from, minus the ones people misread. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const GENERATED_LENGTH = 14;

/**
 * A temporary password the Administrator reads out once.
 *
 * `O`/`0` and `l`/`1` are excluded: this gets dictated over the phone or copied
 * off a screen, and a password nobody can transcribe is a support call.
 *
 * `crypto.getRandomValues` rather than `Math.random`, and the modulo bias is
 * avoided by rejecting the tail of the byte range rather than ignoring it.
 */
export function generatePassword(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  const characters: string[] = [];

  while (characters.length < GENERATED_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_LENGTH));

    for (const byte of bytes) {
      if (byte >= limit) continue;
      characters.push(ALPHABET.charAt(byte % ALPHABET.length));
      if (characters.length === GENERATED_LENGTH) break;
    }
  }

  return characters.join("");
}

/** Everything an `Account` row needs for a password sign-in to succeed. */
export interface CredentialAccount {
  readonly providerId: string;
  readonly issuer: string;
  readonly accountId: string;
  readonly password: string;
}

export async function buildCredentialAccount(
  userId: string,
  password: string,
): Promise<CredentialAccount> {
  return {
    providerId: "credential",
    issuer: createLocalAccountIssuer("credential"),
    // For a credential account this is the user's own id: that is how the
    // stored password is linked back to the user.
    accountId: userId,
    password: await hashPassword(password),
  };
}

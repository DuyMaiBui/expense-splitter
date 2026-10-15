import { obj, str } from "./validate";

/**
 * Admin-only helpers: the password re-issue payload and the temporary password generator.
 * Kept free of database and framework imports so both are unit-testable.
 */

// No 0/O/1/I/l: the password is read off a screen and typed on a phone.
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export const TEMP_PASSWORD_LENGTH = 12;

/** A random password from the alphabet above, drawn without modulo bias (~68 bits). */
export function generateTempPassword(): string {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let result = "";

  while (result.length < TEMP_PASSWORD_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(TEMP_PASSWORD_LENGTH * 2))) {
      if (byte < limit && result.length < TEMP_PASSWORD_LENGTH) {
        result += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      }
    }
  }
  return result;
}

/** `password` is optional: absent or empty means "generate one". Same bounds as registration. */
export function parseResetBody(raw: unknown): { password?: string } {
  const body = obj(raw, "body");
  if (body.password === undefined || body.password === "") {
    return {};
  }
  // Never trimmed: leading and trailing spaces are part of a password.
  return { password: str(body.password, "password", { min: 6, max: 128, trim: false }) };
}

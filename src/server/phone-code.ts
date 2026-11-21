import { createHash } from "node:crypto";

/** Crockford's base 32: no I, L, O or U to misread. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A short code for a phone, such as "7F3K", that admins see next to a name
 * so two "Lee family" claims can be told apart (spec section 6). It comes
 * from the phone's ID one way: the ID, which works like a password, can't be
 * worked back out of it.
 */
export function phoneCode(phoneId: string): string {
  const digest = createHash("sha256").update(`lost-and-found phone code:${phoneId}`).digest();
  let bits = (digest[0] << 12) | (digest[1] << 4) | (digest[2] >> 4);
  let code = "";
  for (let i = 0; i < 4; i++) {
    code = ALPHABET[bits & 31] + code;
    bits >>= 5;
  }
  return code;
}

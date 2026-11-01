import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";

const TOTP_DIGITS = 6;

/** What an authenticator app shows for a key typed in by hand. */
export async function authenticatorCode(manualKey: string): Promise<string> {
  const secret = new TextDecoder().decode(base32.decode(manualKey));
  return createOTP(secret, { digits: TOTP_DIGITS }).totp();
}

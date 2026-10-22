/**
 * Better Auth's route for checking an authenticator code. During enrolment it
 * is also where the authenticator gets switched on, which is how both apps
 * spot an enrolment finishing.
 */
export const VERIFY_CODE_PATH = "/two-factor/verify-totp";

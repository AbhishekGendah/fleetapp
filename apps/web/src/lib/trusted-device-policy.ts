/**
 * "Remember this device": no authenticator code on it for this many days
 * (docs/design/01). Its own module, with nothing server-only in it, because
 * the sign-in page words the tick box from it.
 */
export const TRUSTED_DEVICE_DAYS = 14;

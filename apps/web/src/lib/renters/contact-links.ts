/**
 * Links that open the phone's own app to call, text or email a Renter (the
 * look's "tap to call, text or email", 6 Nov 2026). Phones are kept as
 * typed with spaces ("0491 570 006"); the link takes the digits only.
 */

function phoneDigits(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export function callHref(phone: string): string {
  return `tel:${phoneDigits(phone)}`;
}

export function textHref(phone: string): string {
  return `sms:${phoneDigits(phone)}`;
}

export function emailHref(email: string): string {
  return `mailto:${email}`;
}

/**
 * The demo data tool fills a business with made-up cars, Renters and
 * rentals for testing. It must never run where real Renters are, so it needs
 * two separate signs of a test site: not the production stage, and email
 * kept in the test inbox (which the app already refuses in production).
 */
export function isDemoDataAllowedFor(settings: {
  APP_STAGE?: string | undefined;
  EMAIL_TRANSPORT: string;
}): boolean {
  return settings.APP_STAGE !== "production" && settings.EMAIL_TRANSPORT === "dev_outbox";
}

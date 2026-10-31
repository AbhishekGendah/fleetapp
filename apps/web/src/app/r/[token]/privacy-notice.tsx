import { BRAND } from "@fleetapp/ui/brand";

/**
 * The collection notice (APP 5), naming the Operator as the one collecting.
 * Wording to be checked by the lawyer before real Renters get links.
 */
export function PrivacyNotice(props: { operatorName: string }) {
  const { operatorName } = props;
  return (
    <section
      aria-label="Privacy"
      className="bg-muted text-muted-foreground flex flex-col gap-2 rounded-lg p-3 text-sm"
    >
      <p className="text-foreground font-semibold">About your information</p>
      <p>
        {operatorName} collects these details to rent you a car, to deal with tolls, fines and
        damage, and to contact you. Without them, {operatorName} may not be able to rent to you.
      </p>
      <p>
        They are seen by {operatorName}, by {BRAND.productName} (the system {operatorName} uses),
        and by government agencies for fines and tolls. Some services used are overseas: emails are
        sent by a service in the USA, which sees your name and email address, and the address search
        uses Google, which sees what you type in the address box.
      </p>
      <p>
        {operatorName}&rsquo;s privacy policy says how to see or correct what they hold about you,
        and how to complain.
      </p>
    </section>
  );
}

import {
  privacyNoticeFor,
  type PrivacyNoticeBusiness,
  type PrivacyNoticePlace,
} from "@fleetapp/core";
import { BRAND } from "@fleetapp/ui/brand";

const POLICY_LINK_TEXT = "Read the privacy policy";

/**
 * The Renter's privacy notice (APP 5), in the one wording every Renter page
 * uses (packages/core privacy-notice).
 */
export function RenterPrivacyNotice(props: {
  business: PrivacyNoticeBusiness;
  place: PrivacyNoticePlace;
  /** For a driver: the businesses they drive for, so it says what those see. */
  drivesFor?: readonly string[];
}) {
  const notice = privacyNoticeFor(props.business, BRAND.productName, props.place, props.drivesFor);
  return (
    <section
      aria-label="Privacy"
      className="bg-muted text-muted-foreground flex flex-col gap-2 rounded-lg p-3 text-sm"
    >
      <p className="text-foreground font-semibold">{notice.title}</p>
      {notice.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <ul className="list-disc pl-5">
        {notice.services.map((service) => (
          <li key={service}>{service}</li>
        ))}
      </ul>
      <p>{notice.policyText}</p>
      {notice.policyUrl ? (
        <p>
          <a
            href={notice.policyUrl}
            target="_blank"
            rel="noopener"
            className="text-teal hover:text-primary font-semibold"
          >
            {POLICY_LINK_TEXT}
          </a>
        </p>
      ) : null}
      {notice.contact ? <p>{notice.contact}</p> : null}
    </section>
  );
}

/**
 * The short form, for a Renter signing on the business's phone: where the
 * business's privacy policy is, or to ask for it.
 */
export function RenterPrivacyLine(props: { business: PrivacyNoticeBusiness }) {
  const { name, privacyPolicyUrl } = props.business;
  return (
    <p className="text-muted-foreground text-sm">
      {name} keeps what is recorded here, and the signature, with the rental.{" "}
      {privacyPolicyUrl ? (
        <a
          href={privacyPolicyUrl}
          target="_blank"
          rel="noopener"
          className="text-teal hover:text-primary font-semibold"
        >
          How {name} looks after your information
        </a>
      ) : (
        <>Ask {name} for its privacy policy to see how it looks after your information.</>
      )}
    </p>
  );
}

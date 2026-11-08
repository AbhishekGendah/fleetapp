import { todayInTimeZone } from "@fleetapp/core";
import { BRAND } from "@fleetapp/ui/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import type { RenterLinkPurpose } from "@fleetapp/core";

import { appDb } from "../../../lib/app-db";
import { detailsFormStart } from "../../../lib/renter-links/details-form-input";
import { isPhoneRemembered, openLink, wasLinkUsed } from "../../../lib/renter-links/link-visits";
import { STRIPE_RETURN_STEPS } from "../../../lib/payments/renter-checkout";
import { loadFormStart } from "../../../lib/renter-links/submissions";
import { checkCodeAction, sendCodeAction } from "./actions";
import { RenterPrivacyNotice } from "../../../components/renter-privacy-notice";
import { loadDrivesForNames } from "../../../lib/renters/organisation-driver-queries";
import { loadNoticeBusiness } from "../../../lib/privacy/notice-business";
import { CodeStep } from "./code-step";
import { DetailsForm } from "./details-form";
import { ForgetDraft } from "./forget-draft";
import { DEVICE_COOKIE } from "./link-state";
import { SentThanks } from "./sent-thanks";
import { BACK_FROM_STRIPE_PARAM } from "./payments-return";
import { PaymentsStep } from "./payments-step";
import { SigningStep } from "./signing-step";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never listed by search engines; the headers in next.config say the same. */
export const metadata: Metadata = {
  title: "Your rental link",
  robots: { index: false, follow: false },
};

const PAGE_TITLES: Readonly<Record<RenterLinkPurpose, string>> = {
  details_form: "Your details form",
  sign_contract: "Your rental contract",
  sign_change: "A change to your rental",
  set_up_payments: "Your payments",
};

function LinkPage(props: {
  operatorName?: string;
  title: string;
  /** The privacy notice, at the top of every page that collects something (APP 5). */
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      {props.operatorName ? (
        <p className="text-primary text-center text-xl font-extrabold">{props.operatorName}</p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {props.notice}
          {props.children}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-center text-xs">Sent using {BRAND.productName}</p>
    </main>
  );
}

/**
 * A Renter's link (rule 26). No one is signed in: the secret in the address
 * finds the link. A phone it has not seen must type an emailed code first,
 * and until then nothing about the Renter is shown.
 */
export default async function RenterLinkPage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const visit = await openLink(appDb, token);
  if (!visit && (await wasLinkUsed(appDb, token))) {
    return (
      <LinkPage title="This is already signed">
        <CardDescription>
          Nothing more is needed from you on this link. If you need a copy, ask the business that
          sent it.
        </CardDescription>
      </LinkPage>
    );
  }
  if (!visit) {
    return (
      <LinkPage title="This link no longer works">
        <CardDescription>
          It may have expired, or been replaced by a newer one. Ask the business that sent it to
          send you a new link.
        </CardDescription>
      </LinkPage>
    );
  }
  if (visit.isLocked) {
    return (
      <LinkPage operatorName={visit.operatorName} title="This link is locked">
        <CardDescription>
          A code was typed wrongly too many times. Ask {visit.operatorName} to send you a new link.
        </CardDescription>
      </LinkPage>
    );
  }
  const deviceToken = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!(await isPhoneRemembered(appDb, visit, deviceToken))) {
    return (
      <LinkPage operatorName={visit.operatorName} title={PAGE_TITLES[visit.purpose]}>
        <CodeStep
          maskedEmail={visit.maskedEmail}
          sendCode={sendCodeAction.bind(null, token)}
          checkCode={checkCodeAction.bind(null, token)}
        />
      </LinkPage>
    );
  }
  const business = await loadNoticeBusiness(appDb, visit.operatorId);
  if (visit.purpose === "set_up_payments") {
    return (
      <LinkPage
        operatorName={visit.operatorName}
        title={PAGE_TITLES.set_up_payments}
        notice={<RenterPrivacyNotice business={business} place="payments" />}
      >
        <PaymentsStep
          token={token}
          visit={visit}
          isBackFromStripe={searchParams[BACK_FROM_STRIPE_PARAM] === STRIPE_RETURN_STEPS.finished}
        />
      </LinkPage>
    );
  }
  if (visit.purpose === "sign_contract" || visit.purpose === "sign_change") {
    return (
      <LinkPage
        operatorName={visit.operatorName}
        title={PAGE_TITLES[visit.purpose]}
        notice={<RenterPrivacyNotice business={business} place="signing" />}
      >
        <SigningStep token={token} visit={visit} />
      </LinkPage>
    );
  }
  const [start, drivesFor] = await Promise.all([
    loadFormStart(appDb, visit),
    loadDrivesForNames(appDb, visit.operatorId, visit.renterId),
  ]);
  return (
    <LinkPage
      operatorName={visit.operatorName}
      title={PAGE_TITLES.details_form}
      notice={<RenterPrivacyNotice business={business} place="details" drivesFor={drivesFor} />}
    >
      {start.status === "waiting" ? (
        <>
          <SentThanks operatorName={visit.operatorName} />
          <ForgetDraft linkId={visit.linkId} />
        </>
      ) : (
        <DetailsForm
          token={token}
          linkId={visit.linkId}
          operatorName={visit.operatorName}
          today={todayInTimeZone(new Date(), visit.timeZone)}
          expiresAt={visit.expiresAt.toISOString()}
          initialValues={detailsFormStart(start.values)}
          photos={start.photos}
          sentBackNote={start.sentBackNote}
        />
      )}
    </LinkPage>
  );
}

import { todayInTimeZone } from "@fleetapp/core";
import { BRAND } from "@fleetapp/ui/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { appDb } from "../../../lib/app-db";
import { detailsFormStart } from "../../../lib/renter-links/details-form-input";
import { isPhoneRemembered, openLink } from "../../../lib/renter-links/link-visits";
import { loadFormStart } from "../../../lib/renter-links/submissions";
import { checkCodeAction, sendCodeAction } from "./actions";
import { CodeStep } from "./code-step";
import { DetailsForm } from "./details-form";
import { DEVICE_COOKIE } from "./link-state";
import { SentThanks } from "./sent-thanks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never listed by search engines; the headers in next.config say the same. */
export const metadata: Metadata = {
  title: "Your details form",
  robots: { index: false, follow: false },
};

function LinkPage(props: { operatorName?: string; title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      {props.operatorName ? (
        <p className="text-primary text-center text-xl font-extrabold">{props.operatorName}</p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{props.children}</CardContent>
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
export default async function RenterLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const visit = await openLink(appDb, token);
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
      <LinkPage operatorName={visit.operatorName} title="Your details form">
        <CodeStep
          maskedEmail={visit.maskedEmail}
          sendCode={sendCodeAction.bind(null, token)}
          checkCode={checkCodeAction.bind(null, token)}
        />
      </LinkPage>
    );
  }
  const start = await loadFormStart(appDb, visit);
  return (
    <LinkPage operatorName={visit.operatorName} title="Your details form">
      {start.status === "waiting" ? (
        <SentThanks operatorName={visit.operatorName} />
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

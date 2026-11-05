import { render } from "@react-email/components";
import { createElement, type ReactElement } from "react";

import type { EmailAttachment, EmailMessage } from "./email-sender";
import {
  NewDeviceSignInEmail,
  type NewDeviceSignInEmailProps,
} from "./templates/new-device-sign-in";
import { PasswordChangedEmail, type PasswordChangedEmailProps } from "./templates/password-changed";
import {
  NightlyRunAlertEmail,
  type NightlyRunAlertEmailProps,
} from "./templates/nightly-run-alert";
import { OperatorInviteEmail, type OperatorInviteEmailProps } from "./templates/operator-invite";
import { PasswordResetEmail, type PasswordResetEmailProps } from "./templates/password-reset";
import {
  RenterDetailsLinkEmail,
  type RenterDetailsLinkEmailProps,
} from "./templates/renter-details-link";
import {
  RenterDetailsSentBackEmail,
  type RenterDetailsSentBackEmailProps,
} from "./templates/renter-details-sent-back";
import { RenterLinkCodeEmail, type RenterLinkCodeEmailProps } from "./templates/renter-link-code";
import {
  RenterPaymentsLinkEmail,
  type RenterPaymentsLinkEmailProps,
} from "./templates/renter-payments-link";
import {
  RenterSigningLinkEmail,
  type RenterSigningLinkEmailProps,
} from "./templates/renter-signing-link";
import {
  BillingDocumentEmail,
  billingDocumentName,
  type BillingDocumentEmailProps,
} from "./templates/billing-document";
import {
  DocumentCopyEmail,
  type CopiedDocumentKind,
  type DocumentCopyEmailProps,
} from "./templates/document-copy";

/** Turns one template into the HTML and plain-text versions email clients need. */
async function renderEmail(
  to: string,
  subject: string,
  email: ReactElement,
): Promise<EmailMessage> {
  return {
    to,
    subject,
    html: await render(email),
    text: await render(email, { plainText: true }),
  };
}

type WithRecipient<Props> = Props & { to: string };

export function renderOperatorInviteEmail(
  input: WithRecipient<OperatorInviteEmailProps>,
): Promise<EmailMessage> {
  const { to, ...props } = input;
  return renderEmail(
    to,
    `Set up your login for ${props.operatorName}`,
    createElement(OperatorInviteEmail, props),
  );
}

export function renderPasswordResetEmail(
  input: WithRecipient<PasswordResetEmailProps>,
): Promise<EmailMessage> {
  const { to, ...props } = input;
  return renderEmail(to, "Reset your password", createElement(PasswordResetEmail, props));
}

export function renderNewDeviceSignInEmail(
  input: WithRecipient<NewDeviceSignInEmailProps>,
): Promise<EmailMessage> {
  const { to, ...props } = input;
  return renderEmail(to, "New sign-in to your account", createElement(NewDeviceSignInEmail, props));
}

export function renderPasswordChangedEmail(
  input: WithRecipient<PasswordChangedEmailProps>,
): Promise<EmailMessage> {
  const { to, ...props } = input;
  return renderEmail(to, "Your password was changed", createElement(PasswordChangedEmail, props));
}

/** To AGS, when the nightly run did not finish cleanly (review G3-4). */
export function renderNightlyRunAlertEmail(
  input: WithRecipient<NightlyRunAlertEmailProps>,
): Promise<EmailMessage> {
  const { to, ...props } = input;
  return renderEmail(
    to,
    "The nightly run had a problem",
    createElement(NightlyRunAlertEmail, props),
  );
}

/** From the Operator's business, replies to the Operator: the Renter deals with them, not with AGS. */
type FromOperator<Props> = WithRecipient<Props> & { operatorName: string; replyTo?: string };

async function fromOperator(
  message: Promise<EmailMessage>,
  operatorName: string,
  replyTo: string | undefined,
): Promise<EmailMessage> {
  return { ...(await message), fromName: operatorName, replyTo };
}

export function renderRenterDetailsLinkEmail(
  input: FromOperator<RenterDetailsLinkEmailProps>,
): Promise<EmailMessage> {
  const { to, replyTo, ...props } = input;
  return fromOperator(
    renderEmail(
      to,
      `Your details form from ${props.operatorName}`,
      createElement(RenterDetailsLinkEmail, props),
    ),
    props.operatorName,
    replyTo,
  );
}

export function renderRenterLinkCodeEmail(
  input: FromOperator<RenterLinkCodeEmailProps>,
): Promise<EmailMessage> {
  const { to, replyTo, ...props } = input;
  return fromOperator(
    // Not the code itself: subjects show on lock screens and in mail logs.
    renderEmail(
      to,
      `Your code for ${props.operatorName}`,
      createElement(RenterLinkCodeEmail, props),
    ),
    props.operatorName,
    replyTo,
  );
}

export function renderRenterDetailsSentBackEmail(
  input: FromOperator<RenterDetailsSentBackEmailProps>,
): Promise<EmailMessage> {
  const { to, replyTo, ...props } = input;
  return fromOperator(
    renderEmail(
      to,
      `${props.operatorName} asked you to change your details`,
      createElement(RenterDetailsSentBackEmail, props),
    ),
    props.operatorName,
    replyTo,
  );
}

export function renderRenterSigningLinkEmail(
  input: FromOperator<RenterSigningLinkEmailProps>,
): Promise<EmailMessage> {
  const { to, replyTo, ...props } = input;
  return fromOperator(
    renderEmail(
      to,
      props.document === "change_of_terms"
        ? `A change to your rental from ${props.operatorName}`
        : `Your rental contract from ${props.operatorName}`,
      createElement(RenterSigningLinkEmail, props),
    ),
    props.operatorName,
    replyTo,
  );
}

export function renderRenterPaymentsLinkEmail(
  input: FromOperator<RenterPaymentsLinkEmailProps>,
): Promise<EmailMessage> {
  const { to, replyTo, ...props } = input;
  return fromOperator(
    renderEmail(
      to,
      `Set up your payments for ${props.operatorName}`,
      createElement(RenterPaymentsLinkEmail, props),
    ),
    props.operatorName,
    replyTo,
  );
}

const COPY_SUBJECTS: Readonly<
  Record<CopiedDocumentKind, { renter: (operatorName: string) => string; operator: string }>
> = {
  contract: {
    renter: (operatorName) => `Your signed rental contract with ${operatorName}`,
    operator: "Contract signed",
  },
  handover_report: {
    renter: (operatorName) => `Your car handover report from ${operatorName}`,
    operator: "Car handed over",
  },
  return_report: {
    renter: (operatorName) => `Your car return report from ${operatorName}`,
    operator: "Car returned",
  },
  change_of_terms: {
    renter: (operatorName) => `Your signed change of terms with ${operatorName}`,
    operator: "Change of terms signed",
  },
  swap_form: {
    renter: (operatorName) => `Your car swap with ${operatorName}`,
    operator: "Car swapped",
  },
};

/**
 * A copy of a fixed document, attached (a signed contract, a handover
 * report): to the Renter from the business (replies go to the business), or
 * to the business itself.
 */
export async function renderDocumentCopyEmail(
  input: WithRecipient<DocumentCopyEmailProps> & {
    replyTo?: string;
    attachment: EmailAttachment;
  },
): Promise<EmailMessage> {
  const { to, replyTo, attachment, ...props } = input;
  const isForRenter = props.audience === "renter";
  const subjects = COPY_SUBJECTS[props.kind];
  const message = await renderEmail(
    to,
    isForRenter
      ? subjects.renter(props.operatorName)
      : `${subjects.operator}: ${props.renterName}, ${props.rentalSummary}`,
    createElement(DocumentCopyEmail, props),
  );
  const withFile = { ...message, attachments: [attachment] };
  return isForRenter
    ? fromOperator(Promise.resolve(withFile), props.operatorName, replyTo)
    : withFile;
}

/**
 * An invoice, credit note, receipt or statement, attached: to the Renter from
 * the business (replies go to the business).
 */
export async function renderBillingDocumentEmail(
  input: WithRecipient<BillingDocumentEmailProps> & {
    replyTo?: string;
    attachment: EmailAttachment;
  },
): Promise<EmailMessage> {
  const { to, replyTo, attachment, ...props } = input;
  const message = await renderEmail(
    to,
    `${billingDocumentName(props)} from ${props.operatorName}`,
    createElement(BillingDocumentEmail, props),
  );
  return fromOperator(
    Promise.resolve({ ...message, attachments: [attachment] }),
    props.operatorName,
    replyTo,
  );
}

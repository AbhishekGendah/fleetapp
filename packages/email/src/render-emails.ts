import { render } from "@react-email/components";
import { createElement, type ReactElement } from "react";

import type { EmailMessage } from "./email-sender";
import {
  NewDeviceSignInEmail,
  type NewDeviceSignInEmailProps,
} from "./templates/new-device-sign-in";
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
    renderEmail(to, `Your code: ${props.code}`, createElement(RenterLinkCodeEmail, props)),
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

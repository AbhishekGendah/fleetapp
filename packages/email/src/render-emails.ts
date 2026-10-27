import { render } from "@react-email/components";
import { createElement, type ReactElement } from "react";

import type { EmailMessage } from "./email-sender";
import {
  NewDeviceSignInEmail,
  type NewDeviceSignInEmailProps,
} from "./templates/new-device-sign-in";
import { OperatorInviteEmail, type OperatorInviteEmailProps } from "./templates/operator-invite";
import { PasswordResetEmail, type PasswordResetEmailProps } from "./templates/password-reset";

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

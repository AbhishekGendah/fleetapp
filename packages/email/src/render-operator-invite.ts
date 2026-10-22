import { render } from "@react-email/components";
import { createElement } from "react";

import type { EmailMessage } from "./email-sender";
import { OperatorInviteEmail, type OperatorInviteEmailProps } from "./templates/operator-invite";

export interface OperatorInviteMessageInput extends OperatorInviteEmailProps {
  to: string;
}

export async function renderOperatorInviteEmail(
  input: OperatorInviteMessageInput,
): Promise<EmailMessage> {
  const { to, ...props } = input;
  const email = createElement(OperatorInviteEmail, props);

  return {
    to,
    subject: `Set up your login for ${props.operatorName}`,
    html: await render(email),
    text: await render(email, { plainText: true }),
  };
}

import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailButton, EmailLayout, SmallPrint } from "./email-layout";

export interface PasswordChangedEmailProps {
  name: string;
  /** Where to start a fresh reset, if it wasn't them. */
  resetPasswordUrl: string;
}

/** Sent after every password reset, so a change the owner didn't make is seen (review A2-1). */
export function PasswordChangedEmail(props: PasswordChangedEmailProps): ReactElement {
  return (
    <EmailLayout preview="Your password was changed" heading="Your password was changed">
      <Text>Hi {props.name},</Text>
      <Text>
        The password for your login was just changed, and every device it was signed in on was
        signed out.
      </Text>
      <Text>If this was you, there is nothing to do.</Text>
      <Text>If it was not, reset your password now and contact us:</Text>
      <EmailButton href={props.resetPasswordUrl}>Reset my password</EmailButton>
      <SmallPrint>We will never ask you for your password or authenticator codes.</SmallPrint>
    </EmailLayout>
  );
}

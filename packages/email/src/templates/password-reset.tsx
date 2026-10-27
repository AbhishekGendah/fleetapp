import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailButton, EmailLayout, SmallPrint } from "./email-layout";

export interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
  /** How long the link works, already worded, e.g. "1 hour". */
  validFor: string;
}

export function PasswordResetEmail(props: PasswordResetEmailProps): ReactElement {
  return (
    <EmailLayout preview="Reset your password" heading="Reset your password">
      <Text>Hi {props.name},</Text>
      <Text>
        Someone asked to reset the password for your login. If it was you, choose a new one:
      </Text>
      <EmailButton href={props.resetUrl}>Choose a new password</EmailButton>
      <SmallPrint>
        This link works for {props.validFor} and can only be used once. You will still need your
        authenticator app to sign in.
      </SmallPrint>
      <SmallPrint>
        If you did not ask for this, ignore this email. Your password stays as it is.
      </SmallPrint>
    </EmailLayout>
  );
}

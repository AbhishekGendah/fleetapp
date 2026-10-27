import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailButton, EmailLayout, SmallPrint } from "./email-layout";

export interface NewDeviceSignInEmailProps {
  name: string;
  /** Already formatted in the Operator's timezone. */
  signedInAt: string;
  /** E.g. "Chrome on Windows". */
  deviceDescription: string;
  resetPasswordUrl: string;
}

export function NewDeviceSignInEmail(props: NewDeviceSignInEmailProps): ReactElement {
  return (
    <EmailLayout preview="New sign-in to your account" heading="New sign-in to your account">
      <Text>Hi {props.name},</Text>
      <Text>Your login was just used to sign in from a device it has not been used on before:</Text>
      <Text>
        {props.deviceDescription}
        <br />
        {props.signedInAt}
      </Text>
      <Text>If this was you, there is nothing to do.</Text>
      <Text>If it was not, change your password now:</Text>
      <EmailButton href={props.resetPasswordUrl}>Change my password</EmailButton>
      <SmallPrint>
        Whoever it was also had a code from your authenticator app, or a recovery code. If you did
        not sign in, contact us as well.
      </SmallPrint>
    </EmailLayout>
  );
}

import { INVITE_LIFETIME_DAYS } from "@fleetapp/core";
import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailButton, EmailLayout, SmallPrint } from "./email-layout";

export interface OperatorInviteEmailProps {
  inviteeName: string;
  operatorName: string;
  acceptUrl: string;
}

export function OperatorInviteEmail(props: OperatorInviteEmailProps): ReactElement {
  return (
    <EmailLayout
      preview={`Set up your login for ${props.operatorName}`}
      heading="Set up your login"
    >
      <Text>Hi {props.inviteeName},</Text>
      <Text>
        An account has been created for {props.operatorName}. Choose a password and set up an
        authenticator app to start using it.
      </Text>
      <EmailButton href={props.acceptUrl}>Set up my login</EmailButton>
      <SmallPrint>
        This link works for {INVITE_LIFETIME_DAYS} days and can only be used once. If it has
        expired, ask for a new one.
      </SmallPrint>
      <SmallPrint>If you were not expecting this email, you can ignore it.</SmallPrint>
    </EmailLayout>
  );
}

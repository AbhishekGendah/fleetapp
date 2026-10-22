import { INVITE_LIFETIME_DAYS } from "@fleetapp/core";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import type { ReactElement } from "react";

export interface OperatorInviteEmailProps {
  inviteeName: string;
  operatorName: string;
  acceptUrl: string;
}

// Inline styles: most email clients ignore stylesheets.
const bodyStyle = { backgroundColor: "#f6f7f9", fontFamily: "Arial, sans-serif" };
const containerStyle = {
  backgroundColor: "#ffffff",
  margin: "24px auto",
  maxWidth: "480px",
  padding: "32px 24px",
};
const buttonStyle = {
  backgroundColor: "#111827",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  padding: "12px 20px",
  textDecoration: "none",
};
const smallTextStyle = { color: "#6b7280", fontSize: "13px" };

export function OperatorInviteEmail(props: OperatorInviteEmailProps): ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>Set up your login for {props.operatorName}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading as="h1">Set up your login</Heading>
          <Text>Hi {props.inviteeName},</Text>
          <Text>
            An account has been created for {props.operatorName}. Choose a password and set up an
            authenticator app to start using it.
          </Text>
          <Button href={props.acceptUrl} style={buttonStyle}>
            Set up my login
          </Button>
          <Text style={smallTextStyle}>
            This link works for {INVITE_LIFETIME_DAYS} days and can only be used once. If it has
            expired, ask for a new one.
          </Text>
          <Text style={smallTextStyle}>
            If you were not expecting this email, you can ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

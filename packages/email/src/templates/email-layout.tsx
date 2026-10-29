import { AUSTRALIAN_LOCALE } from "@fleetapp/core";
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
import { BRAND } from "@fleetapp/ui/brand";
import type { ReactElement, ReactNode } from "react";

// Inline styles: most email clients ignore stylesheets.
const bodyStyle = { backgroundColor: BRAND.colours.page, fontFamily: "Arial, sans-serif" };
const containerStyle = {
  backgroundColor: "#ffffff",
  margin: "24px auto",
  maxWidth: "480px",
  padding: "32px 24px",
};
const brandStyle = { color: BRAND.colours.primary, fontSize: "18px", fontWeight: 700 };
const buttonStyle = {
  backgroundColor: BRAND.colours.primary,
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  padding: "12px 20px",
  textDecoration: "none",
};
const smallTextStyle = { color: BRAND.colours.mutedText, fontSize: "13px" };

/** The frame every email shares: a heading, the body, and small print. */
export function EmailLayout(props: {
  preview: string;
  heading: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Html lang={AUSTRALIAN_LOCALE}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={brandStyle}>{BRAND.productName}</Text>
          <Heading as="h1">{props.heading}</Heading>
          {props.children}
        </Container>
      </Body>
    </Html>
  );
}

export function EmailButton(props: { href: string; children: ReactNode }): ReactElement {
  return (
    <Button href={props.href} style={buttonStyle}>
      {props.children}
    </Button>
  );
}

export function SmallPrint(props: { children: ReactNode }): ReactElement {
  return <Text style={smallTextStyle}>{props.children}</Text>;
}

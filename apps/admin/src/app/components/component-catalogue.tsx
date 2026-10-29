"use client";

import { formatAbn, formatAustralianPhone } from "@fleetapp/core";
import { BRAND } from "@fleetapp/ui/brand";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { CodeInput, TOTP_CODE_LENGTH } from "@fleetapp/ui/code-input";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { Logo, LogoMark } from "@fleetapp/ui/logo";
import { Select } from "@fleetapp/ui/select";
import { useState } from "react";

import { ADMIN_LABEL } from "../admin-label";

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const EXAMPLE_ERROR_ID = "example-error";

function CatalogueSection(props: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.note ? <CardDescription>{props.note}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{props.children}</CardContent>
    </Card>
  );
}

function ColourSwatches() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Object.entries(BRAND.colours).map(([name, hex]) => (
        <div key={name} className="flex items-center gap-2 text-xs">
          <span className="size-8 shrink-0 rounded-md border" style={{ backgroundColor: hex }} />
          <span>
            <span className="block font-medium">{name}</span>
            <span className="text-muted-foreground">{hex}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function FormPieces() {
  const [phone, setPhone] = useState("");
  const [abn, setAbn] = useState("");
  const [isTicked, setIsTicked] = useState(true);
  return (
    <>
      <RequiredFieldsNote />
      <FormField htmlFor="example-name" label="A required box" isRequired hint="A hint goes here.">
        <Input id="example-name" aria-required />
      </FormField>
      <FormField htmlFor="example-optional" label="An optional box">
        <Input id="example-optional" />
      </FormField>
      <FormField
        htmlFor="example-error"
        label="A box with a problem"
        isRequired
        error="This is what a problem looks like."
      >
        <Input
          id="example-error"
          aria-required
          aria-invalid
          aria-describedby={fieldErrorId(EXAMPLE_ERROR_ID)}
        />
      </FormField>
      <FormField htmlFor="example-phone" label="Formats as you type (phone)">
        <FormattedInput
          id="example-phone"
          type="tel"
          placeholder="0412 345 678"
          value={phone}
          format={formatAustralianPhone}
          onValueChange={setPhone}
        />
      </FormField>
      <FormField htmlFor="example-abn" label="Formats as you type (ABN)">
        <FormattedInput
          id="example-abn"
          inputMode="numeric"
          placeholder="51 824 753 556"
          value={abn}
          format={formatAbn}
          onValueChange={setAbn}
        />
      </FormField>
      <FormField htmlFor="example-select" label="A dropdown">
        <Select id="example-select" defaultValue="">
          <option value="">Choose…</option>
          <option value="one">One</option>
          <option value="two">Two</option>
        </Select>
      </FormField>
      <Checkbox
        label="A tick box"
        checked={isTicked}
        onChange={(event) => setIsTicked(event.target.checked)}
      />
      <FormError message="A problem with the whole form shows here." />
    </>
  );
}

function CodeEntry() {
  const [code, setCode] = useState("");
  return (
    <FormField htmlFor="example-code" label={`A ${TOTP_CODE_LENGTH}-digit code`} isRequired>
      <CodeInput
        id="example-code"
        name="code"
        length={TOTP_CODE_LENGTH}
        value={code}
        onChange={setCode}
      />
    </FormField>
  );
}

/** Each shared piece, shown as it is used. */
export function ComponentCatalogue() {
  return (
    <div className="flex flex-col gap-4">
      <CatalogueSection
        title="Brand"
        note="Name, logo and colours come from packages/ui/src/brand.ts."
      >
        <div className="flex flex-wrap items-center gap-6">
          <Logo />
          <Logo label={ADMIN_LABEL} />
          <LogoMark className="h-8" />
        </div>
        <ColourSwatches />
      </CatalogueSection>

      <CatalogueSection title="Text">
        <h1 className="text-primary text-2xl font-extrabold">Page heading</h1>
        <h2 className="text-primary text-base font-semibold">Section heading</h2>
        <p className="text-sm">Body text, as on every screen.</p>
        <p className="text-muted-foreground text-xs">Hints and secondary text.</p>
        <p className="text-teal text-sm">Success and links.</p>
        <p className="text-attention text-sm">Needs attention, but nothing is wrong.</p>
        <p className="text-destructive text-sm">Something is wrong.</p>
      </CatalogueSection>

      <CatalogueSection
        title="Buttons"
        note="44px tall, the smallest comfortable touch target (rule 24)."
      >
        <div className="flex flex-wrap gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button disabled>disabled</Button>
        </div>
      </CatalogueSection>

      <CatalogueSection
        title="Forms"
        note="Required boxes carry a red asterisk; problems show once a box is left (rule 28)."
      >
        <FormPieces />
      </CatalogueSection>

      <CatalogueSection title="Code entry" note="Checked as soon as the last digit goes in.">
        <CodeEntry />
      </CatalogueSection>
    </div>
  );
}

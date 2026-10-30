"use client";

import {
  AUSTRALIAN_LOCALE,
  formatAbn,
  formatAustralianPhone,
  pageOfRows,
  parseListQuery,
  type InMemoryListRules,
} from "@fleetapp/core";
import { BRAND } from "@fleetapp/ui/brand";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { ComboBox } from "@fleetapp/ui/combo-box";
import { CodeInput, TOTP_CODE_LENGTH } from "@fleetapp/ui/code-input";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { DataList, type DataListDefinition } from "@fleetapp/ui/data-list";
import { ImageUpload } from "@fleetapp/ui/image-upload";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { InstallAppHintCard } from "@fleetapp/ui/install-app-hint";
import { Logo, LogoMark } from "@fleetapp/ui/logo";
import { Select } from "@fleetapp/ui/select";
import { Textarea } from "@fleetapp/ui/textarea";
import { TabLinks } from "@fleetapp/ui/tab-links";
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
  const [money, setMoney] = useState("");
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
      <FormField htmlFor="example-money" label="Formats as you type (dollars)">
        <MoneyInput id="example-money" value={money} onValueChange={setMoney} />
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

/** A few makes, with a nickname, to try the matching on. */
const EXAMPLE_MAKES = [
  { name: "BYD", aliases: [] },
  { name: "Mercedes-Benz", aliases: ["Merc", "Benz"] },
  { name: "Toyota", aliases: [] },
  { name: "Volkswagen", aliases: ["VW"] },
];

/** Suggests from a list as you type, ignoring spaces and capitals; anything else can still be typed. */
function ComboBoxExample() {
  const [make, setMake] = useState("");
  return (
    <FormField
      htmlFor="example-make"
      label="Make"
      hint="Try “toy”, “toyta”, “vw” or a make that is not listed."
    >
      <ComboBox id="example-make" options={EXAMPLE_MAKES} value={make} onValueChange={setMake} />
    </FormField>
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

/** Shows the chosen image as if it had been saved, without sending it anywhere. */
function ImageUploadExample() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  return (
    <ImageUpload
      id="example-image"
      label="An image"
      hint="Shrunk on the device before it is sent. Nothing is uploaded from this page."
      currentImageUrl={imageUrl}
      accept="image/png,image/jpeg,image/webp"
      onUpload={async (image) => {
        setImageUrl(URL.createObjectURL(image));
        return null;
      }}
      onRemove={async () => setImageUrl(null)}
    />
  );
}

interface ExampleCar {
  rego: string;
  model: string;
  odometer: number;
}

const EXAMPLE_CARS: ExampleCar[] = [
  { rego: "1ABC234", model: "Toyota Camry Hybrid", odometer: 48210 },
  { rego: "1XYZ987", model: "Kia Niro", odometer: 12650 },
  { rego: "1DEF456", model: "Hyundai Ioniq", odometer: 90310 },
];

const EXAMPLE_LIST: DataListDefinition<ExampleCar> = {
  columns: [
    {
      key: "rego",
      label: "Rego",
      isCardTitle: true,
      isSortable: true,
      exportValue: (car) => car.rego,
    },
    { key: "model", label: "Model", exportValue: (car) => car.model },
    {
      key: "odometer",
      label: "Odometer",
      isSortable: true,
      exportValue: (car) => car.odometer,
      render: (car) => `${car.odometer.toLocaleString(AUSTRALIAN_LOCALE)} km`,
    },
  ],
  filters: [],
  defaultSort: { column: "rego", direction: "asc" },
};

const EXAMPLE_RULES: InMemoryListRules<ExampleCar> = {
  searchText: (car) => `${car.rego} ${car.model}`,
  sortValues: { rego: (car) => car.rego, odometer: (car) => car.odometer },
  filterMatches: {},
};

/** The shared list with made-up cars. Sorting and searching here reload the page. */
function DataListExample() {
  const query = parseListQuery(EXAMPLE_LIST, {});
  return (
    <DataList
      definition={EXAMPLE_LIST}
      page={pageOfRows(EXAMPLE_CARS, EXAMPLE_RULES, query)}
      query={query}
      basePath=""
      rowKey={(car) => car.rego}
      itemName={{ one: "car", many: "cars" }}
      searchLabel="Search by rego or model"
      emptyMessage="No cars match."
    />
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

      <CatalogueSection title="Badges" note="A short label on a record, such as its status.">
        <div className="flex flex-wrap gap-2">
          <Badge tone="good">Available</Badge>
          <Badge tone="attention">In service</Badge>
          <Badge tone="danger">Suspended</Badge>
          <Badge>Archived</Badge>
        </div>
      </CatalogueSection>

      <CatalogueSection
        title="Tabs"
        note="Sections of one record, each with its own address. Scrolls sideways on a narrow phone."
      >
        <TabLinks
          label="Example sections"
          tabs={[
            { href: "#details", label: "Details", isCurrent: true },
            { href: "#odometer", label: "Odometer", isCurrent: false },
            { href: "#log", label: "Log", isCurrent: false },
          ]}
        />
      </CatalogueSection>

      <CatalogueSection
        title="Several lines"
        note="For lists typed one per line, e.g. adding several car models at once."
      >
        <FormField htmlFor="example-lines" label="Models, one per line">
          <Textarea id="example-lines" placeholder={"Sealion 6\nSealion 7"} />
        </FormField>
      </CatalogueSection>

      <CatalogueSection
        title="Searchable box"
        note="Suggests from a list as you type, and still takes anything typed. Used for car makes and models."
      >
        <ComboBoxExample />
      </CatalogueSection>

      <CatalogueSection
        title="Lists"
        note="Every list: a table on a wide screen, cards on a phone, with sort, search, filters, pages and export."
      >
        <DataListExample />
      </CatalogueSection>

      <CatalogueSection
        title="Image upload"
        note="Choose, replace or remove one image, e.g. the Operator's logo."
      >
        <ImageUploadExample />
      </CatalogueSection>

      <CatalogueSection title="Code entry" note="Checked as soon as the last digit goes in.">
        <CodeEntry />
      </CatalogueSection>

      <CatalogueSection
        title="Install guide"
        note="Operator app only, on a phone that has not added it to the home screen. Android gets an Install button; iPhones get the Share menu steps."
      >
        <InstallAppHintCard kind="prompt" onInstall={() => undefined} onDismiss={() => undefined} />
        <InstallAppHintCard kind="apple" onDismiss={() => undefined} />
      </CatalogueSection>
    </div>
  );
}

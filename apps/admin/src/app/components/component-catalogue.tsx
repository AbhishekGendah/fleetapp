"use client";

import {
  AUSTRALIAN_LOCALE,
  MERGE_FIELD_GROUP_LABELS,
  MERGE_FIELDS,
  STARTER_CONTRACT,
  CAR_AREAS,
  fillMergeFields,
  type ContractData,
  templateDocumentSchema,
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
import { BookingsCalendar, type CalendarEntry } from "@fleetapp/ui/bookings-calendar";
import { Drawer } from "@fleetapp/ui/drawer";
import { FleetTimeline, type TimelineBar } from "@fleetapp/ui/fleet-timeline";
import { MultiRecordPicker } from "@fleetapp/ui/multi-record-picker";
import { QrCode } from "@fleetapp/ui/qr-code";
import { ToggleGroup } from "@fleetapp/ui/toggle-group";
import { ComboBox } from "@fleetapp/ui/combo-box";
import { CodeInput, TOTP_CODE_LENGTH } from "@fleetapp/ui/code-input";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { CameraCapture } from "@fleetapp/ui/camera-capture";
import { ContractEditor, type EditorMergeField } from "@fleetapp/ui/contract-editor";
import { ContractReader } from "@fleetapp/ui/contract-reader";
import { SignaturePad } from "@fleetapp/ui/signature-pad";
import { CarAreaSelect, CarOutline, type CarOutlineMark } from "@fleetapp/ui/car-outline";
import { DateTimePicker } from "@fleetapp/ui/date-time-picker";
import { RecordPicker, type PickableRecord } from "@fleetapp/ui/record-picker";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { SuggestionBox } from "@fleetapp/ui/suggestion-box";
import { DataList, type DataListDefinition } from "@fleetapp/ui/data-list";
import { ImageUpload } from "@fleetapp/ui/image-upload";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { InstallAppHintCard } from "@fleetapp/ui/install-app-hint";
import { Logo, LogoMark } from "@fleetapp/ui/logo";
import { Select } from "@fleetapp/ui/select";
import { Textarea } from "@fleetapp/ui/textarea";
import { TabLinks } from "@fleetapp/ui/tab-links";
import { CountLinks } from "@fleetapp/ui/count-links";
import { ImageViewer, ImageViewerOpener } from "@fleetapp/ui/image-viewer";
import { PageHeader } from "@fleetapp/ui/page-header";
import { ProblemPanel } from "@fleetapp/ui/problem-panel";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Camera, Gauge, History, Paperclip, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ADMIN_LABEL } from "../admin-label";

const BUTTON_VARIANTS = [
  "default",
  "danger",
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

/** Made-up addresses, as a lookup would return them, to try the suggestion box on. */
const EXAMPLE_ADDRESSES = [
  { id: "1", street: "1 Example Street", area: "Perth WA" },
  { id: "2", street: "1 Example Road", area: "Fremantle WA" },
  { id: "3", street: "10 Sample Avenue", area: "Subiaco WA" },
] as const;

/** The box an address lookup uses: free text, with suggestions from a lookup under it. */
function SuggestionBoxExample() {
  const [address, setAddress] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const typed = address.trim().toLowerCase();
  const suggestions =
    isSuggesting && typed.length > 0
      ? EXAMPLE_ADDRESSES.filter((example) => example.street.toLowerCase().startsWith(typed))
      : [];
  return (
    <FormField
      htmlFor="example-address"
      label="Street address"
      hint="Try “1 ex”. Picking one fills it in; anything else can be typed."
    >
      <SuggestionBox
        id="example-address"
        value={address}
        onValueChange={(value) => {
          setIsSuggesting(true);
          setAddress(value);
        }}
        suggestions={suggestions}
        suggestionKey={(example) => example.id}
        renderSuggestion={(example) => (
          <>
            <span className="font-medium">{example.street}</span>
            <span className="text-muted-foreground text-xs">{example.area}</span>
          </>
        )}
        onSuggestionChosen={(example) => {
          setIsSuggesting(false);
          setAddress(example.street);
        }}
        onDismiss={() => setIsSuggesting(false)}
        footer={<p className="text-muted-foreground border-t px-3 py-2 text-xs">Example lookup</p>}
      />
    </FormField>
  );
}

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

/** Typed part by part, or picked from the calendar; the form gets "2026-12-01T09:00". */
function DateTimePickerExample() {
  const [moment, setMoment] = useState("2026-12-01T09:00");
  return (
    <FormField htmlFor="example-start" label="Starts" isRequired hint={`Sent as “${moment}”.`}>
      <DateTimePicker
        id="example-start"
        name="start"
        value={moment}
        onValueChange={setMoment}
        aria-required
      />
    </FormField>
  );
}

const EXAMPLE_RENTERS: readonly PickableRecord[] = [
  { value: "renter-1", label: "Sam Example", description: "0412 345 678" },
  { value: "renter-2", label: "Alex Sample", description: "alex@example.test" },
  { value: "renter-3", label: "Jo Citizen", description: "0498 765 432" },
];

const EXAMPLE_PICKABLE_CARS: readonly PickableRecord[] = [
  { value: "car-1", label: "1ABC234", description: "Toyota Corolla · Rented" },
  { value: "car-2", label: "1XYZ789", description: "Hyundai Ioniq · Available" },
  { value: "car-3", label: "1DEF456", description: "Kia Niro · In service" },
];

const EXAMPLE_SHOW_OPTIONS = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "out", label: "Out" },
] as const;

function MultiRecordPickerExample() {
  const [carIds, setCarIds] = useState<string[]>([]);
  return (
    <FormField htmlFor="example-cars" label="Cars" hint="Choose one or several.">
      <MultiRecordPicker
        id="example-cars"
        records={EXAMPLE_PICKABLE_CARS}
        values={carIds}
        onValuesChange={setCarIds}
        placeholder="Type a rego"
        emptyMessage="No car matches that."
      />
    </FormField>
  );
}

function ToggleGroupExample() {
  const [shown, setShown] = useState<(typeof EXAMPLE_SHOW_OPTIONS)[number]["value"]>("all");
  return (
    <ToggleGroup
      label="Show cars"
      options={EXAMPLE_SHOW_OPTIONS}
      value={shown}
      onValueChange={setShown}
    />
  );
}

function DrawerExample() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        Open a panel
      </Button>
      <Drawer isOpen={isOpen} onOpenChange={setIsOpen} title="1ABC234">
        <p>Toyota Corolla 2024 · Rented to Sam Example since 3 Nov.</p>
      </Drawer>
    </>
  );
}

/** Only a listed record can be picked; the form sends its id. */
function RecordPickerExample() {
  const [renterId, setRenterId] = useState("");
  return (
    <FormField
      htmlFor="example-renter"
      label="Renter"
      isRequired
      hint={renterId ? `Sends “${renterId}”.` : "Try “sam” or “0498”."}
    >
      <RecordPicker
        id="example-renter"
        name="renterId"
        records={EXAMPLE_RENTERS}
        value={renterId}
        onValueChange={setRenterId}
        placeholder="Type a name, phone or email"
        emptyMessage="No Renter matches that."
        aria-required
      />
    </FormField>
  );
}

const EXAMPLE_BOOKINGS: readonly CalendarEntry[] = [
  {
    id: "booking-1",
    title: "1ABC234 · Sam Example",
    start: "2026-12-01T01:00:00Z",
    end: "2026-12-15T01:00:00Z",
    href: "#booking-1",
    tone: "active",
  },
  {
    id: "booking-2",
    title: "1XYZ789 · Alex Sample",
    start: "2026-12-08T02:00:00Z",
    end: "2026-12-22T02:00:00Z",
    href: "#booking-2",
    tone: "booked",
  },
];

const EXAMPLE_TIMELINE_ROWS = [
  { id: "car-1", label: "1ABC234" },
  { id: "car-2", label: "1XYZ789" },
  { id: "car-3", label: "1DEF456" },
];

const EXAMPLE_TIMELINE_BARS: readonly TimelineBar[] = [
  {
    id: "bar-1",
    rowId: "car-1",
    title: "Sam Example",
    when: "30 Nov 2026, 9:00 am ongoing",
    start: "2026-11-30T09:00:00",
    end: "2026-12-28T00:00:00",
    href: "#bar-1",
    tone: "active",
  },
  {
    id: "bar-2",
    rowId: "car-2",
    title: "Alex Sample",
    when: "8 Dec 2026, 10:00 am to 15 Dec 2026, 10:00 am",
    start: "2026-12-08T10:00:00",
    end: "2026-12-15T10:00:00",
    href: "#bar-2",
    tone: "booked",
  },
];

const EXAMPLE_TIMELINE_SCROLL = { date: "2026-11-30", request: 0 };

const EDITOR_FIELDS: readonly EditorMergeField[] = MERGE_FIELDS.map((field) => ({
  key: field.key,
  label: field.label,
  groupLabel: MERGE_FIELD_GROUP_LABELS[field.group],
}));

/** The contract editor, saying whether what it holds is a template the server would accept. */
function ContractEditorExample() {
  const [json, setJson] = useState(() => JSON.stringify(STARTER_CONTRACT));
  const isAccepted = templateDocumentSchema.safeParse(JSON.parse(json)).success;
  return (
    <FormField
      htmlFor="example-contract"
      label="Contract text"
      hint={isAccepted ? "The server would accept this." : "The server would refuse this."}
    >
      <ContractEditor
        id="example-contract"
        name="content"
        initialContent={STARTER_CONTRACT}
        onValueChange={setJson}
        fields={EDITOR_FIELDS}
      />
    </FormField>
  );
}

/** Each field filled with its own name, so the example reads like a real contract. */
const EXAMPLE_CONTRACT_DATA = Object.fromEntries(
  MERGE_FIELDS.map((field) => [field.key, field.label]),
) as ContractData;

function SignaturePadExample() {
  const [drawing, setDrawing] = useState("");
  return (
    <FormField
      htmlFor="example-signature"
      label="Signature"
      hint={
        drawing === ""
          ? "Nothing drawn yet."
          : `Drawn: ${drawing.length.toLocaleString(AUSTRALIAN_LOCALE)} characters of PNG.`
      }
    >
      <SignaturePad id="example-signature" name="drawnSignature" onValueChange={setDrawing} />
    </FormField>
  );
}

/** The car outline: tap to mark, or choose the area from the list, as the handover does. */
/** At a return, the handover's damage shows greyed, lettered rather than numbered. */
const EXAMPLE_HANDOVER_MARK: CarOutlineMark = {
  id: "handover-a",
  x: 330,
  y: 520,
  label: "Already there at handover, A: scratch on left doors",
  badge: "A",
  tone: "existing",
};

function CarOutlineExample() {
  const [marks, setMarks] = useState<CarOutlineMark[]>([]);
  const [area, setArea] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  function addMark(x: number, y: number, where: string): void {
    setMarks((previous) => [
      ...previous,
      { id: `mark-${previous.length + 1}`, x, y, label: `Damage ${previous.length + 1}: ${where}` },
    ]);
  }
  function handleAreaChosen(picked: (typeof CAR_AREAS)[number] | null): void {
    setArea("");
    if (picked) {
      addMark(picked.x, picked.y, picked.label);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <CarOutline
        label="Car outline: tap where the damage is"
        marks={[EXAMPLE_HANDOVER_MARK, ...marks]}
        onPlace={({ x, y }) => addMark(x, y, "tapped")}
        onSelectMark={setChosen}
      />
      <FormField htmlFor="example-car-area" label="Or choose where on the car">
        <CarAreaSelect id="example-car-area" value={area} onAreaChosen={handleAreaChosen} />
      </FormField>
      <p className="text-muted-foreground text-sm" role="status">
        {marks.length} marked{chosen ? `, ${chosen} chosen` : ""}.
      </p>
    </div>
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
      rowHref={(car) => `#${car.rego}`}
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
        <div className="flex flex-wrap gap-3">
          <Button>
            <Plus aria-hidden />
            Main action with an icon
          </Button>
          <Button variant="outline">
            <Paperclip aria-hidden />
            Attach
          </Button>
          <Button variant="danger">
            <Trash2 aria-hidden />
            Remove
          </Button>
          <Button variant="danger" size="icon" aria-label="Remove (icon only)">
            <Trash2 aria-hidden />
          </Button>
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
        note="Sections of one record, each with its own address. Icon tiles on a phone, pills on a computer; switching does not add to the back history."
      >
        <TabLinks
          label="Example sections"
          tabs={[
            { href: "#photos", label: "Photos", isCurrent: true, icon: <Camera aria-hidden /> },
            { href: "#odometer", label: "Odometer", isCurrent: false, icon: <Gauge aria-hidden /> },
            { href: "#log", label: "Log", isCurrent: false, icon: <History aria-hidden /> },
          ]}
        />
      </CatalogueSection>

      <CatalogueSection
        title="Count links"
        note="Counts that open the list behind them, e.g. cars by status. They wrap on a phone; the one showing is filled in."
      >
        <CountLinks
          label="Example cars by status"
          links={[
            { href: "#all", label: "All", count: 107, isCurrent: true },
            { href: "#rented", label: "Rented", count: 72 },
            { href: "#available", label: "Available", count: 9 },
            { href: "#in-service", label: "In service", count: 14 },
          ]}
        />
      </CatalogueSection>

      <CatalogueSection
        title="Page header"
        note="Every page below a main section: a back arrow one level up, and the title. Stays at the top on a phone."
      >
        <PageHeader backHref="#" backLabel="Cars" title="1ABC234" aside={<Badge>Sold</Badge>} />
      </CatalogueSection>

      <CatalogueSection
        title="Problem panel"
        note="A whole page when something could not be shown: an error (with Try again) or a page that does not exist."
      >
        <ProblemPanel
          title="That didn't load"
          message="Check your connection and try again."
          actions={<Button>Try again</Button>}
        />
      </CatalogueSection>

      <CatalogueSection
        title="Record cards"
        note="Each record on a card as its own small card: title, amount, details, then its buttons."
      >
        <RecordList label="Example records">
          <RecordItem
            title="WA · 12 months"
            amount="$912.50"
            details={<p>to 10 Nov 2027 · paid 8 Nov 2026</p>}
            actions={
              <Button variant="danger">
                <Trash2 aria-hidden />
                Remove renewal
              </Button>
            }
          />
        </RecordList>
      </CatalogueSection>

      <CatalogueSection
        title="Image viewer"
        note="Photos open full screen in the app. ✕, Escape or the phone's back button closes it; swipe or arrows move."
      >
        <ImageViewer
          images={[
            { src: "/icon.svg", label: "Example 001" },
            { src: "/icon.svg", label: "Example 002" },
          ]}
        >
          <div className="flex gap-2">
            <ImageViewerOpener index={0} label="Open Example 001" className="border p-3">
              Example 001
            </ImageViewerOpener>
            <ImageViewerOpener index={1} label="Open Example 002" className="border p-3">
              Example 002
            </ImageViewerOpener>
          </div>
        </ImageViewer>
      </CatalogueSection>

      <CatalogueSection
        title="Pop-up form"
        note="An Add or Edit button that opens its form in a pop-up: full screen on a phone. Saving closes it."
      >
        <FormDialog triggerLabel="Add an example" title="An example pop-up">
          <FormField htmlFor="example-dialog-box" label="A box inside">
            <Input id="example-dialog-box" />
          </FormField>
        </FormDialog>
      </CatalogueSection>

      <CatalogueSection
        title="Choose files"
        note="Opens the camera and gallery on a phone. Used for car photos and documents."
      >
        <FilePicker
          label="Add photos"
          accept="image/*"
          isMultiple
          onFilesChosen={() => undefined}
        />
        <CameraCapture triggerLabel="Take photos" onPhotosTaken={() => undefined} />
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
        title="Suggestion box"
        note="For a lookup such as an address: free text, suggestions from the lookup under it, a credit line at the foot."
      >
        <SuggestionBoxExample />
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

      <CatalogueSection
        title="Date and time"
        note="Typed part by part in Australian order, or picked from a calendar. Times are on the Operator's clock."
      >
        <DateTimePickerExample />
      </CatalogueSection>

      <CatalogueSection
        title="Record picker"
        note="Picks one record, such as a Renter or a car, by typing part of it. Only listed records can be picked."
      >
        <RecordPickerExample />
      </CatalogueSection>

      <CatalogueSection
        title="Contract editor"
        note="Headings, lists, bold, italic and underline, with Insert field for the rental's details. Nothing else can be added, so it always prints tidily."
      >
        <ContractEditorExample />
      </CatalogueSection>

      <CatalogueSection
        title="Contract reader"
        note="A filled contract as plain page text, for the Renter to read in full before signing. Rendered on the server, so it adds nothing to the download."
      >
        <ContractReader
          label="Example contract"
          content={fillMergeFields(STARTER_CONTRACT, EXAMPLE_CONTRACT_DATA)}
        />
      </CatalogueSection>

      <CatalogueSection
        title="Car outline"
        note="Damage at handover and return: tap the drawing, or choose the area from the list. Each mark is a numbered button; at a return, damage already there at handover is greyed and lettered."
      >
        <CarOutlineExample />
      </CatalogueSection>

      <CatalogueSection
        title="Signature pad"
        note="Sign with a finger, pen or mouse. Always offered next to typing a name, for anyone who cannot draw."
      >
        <SignaturePadExample />
      </CatalogueSection>

      <CatalogueSection
        title="Bookings calendar"
        note="A month grid on a computer, a list on a phone. Each booking opens its rental."
      >
        <BookingsCalendar
          entries={EXAMPLE_BOOKINGS}
          timeZone="Australia/Perth"
          initialDate="2026-12-01"
        />
      </CatalogueSection>

      <CatalogueSection
        title="Several records"
        note="Picks several, e.g. the cars to show. Each chosen one is a chip with a remove button."
      >
        <MultiRecordPickerExample />
      </CatalogueSection>

      <CatalogueSection
        title="Choice buttons"
        note="One of a few values; the chosen one stays pressed. Arrow keys move between them."
      >
        <ToggleGroupExample />
      </CatalogueSection>

      <CatalogueSection
        title="Slide-in panel"
        note="Up from the bottom on a phone, in from the right on a computer. Swipe, Escape or Close shuts it."
      >
        <DrawerExample />
      </CatalogueSection>

      <CatalogueSection
        title="Fleet timeline"
        note="One row per car, days across, each booking a bar that opens its rental. Swipe sideways on a phone."
      >
        <FleetTimeline
          rows={EXAMPLE_TIMELINE_ROWS}
          bars={EXAMPLE_TIMELINE_BARS}
          startDate="2026-11-30"
          days={28}
          today="2026-12-02"
          zoom="days"
          scrollTarget={EXAMPLE_TIMELINE_SCROLL}
        />
      </CatalogueSection>

      <CatalogueSection
        title="QR code"
        note="For a phone to scan: an authenticator app's setup, or a Renter's link shown at pickup."
      >
        <QrCode
          value="https://example.test/r/a-made-up-link"
          label="QR code for the example link"
        />
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

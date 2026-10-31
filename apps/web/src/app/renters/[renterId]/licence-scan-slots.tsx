"use client";

import {
  FILE_PURPOSE_RULES,
  LICENCE_SIDE_LABELS,
  LICENCE_SIDES,
  type LicenceSide,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { FormError } from "@fleetapp/ui/form-message";
import { ImageViewer } from "@fleetapp/ui/image-viewer";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sendPaper } from "../../../lib/files/send-paper";
import { licenceScanPath } from "../../../lib/paths";
import { FileLink, isPdf } from "../../../components/file-link";
import { PhotoOrFileButtons } from "../../../components/photo-or-file-buttons";
import {
  finishLicenceScanUploadAction,
  removeLicenceScanAction,
  startLicenceScanUploadAction,
} from "./licence-actions";

const SCAN_RULE = FILE_PURPOSE_RULES.renter_licence_scan;

/** One side's scan in use, as shown: never the scan itself until View is pressed. */
export interface ScanSummary {
  id: string;
  contentType: string;
  /** Already in the Operator's words, e.g. "31 Oct 2026, 9:15 am". */
  addedText: string;
  /** When the retention timer will delete it, in the Operator's words. */
  keptUntilText: string;
}

function ScanSlot(props: {
  renterId: string;
  side: LicenceSide;
  scan: ScanSummary | null;
  imageIndex: number;
  isEditable: boolean;
  /** Set when the slot is empty because the retention timer deleted the last scan. */
  deletedByTimerText: string | null;
}) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { renterId, side, scan } = props;
  const sideLabel = LICENCE_SIDE_LABELS[side];

  async function handleChosen(file: File): Promise<void> {
    setIsSending(true);
    setMessage(null);
    setMessage(
      await sendPaper(
        file,
        (planned) => startLicenceScanUploadAction({ renterId, side, ...planned }),
        finishLicenceScanUploadAction,
      ),
    );
    setIsSending(false);
    router.refresh();
  }

  return (
    <li className="bg-background flex flex-col gap-3 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{sideLabel}</p>
        <p className="text-muted-foreground text-sm">
          {isSending ? "Sending…" : scan ? `Added ${scan.addedText}` : "Not added yet"}
        </p>
      </div>
      {scan ? (
        <p className="text-muted-foreground text-sm">
          Kept until about {scan.keptUntilText}, then deleted automatically.
        </p>
      ) : null}
      {!scan && props.deletedByTimerText ? (
        <p className="text-muted-foreground text-sm">{props.deletedByTimerText}</p>
      ) : null}
      {scan ? (
        <div className="flex items-center gap-2">
          <FileLink
            href={licenceScanPath(renterId, scan.id)}
            label={`View ${sideLabel.toLowerCase()}`}
            contentType={scan.contentType}
            imageIndex={props.imageIndex}
          />
          {props.isEditable ? (
            <ActionButton
              action={removeLicenceScanAction.bind(null, renterId, scan.id)}
              label={`Remove the ${sideLabel.toLowerCase()} scan`}
              pendingLabel="Removing…"
              variant="danger"
              icon={<Trash2 aria-hidden />}
              isIconOnly
            />
          ) : null}
        </div>
      ) : null}
      {props.isEditable ? (
        <PhotoOrFileButtons
          hasFile={scan !== null}
          isSending={isSending}
          accept={SCAN_RULE.contentTypes.join(",")}
          onFileChosen={(file) => void handleChosen(file)}
        />
      ) : null}
      <FormError message={message} />
    </li>
  );
}

/**
 * The front and back of a Renter's licence. No thumbnails: a scan is only
 * fetched when View is pressed, so every look is deliberate and logged.
 */
export function LicenceScanSlots(props: {
  renterId: string;
  scans: Readonly<Record<LicenceSide, ScanSummary | null>>;
  sidesDeletedByTimer: ReadonlySet<LicenceSide>;
  keptMonths: number;
  isEditable: boolean;
}) {
  const deletedByTimerText = `Deleted after ${props.keptMonths} ${props.keptMonths === 1 ? "month" : "months"}, as set in Settings. Ask the Renter for new photos before renting.`;
  const images = LICENCE_SIDES.flatMap((side) => {
    const scan = props.scans[side];
    return scan && !isPdf(scan.contentType)
      ? [
          {
            side,
            src: licenceScanPath(props.renterId, scan.id),
            label: `Licence ${LICENCE_SIDE_LABELS[side].toLowerCase()}`,
          },
        ]
      : [];
  });
  return (
    <ImageViewer images={images}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {LICENCE_SIDES.map((side) => (
          <ScanSlot
            key={side}
            renterId={props.renterId}
            side={side}
            scan={props.scans[side]}
            imageIndex={images.findIndex((image) => image.side === side)}
            isEditable={props.isEditable}
            deletedByTimerText={props.sidesDeletedByTimer.has(side) ? deletedByTimerText : null}
          />
        ))}
      </ul>
    </ImageViewer>
  );
}

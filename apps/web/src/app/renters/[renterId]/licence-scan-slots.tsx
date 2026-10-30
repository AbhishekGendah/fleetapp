"use client";

import {
  FILE_PURPOSE_RULES,
  LICENCE_SIDE_LABELS,
  LICENCE_SIDES,
  type LicenceSide,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { CameraCapture } from "@fleetapp/ui/camera-capture";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { FormError } from "@fleetapp/ui/form-message";
import { ImageViewer } from "@fleetapp/ui/image-viewer";
import { Camera, FileUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sendPaper } from "../../../lib/files/send-paper";
import { licenceScanPath } from "../../../lib/paths";
import { FileLink, isPdf } from "../../../components/file-link";
import {
  finishLicenceScanUploadAction,
  removeLicenceScanAction,
  startLicenceScanUploadAction,
} from "./licence-actions";

const SCAN_RULE = FILE_PURPOSE_RULES.renter_licence_scan;
/** What a photo from the camera is called while it is sent; never stored. */
const CAMERA_FILE_NAME = "licence.jpg";

/** One side's scan in use, as shown: never the scan itself until View is pressed. */
export interface ScanSummary {
  id: string;
  contentType: string;
  /** Already in the Operator's words, e.g. "31 Oct 2026, 9:15 am". */
  addedText: string;
}

function ScanSlot(props: {
  renterId: string;
  side: LicenceSide;
  scan: ScanSummary | null;
  imageIndex: number;
  isEditable: boolean;
}) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { renterId, side, scan } = props;
  const sideLabel = LICENCE_SIDE_LABELS[side];

  async function handleChosen(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
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
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <CameraCapture
            triggerLabel={scan ? "Retake" : "Take photo"}
            triggerIcon={<Camera aria-hidden />}
            onPhotosTaken={(photos) => {
              // One photo per side: the last one taken is the keeper.
              const photo = photos.at(-1);
              void handleChosen(
                photo ? new File([photo], CAMERA_FILE_NAME, { type: photo.type }) : undefined,
              );
            }}
          />
          <FilePicker
            label="Choose file"
            accept={SCAN_RULE.contentTypes.join(",")}
            isDisabled={isSending}
            icon={<FileUp aria-hidden />}
            onFilesChosen={(chosen) => void handleChosen(chosen[0])}
          />
        </div>
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
  isEditable: boolean;
}) {
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
          />
        ))}
      </ul>
    </ImageViewer>
  );
}

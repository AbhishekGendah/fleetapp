"use client";

import {
  FILE_PURPOSE_RULES,
  LICENCE_SIDE_LABELS,
  LICENCE_SIDES,
  type LicenceSide,
} from "@fleetapp/core";
import { FormError } from "@fleetapp/ui/form-message";
import { CircleCheck } from "lucide-react";
import { useState } from "react";

import { PhotoOrFileButtons } from "../../../components/photo-or-file-buttons";
import { sendPaper } from "../../../lib/files/send-paper";
import { finishLinkPhotoAction, startLinkPhotoAction } from "./form-actions";

const PHOTO_ACCEPT = FILE_PURPOSE_RULES.renter_submitted_scan.contentTypes.join(",");

function LinkPhotoSlot(props: {
  token: string;
  side: LicenceSide;
  hasPhoto: boolean;
  onPhotoSent: (side: LicenceSide) => void;
}) {
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { token, side } = props;

  async function handleFileChosen(file: File): Promise<void> {
    setIsSending(true);
    setMessage(null);
    const problem = await sendPaper(
      file,
      (planned) => startLinkPhotoAction(token, { side, ...planned }),
      (fileId) => finishLinkPhotoAction(token, fileId),
    );
    setIsSending(false);
    setMessage(problem);
    if (!problem) {
      props.onPhotoSent(side);
    }
  }

  return (
    <li className="bg-background flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{LICENCE_SIDE_LABELS[side]}</p>
        <p className="text-muted-foreground flex items-center gap-1 text-sm">
          {isSending ? "Sending…" : props.hasPhoto ? "Added" : "Not added yet"}
          {props.hasPhoto && !isSending ? (
            <CircleCheck aria-hidden className="text-primary size-4" />
          ) : null}
        </p>
      </div>
      <PhotoOrFileButtons
        hasFile={props.hasPhoto}
        isSending={isSending}
        accept={PHOTO_ACCEPT}
        onFileChosen={(file) => void handleFileChosen(file)}
      />
      <FormError message={message} />
    </li>
  );
}

/**
 * The front and back of the licence, photographed fresh. A photo is never
 * shown back, here or later (rule 26): only whether each side is added.
 * A new photo replaces the one sent before for that side.
 */
export function LinkPhotos(props: {
  token: string;
  photos: Readonly<Record<LicenceSide, boolean>>;
  onPhotoSent: (side: LicenceSide) => void;
}) {
  return (
    <ul className="grid gap-3">
      {LICENCE_SIDES.map((side) => (
        <LinkPhotoSlot
          key={side}
          token={props.token}
          side={side}
          hasPhoto={props.photos[side]}
          onPhotoSent={props.onPhotoSent}
        />
      ))}
    </ul>
  );
}

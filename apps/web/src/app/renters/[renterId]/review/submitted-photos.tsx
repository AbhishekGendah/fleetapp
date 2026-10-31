"use client";

import { LICENCE_SIDE_LABELS, LICENCE_SIDES, type LicenceSide } from "@fleetapp/core";
import { ImageViewer } from "@fleetapp/ui/image-viewer";

import { FileLink, isPdf } from "../../../../components/file-link";
import { submittedPhotoPath } from "../../../../lib/paths";
import type { SubmittedPhoto } from "../../../../lib/renter-links/reviews";

/**
 * The licence photos the Renter sent. No previews: each opens only when View
 * is pressed, and every look is logged, as for scans (rule 8).
 */
export function SubmittedPhotos(props: {
  renterId: string;
  photos: Readonly<Record<LicenceSide, SubmittedPhoto | null>>;
}) {
  const images = LICENCE_SIDES.flatMap((side) => {
    const photo = props.photos[side];
    return photo && !isPdf(photo.contentType)
      ? [
          {
            side,
            src: submittedPhotoPath(props.renterId, photo.id),
            label: `Licence ${LICENCE_SIDE_LABELS[side].toLowerCase()} (sent)`,
          },
        ]
      : [];
  });
  return (
    <ImageViewer images={images}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {LICENCE_SIDES.map((side) => {
          const photo = props.photos[side];
          const sideLabel = LICENCE_SIDE_LABELS[side];
          return (
            <li key={side} className="bg-background flex flex-col gap-3 rounded-lg border p-3">
              <p className="font-semibold">{sideLabel}</p>
              {photo ? (
                <FileLink
                  href={submittedPhotoPath(props.renterId, photo.id)}
                  label={`View ${sideLabel.toLowerCase()}`}
                  contentType={photo.contentType}
                  imageIndex={images.findIndex((image) => image.side === side)}
                />
              ) : (
                <p className="text-muted-foreground text-sm">Not sent</p>
              )}
            </li>
          );
        })}
      </ul>
    </ImageViewer>
  );
}

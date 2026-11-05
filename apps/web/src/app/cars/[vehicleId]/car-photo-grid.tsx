import { ActionButton } from "@fleetapp/ui/action-button";
import { ExpiringImage } from "@fleetapp/ui/expiring-image";
import { ImageViewer, ImageViewerOpener } from "@fleetapp/ui/image-viewer";
import { Trash2 } from "lucide-react";

import { REMOVE_PHOTO_QUESTION } from "../../../lib/files/removal-questions";
import type { CarPhoto } from "../../../lib/files/car-files";
import { carFilePath } from "../../../lib/paths";
import { removeCarFileAction } from "./file-actions";

/** A grid of a car's photos, newest first; tap one to see it full size in the app. */
export function CarPhotoGrid({
  vehicleId,
  photos,
  isEditable,
}: {
  vehicleId: string;
  photos: readonly CarPhoto[];
  isEditable: boolean;
}) {
  return photos.length === 0 ? (
    <p className="text-muted-foreground text-sm">No photos yet.</p>
  ) : (
    <ImageViewer
      images={photos.map((photo) => ({
        src: carFilePath(vehicleId, photo.id),
        label: photo.label,
      }))}
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => (
          <li key={photo.id} className="relative flex flex-col gap-1">
            <ImageViewerOpener
              index={index}
              label={`Open photo ${photo.label}`}
              className="bg-muted block aspect-square overflow-hidden rounded-md border"
            >
              {photo.thumbnailUrl ? (
                <ExpiringImage
                  src={photo.thumbnailUrl}
                  alt={photo.label}
                  className="size-full object-cover"
                />
              ) : null}
            </ImageViewerOpener>
            <p className="text-muted-foreground truncate text-xs">{photo.label}</p>
            {isEditable ? (
              // Over the photo's corner, so the photo and its full name keep the room.
              <div className="absolute top-1 right-1">
                <ActionButton
                  action={removeCarFileAction.bind(null, vehicleId, photo.id)}
                  label={`Remove photo ${photo.label}`}
                  pendingLabel="Removing…"
                  variant="danger"
                  icon={<Trash2 aria-hidden />}
                  isIconOnly
                  confirm={REMOVE_PHOTO_QUESTION}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </ImageViewer>
  );
}

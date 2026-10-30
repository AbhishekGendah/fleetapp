import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { ExpiringImage } from "@fleetapp/ui/expiring-image";
import { ImageViewer, ImageViewerOpener } from "@fleetapp/ui/image-viewer";
import { Trash2 } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { listCarPhotos } from "../../../lib/files/car-files";
import { carFilePath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import { appFileStorage } from "../../../lib/storage/app-file-storage";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { removeCarFileAction } from "./file-actions";
import { PhotoUploads } from "./photo-uploads";

/** A car's photos: a grid of small copies, newest first; tap one to see it full size in the app. */
export async function PhotosTab({ vehicle, user }: { vehicle: VehicleDetail; user: SignedInUser }) {
  const photos = await listCarPhotos(
    { database: appDb, storage: appFileStorage },
    user.operatorId,
    vehicle.id,
  );
  const isEditable = vehicle.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos</CardTitle>
        <CardDescription>
          Shrunk on your phone before sending, without where they were taken. Removed photos are
          kept 30 days in case it was a mistake.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isEditable ? <PhotoUploads vehicleId={vehicle.id} /> : null}
        {photos.length === 0 ? (
          <p className="text-muted-foreground text-sm">No photos yet.</p>
        ) : (
          <ImageViewer
            images={photos.map((photo) => ({
              src: carFilePath(vehicle.id, photo.id),
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
                        action={removeCarFileAction.bind(null, vehicle.id, photo.id)}
                        label={`Remove photo ${photo.label}`}
                        pendingLabel="Removing…"
                        variant="danger"
                        icon={<Trash2 aria-hidden />}
                        isIconOnly
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </ImageViewer>
        )}
      </CardContent>
    </Card>
  );
}

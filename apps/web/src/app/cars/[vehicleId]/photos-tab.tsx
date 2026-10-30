import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { ExpiringImage } from "@fleetapp/ui/expiring-image";

import { appDb } from "../../../lib/app-db";
import { listCarPhotos } from "../../../lib/files/car-files";
import { carFilePath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import { appFileStorage } from "../../../lib/storage/app-file-storage";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { removeCarFileAction } from "./file-actions";
import { PhotoUploads } from "./photo-uploads";

/** A car's photos: a grid of small copies, newest first; tap one for full size. */
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
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo) => (
              <li key={photo.id} className="flex flex-col gap-1">
                <a
                  href={carFilePath(vehicle.id, photo.id)}
                  target="_blank"
                  rel="noopener"
                  className="bg-muted block aspect-square overflow-hidden rounded-md border"
                >
                  {photo.thumbnailUrl ? (
                    <ExpiringImage
                      src={photo.thumbnailUrl}
                      alt={photo.label}
                      className="size-full object-cover"
                    />
                  ) : null}
                </a>
                <p className="text-muted-foreground truncate text-xs">{photo.label}</p>
                {isEditable ? (
                  <ActionButton
                    action={removeCarFileAction.bind(null, vehicle.id, photo.id)}
                    label="Remove"
                    pendingLabel="Removing…"
                    variant="ghost"
                    size="sm"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

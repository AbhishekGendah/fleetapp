import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { appDb } from "../../../lib/app-db";
import { listCarPhotos } from "../../../lib/files/car-files";
import type { SignedInUser } from "../../../lib/require-user";
import { appFileStorage } from "../../../lib/storage/app-file-storage";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { CarPhotoGrid } from "./car-photo-grid";
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
        <CarPhotoGrid vehicleId={vehicle.id} photos={photos} isEditable={isEditable} />
      </CardContent>
    </Card>
  );
}

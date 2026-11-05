import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { appDb } from "../../../lib/app-db";
import { listCarPhotos } from "../../../lib/files/car-files";
import { listRemovedCarFiles } from "../../../lib/files/removed-files";
import type { SignedInUser } from "../../../lib/require-user";
import { appFileStorage } from "../../../lib/storage/app-file-storage";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { CarPhotoGrid } from "./car-photo-grid";
import { PhotoUploads } from "./photo-uploads";
import { RemovedFiles } from "./removed-files";

/** A car's photos: a grid of small copies, newest first; tap one to see it full size in the app. */
export async function PhotosTab({ vehicle, user }: { vehicle: VehicleDetail; user: SignedInUser }) {
  const [photos, removed] = await Promise.all([
    listCarPhotos({ database: appDb, storage: appFileStorage }, user.operatorId, vehicle.id),
    listRemovedCarFiles(appDb, user.operatorId, vehicle.id, new Date()),
  ]);
  const isEditable = vehicle.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos</CardTitle>
        <CardDescription>
          Shrunk on your phone before sending, without where they were taken. A photo removed by
          mistake can be brought back below for 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isEditable ? <PhotoUploads vehicleId={vehicle.id} /> : null}
        <CarPhotoGrid vehicleId={vehicle.id} photos={photos} isEditable={isEditable} />
        {isEditable ? (
          <RemovedFiles
            vehicleId={vehicle.id}
            title="Removed in the last 30 days"
            removed={removed.filter((file) => file.kind === "photo")}
            timeZone={user.operatorTimezone}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

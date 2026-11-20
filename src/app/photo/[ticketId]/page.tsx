import { Suspense } from "react";
import PhotoUpload from "./photo-upload";

// Opened from the SMS link on the tenant's phone.
export default function PhotoPage() {
  return (
    <Suspense>
      <PhotoUpload />
    </Suspense>
  );
}

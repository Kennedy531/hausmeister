"use client";
import { useParams } from "next/navigation";
import { useState } from "react";

/** Shrinks the photo on the phone first, so uploads are fast and stay under the server's body limit. */
async function downscale(file: File, max = 1280): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.8),
    );
  } catch {
    return file;
  }
}

export default function PhotoUpload() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setStatus("sending");
    try {
      const blob = await downscale(file);
      const form = new FormData();
      form.append("photo", blob, "photo.jpg");
      const res = await fetch(`/api/photo/${ticketId}`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setStatus("done");
      setMessage(json.safety_advice || "");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Hausmeister</h1>
        <p className="hm-muted">Ticket #{ticketId} · photo of the damage</p>
      </div>
      {status === "done" ? (
        <div className="hm-booked text-base">
          ✓ Thanks, we&apos;ve got it. You can go back to the call.
          {message && <p className="mt-2 font-normal">{message}</p>}
        </div>
      ) : (
        <label className="hm-card cursor-pointer items-center py-10 text-center text-lg font-semibold">
          {status === "sending" ? "Sending…" : "📷 Take a photo"}
          <span className="hm-muted text-sm font-normal">Show the damage and anything electrical near it.</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={status === "sending"}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      )}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- local preview
        <img src={preview} alt="Your photo" className="w-full rounded-xl" />
      )}
      {status === "error" && <p className="hm-escalated">{message}. Please try again.</p>}
    </main>
  );
}

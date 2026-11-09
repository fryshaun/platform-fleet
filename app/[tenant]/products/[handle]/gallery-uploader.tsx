"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMediaUploadUrl, recordMediaUpload } from "@/lib/actions/products";
import { PRODUCT_MEDIA_ACCEPT, PRODUCT_MEDIA_BUCKET } from "@/lib/products";
import { createClient } from "@/lib/supabase/client";

type UploadState = {
  tone: "idle" | "busy" | "error" | "ok";
  message?: string;
};

/**
 * Gallery uploader: browser → Storage, never through a Server Action.
 *
 * Three steps, and each one is authorized separately:
 *
 *   1. `createMediaUploadUrl` checks the tenant, the role and the section, then
 *      mints a signed upload URL for `<company>/<product>/<uuid>.<ext>`.
 *   2. The browser PUTs the file straight to that URL, so a 40 MB video never
 *      becomes a 40 MB request body.
 *   3. `recordMediaUpload` re-checks the path and writes the row.
 *
 * The bucket row is what the app reads; the object is only what it renders.
 */
export function GalleryUploader({
  slug,
  productId,
}: {
  slug: string;
  productId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({ tone: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file");
    const file =
      fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : undefined;

    if (!file) {
      setState({ tone: "error", message: "Choose a file first." });
      return;
    }

    setState({ tone: "busy", message: "Preparing the upload…" });

    const target = await createMediaUploadUrl({
      slug,
      productId,
      contentType: file.type,
      size: file.size,
    });

    // `undefined` here means the action redirected (the session went away), so
    // this guard is also the "you were signed out" case.
    if (!target || !target.ok) {
      setState({
        tone: "error",
        message:
          (target && !target.ok ? target.message : null) ??
          "Could not start the upload. Reload and try again.",
      });
      return;
    }

    setState({ tone: "busy", message: "Uploading…" });

    const supabase = createClient();
    const { error } = await supabase.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .uploadToSignedUrl(target.path, target.token, file, {
        contentType: file.type,
      });

    if (error) {
      setState({ tone: "error", message: error.message });
      return;
    }

    const recorded = await recordMediaUpload({
      slug,
      productId,
      path: target.path,
      contentType: file.type,
    });

    if (!recorded || !recorded.ok) {
      setState({
        tone: "error",
        message:
          (recorded && !recorded.ok ? recorded.message : null) ??
          "The upload finished but could not be saved. Reload and try again.",
      });
      return;
    }

    form.reset();
    setState({ tone: "ok", message: recorded.message });
    // The revalidation the action performed reaches the client with this
    // refresh, so the new thumbnail appears without a manual reload.
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="gallery-file">Upload an image or a video</Label>
        <Input
          id="gallery-file"
          name="file"
          type="file"
          accept={PRODUCT_MEDIA_ACCEPT}
          className="file:text-foreground h-auto py-1.5"
        />
        <p className="text-muted-foreground text-xs">
          PNG, JPEG, WebP, AVIF, MP4 or WebM — up to 50 MB.
        </p>
      </div>

      <Button type="submit" size="sm" disabled={state.tone === "busy"}>
        {state.tone === "busy" ? "Uploading…" : "Upload"}
      </Button>

      {state.tone !== "idle" && state.message ? (
        <p
          role={state.tone === "error" ? "alert" : "status"}
          className={
            state.tone === "error"
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

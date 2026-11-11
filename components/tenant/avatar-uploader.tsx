"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AVATARS_BUCKET, AVATAR_ACCEPT, AVATAR_MAX_BYTES } from "@/lib/account";
import {
  createAvatarUploadUrl,
  removeAvatar,
  setAvatar,
} from "@/lib/actions/account";
import { createClient } from "@/lib/supabase/client";

type UploadState = {
  tone: "idle" | "busy" | "error" | "ok";
  message?: string;
};

/**
 * Photo uploader: browser → Storage, never through a Server Action.
 *
 * The same three steps as the product gallery, each authorized separately:
 *
 *   1. `createAvatarUploadUrl` mints a signed upload URL for
 *      `<user-id>/<uuid>.<ext>`.
 *   2. The browser PUTs the file straight to that URL, so a phone photo never
 *      becomes part of a Server Action request body.
 *   3. `setAvatar` re-checks the path and writes `profiles.avatar_url`.
 *
 * The photo it replaces is deleted server-side, so changing it ten times leaves
 * one object in the bucket rather than ten.
 */
export function AvatarUploader({
  initialUrl,
  initials,
}: {
  initialUrl: string | null;
  /** Fallback letters shown while there is no photo. */
  initials: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [state, setState] = useState<UploadState>({ tone: "idle" });

  const busy = state.tone === "busy";

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const input = form.elements.namedItem("file");
    const file =
      input instanceof HTMLInputElement ? input.files?.[0] : undefined;

    if (!file) {
      setState({ tone: "error", message: "Choose a photo first." });
      return;
    }
    // Checked here as well as in the action so a 40 MB photo is refused before
    // it is uploaded, not after.
    if (file.size > AVATAR_MAX_BYTES) {
      setState({ tone: "error", message: "Keep photos under 2 MB." });
      return;
    }

    setState({ tone: "busy", message: "Preparing the upload…" });

    const target = await createAvatarUploadUrl({
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
      .from(AVATARS_BUCKET)
      .uploadToSignedUrl(target.path, target.token, file, {
        contentType: file.type,
      });

    if (error) {
      setState({ tone: "error", message: error.message });
      return;
    }

    const saved = await setAvatar({
      path: target.path,
      contentType: file.type,
    });

    if (!saved || !saved.ok) {
      setState({
        tone: "error",
        message:
          (saved && !saved.ok ? saved.message : null) ??
          "The upload finished but could not be saved. Reload and try again.",
      });
      return;
    }

    form.reset();
    setUrl(saved.url);
    setState({ tone: "ok", message: saved.message });
    // The revalidation the action performed reaches the client with this
    // refresh, so the rail's avatar changes without a manual reload.
    router.refresh();
  }

  async function handleRemove() {
    setState({ tone: "busy", message: "Removing…" });

    const result = await removeAvatar();

    if (!result || !result.ok) {
      setState({
        tone: "error",
        message:
          (result && !result.ok ? result.message : null) ??
          "Could not remove the photo. Reload and try again.",
      });
      return;
    }

    setUrl(result.url);
    setState({ tone: "ok", message: result.message });
    router.refresh();
  }

  return (
    <div className="flex items-start gap-4">
      <Avatar className="size-16">
        {url ? <AvatarImage src={url} alt="" /> : null}
        <AvatarFallback className="text-sm">{initials}</AvatarFallback>
      </Avatar>

      <form onSubmit={handleUpload} className="min-w-0 flex-1 space-y-2">
        <div className="space-y-2">
          <Label htmlFor="avatar-file">Photo</Label>
          <Input
            id="avatar-file"
            name="file"
            type="file"
            accept={AVATAR_ACCEPT}
            className="file:text-foreground h-auto py-1.5"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? "Uploading…" : "Upload photo"}
          </Button>
          {url ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              disabled={busy}
            >
              Remove
            </Button>
          ) : null}
        </div>

        <p className="text-muted-foreground text-xs">
          PNG, JPEG, WebP or AVIF — up to 2 MB.
        </p>

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
    </div>
  );
}

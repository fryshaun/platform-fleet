"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CompanyMark } from "@/components/tenant/company-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createLogoUploadUrl,
  removeCompanyLogo,
  setCompanyLogo,
} from "@/lib/actions/company";
import {
  COMPANY_LOGOS_BUCKET,
  COMPANY_LOGO_ACCEPT,
  COMPANY_LOGO_MAX_BYTES,
} from "@/lib/company";
import { createClient } from "@/lib/supabase/client";

type UploadState = {
  tone: "idle" | "busy" | "error" | "ok";
  message?: string;
};

/**
 * Workspace logo uploader: browser → Storage, never through a Server Action.
 *
 * The same three steps as the account photo, each authorized separately:
 *
 *   1. `createLogoUploadUrl` mints a signed upload URL for
 *      `<company-id>/<uuid>.<ext>`, after checking the caller is an owner or an
 *      admin of that company.
 *   2. The browser PUTs the file straight to that URL.
 *   3. `setCompanyLogo` re-checks the path and writes `companies.logo_url`.
 *
 * The logo it replaces is deleted server-side, so trying five files leaves one
 * object in the bucket. Removing a logo is not the same as having none: the
 * square falls back to the badge, then to the initials of the name, which is what
 * the preview beside the button shows.
 */
export function CompanyLogoUploader({
  slug,
  name,
  badge,
  initialUrl,
}: {
  slug: string;
  name: string;
  badge: string | null;
  initialUrl: string | null;
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
      setState({ tone: "error", message: "Choose an image first." });
      return;
    }
    // Checked here as well as in the action so a large file is refused before it
    // is uploaded, not after.
    if (file.size > COMPANY_LOGO_MAX_BYTES) {
      setState({ tone: "error", message: "Keep logos under 2 MB." });
      return;
    }

    setState({ tone: "busy", message: "Preparing the upload…" });

    const target = await createLogoUploadUrl({
      slug,
      contentType: file.type,
      size: file.size,
    });

    // `undefined` here means the action redirected (the session went away, or the
    // role changed), so this guard is also the "you were signed out" case.
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
      .from(COMPANY_LOGOS_BUCKET)
      .uploadToSignedUrl(target.path, target.token, file, {
        contentType: file.type,
      });

    if (error) {
      setState({ tone: "error", message: error.message });
      return;
    }

    const saved = await setCompanyLogo({
      slug,
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
    // The revalidation the action performed reaches the client with this refresh,
    // so the rail and the workspace chooser change without a manual reload.
    router.refresh();
  }

  async function handleRemove() {
    setState({ tone: "busy", message: "Removing…" });

    const result = await removeCompanyLogo({ slug });

    if (!result || !result.ok) {
      setState({
        tone: "error",
        message:
          (result && !result.ok ? result.message : null) ??
          "Could not remove the logo. Reload and try again.",
      });
      return;
    }

    setUrl(result.url);
    setState({ tone: "ok", message: result.message });
    router.refresh();
  }

  return (
    <div className="flex items-start gap-4">
      <CompanyMark
        name={name}
        logoUrl={url}
        badge={badge}
        className="size-16"
      />

      <form onSubmit={handleUpload} className="min-w-0 flex-1 space-y-2">
        <div className="space-y-2">
          <Label htmlFor="logo-file">Logo</Label>
          <Input
            id="logo-file"
            name="file"
            type="file"
            accept={COMPANY_LOGO_ACCEPT}
            className="file:text-foreground h-auto py-1.5"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? "Uploading…" : "Upload logo"}
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
          PNG, JPEG, WebP or AVIF — up to 2 MB. Without a logo the square shows
          the badge, or the initials of the name.
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

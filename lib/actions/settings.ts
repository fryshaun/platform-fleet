"use server";

import { revalidatePath } from "next/cache";

import {
  getActionContext,
  readField,
  requireAdministrator,
  redirectWith,
} from "@/lib/actions/support";
import { parseSectionKeys, SECTIONS } from "@/lib/features";
import { settingsSegment } from "@/lib/settings";

/** Company name can change; the slug deliberately cannot (it is the URL). */
export async function updateCompany(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireAdministrator(context, slug);

  const name = readField(formData, "name");
  if (name.length < 2) {
    redirectWith(slug, settingsSegment("company"), {
      error: "Enter a company name.",
    });
  }

  const { error } = await context.supabase
    .from("companies")
    .update({ name })
    .eq("id", context.company.id);

  if (error) {
    redirectWith(slug, settingsSegment("company"), { error: error.message });
  }

  revalidatePath(`/${slug}`, "layout");
  redirectWith(slug, settingsSegment("company"), { ok: "Company updated." });
}

/**
 * Switches optional extensions on and off.
 *
 * The UI calls these "extensions"; the column, the policies and this module
 * still call them sections.
 *
 * The submitted checkboxes are re-read through `parseSectionKeys`, so the row
 * can only ever hold keys this build knows: the list in `lib/features.ts` is the
 * allowlist, and the database treats an unknown key as matching no policy.
 *
 * Turning a section off hides its rows; nothing is deleted. Turning it back on
 * makes them visible again, untouched.
 */
export async function updateEnabledSections(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireAdministrator(context, slug);

  const sections = parseSectionKeys(
    formData
      .getAll("section")
      .filter((value): value is string => typeof value === "string"),
  );

  const { error } = await context.supabase
    .from("companies")
    .update({ enabled_sections: sections })
    .eq("id", context.company.id);

  if (error) {
    redirectWith(slug, settingsSegment("extensions"), { error: error.message });
  }

  // The rail renders the switch, so the whole tenant layout has to refresh.
  revalidatePath(`/${slug}`, "layout");
  redirectWith(slug, settingsSegment("extensions"), {
    ok:
      sections.length === 0
        ? "Extensions updated. All optional extensions are off."
        : `Extensions updated: ${sections
            .map((key) => SECTIONS[key].label)
            .join(", ")}.`,
  });
}

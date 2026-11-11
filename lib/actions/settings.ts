"use server";

import { revalidatePath } from "next/cache";

import {
  getActionContext,
  readField,
  requireAdministrator,
  redirectWith,
} from "@/lib/actions/support";
import { parseSectionKeys, SECTIONS } from "@/lib/features";
import { companyBadge, companyBadgeProblem } from "@/lib/company";
import { isProductCurrency } from "@/lib/products";
import { settingsSegment } from "@/lib/settings";

/**
 * Company name, default currency and badge can change; the slug deliberately
 * cannot (it is the URL) and the logo has its own action because a file upload is
 * not a form post.
 *
 * The currency is the *default* for new products: every product keeps its own
 * `currency`, so re-pricing a workspace is an explicit act rather than a side
 * effect of this form.
 */
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

  const currency = readField(formData, "currency");
  if (!isProductCurrency(currency)) {
    redirectWith(slug, settingsSegment("company"), {
      error: "Choose a currency from the list.",
    });
  }

  // Re-read through the shared rules rather than trusting the input's
  // `maxLength`: an empty badge means "use the initials", not "store nothing
  // visible".
  const badgeField = readField(formData, "badge");
  const badgeProblem = companyBadgeProblem(badgeField);
  if (badgeProblem) {
    redirectWith(slug, settingsSegment("company"), { error: badgeProblem });
  }

  const { error } = await context.supabase
    .from("companies")
    .update({ name, currency, badge: companyBadge(badgeField) })
    .eq("id", context.company.id);

  if (error) {
    redirectWith(slug, settingsSegment("company"), { error: error.message });
  }

  // The rail and the workspace chooser both draw the name and the mark, and the
  // chooser lists workspaces other than this one — so the whole tree refreshes,
  // the way the avatar actions do it.
  revalidatePath("/", "layout");
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

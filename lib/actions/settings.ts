"use server";

import { revalidatePath } from "next/cache";

import {
  getActionContext,
  readField,
  requireAdministrator,
  redirectWith,
} from "@/lib/actions/support";

/** Company name can change; the slug deliberately cannot (it is the URL). */
export async function updateCompany(formData: FormData) {
  const slug = readField(formData, "slug");
  const context = await getActionContext(slug);
  requireAdministrator(context, slug);

  const name = readField(formData, "name");
  if (name.length < 2) {
    redirectWith(slug, "settings", { error: "Enter a company name." });
  }

  const { error } = await context.supabase
    .from("companies")
    .update({ name })
    .eq("id", context.company.id);

  if (error) {
    redirectWith(slug, "settings", { error: error.message });
  }

  revalidatePath(`/${slug}`, "layout");
  redirectWith(slug, "settings", { ok: "Company updated." });
}

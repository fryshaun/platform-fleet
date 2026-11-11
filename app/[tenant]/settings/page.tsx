import type { Metadata } from "next";
import { Suspense } from "react";

import { FormMessage } from "@/components/form-message";
import { CompanyLogoUploader } from "@/components/tenant/company-logo-uploader";
import { PageSkeleton } from "@/components/tenant/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initials } from "@/lib/account";
import { updateCompany } from "@/lib/actions/settings";
import { COMPANY_BADGE_MAX } from "@/lib/company";
import { isProductCurrency, PRODUCT_CURRENCY_OPTIONS } from "@/lib/products";
import { readParam } from "@/lib/search-params";

import { SELECT_CLASSES } from "../fields";
import { requireSettingsAccess } from "./settings-access";
import { SettingsHeader } from "./settings-header";

export const metadata: Metadata = {
  title: "Company",
};

export default function SettingsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings">) {
  return (
    <main className="flex-1">
      <Suspense fallback={<PageSkeleton />}>
        <CompanySettings params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The Company tab: what the workspace is called, how it is marked, what it charges in. */
async function CompanySettings({
  params,
  searchParams,
}: {
  params: PageProps<"/[tenant]/settings">["params"];
  searchParams: PageProps<"/[tenant]/settings">["searchParams"];
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const { company } = await requireSettingsAccess(tenant);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-10">
      <SettingsHeader
        slug={company.slug}
        current="company"
        description="What this workspace is called, how it is marked, and the currency it sells in."
      />

      <FormMessage error={readParam(query.error)} success={readParam(query.ok)} />

      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>
            The workspace address is permanent — it is the URL your team uses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateCompany} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="slug" value={company.slug} />

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={company.name}
                required
                maxLength={120}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug-readonly">Workspace address</Label>
              <Input
                id="slug-readonly"
                defaultValue={`/${company.slug}`}
                readOnly
                disabled
              />
            </div>

            <div className="space-y-2">
              {/* The default, not a company-wide setting: every product carries
                  its own currency, and changing this one re-prices nothing. */}
              <Label htmlFor="currency">Default currency</Label>
              <select
                id="currency"
                name="currency"
                className={SELECT_CLASSES}
                defaultValue={
                  isProductCurrency(company.currency) ? company.currency : "usd"
                }
              >
                {PRODUCT_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                New products start in this currency. Existing products keep
                theirs.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="badge">Badge</Label>
              <Input
                id="badge"
                name="badge"
                defaultValue={company.badge ?? ""}
                maxLength={8}
                autoComplete="off"
                placeholder={initials(company.name)}
                className="max-w-24"
              />
              <p className="text-muted-foreground text-xs">
                {COMPANY_BADGE_MAX} characters or an emoji, shown when there is
                no logo. Leave it empty for the initials of the name.
              </p>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            The square in the rail and in your workspace list. A logo wins over
            the badge, and the badge wins over the initials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyLogoUploader
            slug={company.slug}
            name={company.name}
            badge={company.badge}
            initialUrl={company.logo_url}
          />
        </CardContent>
      </Card>
    </div>
  );
}

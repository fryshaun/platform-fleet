"use client";

import { useActionState, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { PlanPicker } from "@/components/billing/plan-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCompanyAndCheckout,
  type CompanyFormState,
} from "@/lib/actions/company";
import type { SubscriptionPlan } from "@/lib/plans";
import { slugify, validateSlug, SLUG_PROBLEM_MESSAGES } from "@/lib/slug";

const INITIAL_STATE: CompanyFormState = { error: null };

export function CompanyForm({ plans }: { plans: SubscriptionPlan[] }) {
  const [state, formAction, isPending] = useActionState(
    createCompanyAndCheckout,
    INITIAL_STATE,
  );

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const effectiveSlug = slugTouched ? slugify(slug) : slugify(name);
  const slugProblem = effectiveSlug.length > 0 ? validateSlug(effectiveSlug) : null;

  return (
    <form action={formAction} className="space-y-6">
      {state.error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="name">Company name</Label>
        <Input
          id="name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Studio"
          autoComplete="organization"
          required
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">Workspace address</Label>
        <div className="flex items-stretch">
          <span className="border-input text-muted-foreground bg-muted flex items-center rounded-l-md border border-r-0 px-3 text-sm">
            /
          </span>
          <Input
            id="slug"
            name="slug"
            value={slugTouched ? slug : effectiveSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            placeholder="acme-studio"
            className="rounded-l-none"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={slugProblem !== null}
            aria-describedby="slug-hint"
          />
        </div>
        <p id="slug-hint" className="text-muted-foreground text-xs">
          {slugProblem
            ? SLUG_PROBLEM_MESSAGES[slugProblem]
            : `Your workspace lives at /${effectiveSlug || "your-company"}/dashboard`}
        </p>
      </div>

      <PlanPicker plans={plans} disabled={isPending} />

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2Icon aria-hidden="true" className="animate-spin" />
            Opening checkout…
          </>
        ) : (
          "Continue to payment"
        )}
      </Button>

      <p className="text-muted-foreground text-xs leading-relaxed">
        You will be taken to Stripe to start your subscription. The workspace is
        created first and rolled back if checkout fails.
      </p>
    </form>
  );
}

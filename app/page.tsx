import Link from "next/link";
import {
  CreditCardIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: LayoutDashboardIcon,
    title: "One workspace per company",
    body: "Each company gets its own path-based workspace, with its own members and roles.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Row Level Security",
    body: "Tenant isolation is enforced in Postgres, so no query can leak another company's data.",
  },
  {
    icon: CreditCardIcon,
    title: "Billing built in",
    body: "Checkout, the billing portal and webhook-driven subscription state are already wired up.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border/60 flex items-center justify-between border-b px-6 py-4">
        <span className="text-sm font-semibold tracking-tight">Platform</span>
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-16 px-6 py-20">
        <section className="space-y-6">
          <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
            Multi-tenant starter
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            The base every customer-facing app needs.
          </h1>
          <p className="text-muted-foreground max-w-xl text-lg leading-relaxed">
            Sign-in with email or Google, per-workspace membership and roles,
            row-level tenant isolation and Stripe billing — all wired up. Bring
            your own product on top.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">Create a workspace</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">I already have one</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="border-border/60 rounded-xl border p-6"
            >
              <feature.icon
                aria-hidden="true"
                className="text-muted-foreground mb-4 size-5"
              />
              <h2 className="mb-2 text-sm font-semibold">{feature.title}</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {feature.body}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

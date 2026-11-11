import Link from "next/link";
import {
  CreditCardIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { BrandLink } from "@/components/brand/brand-link";
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
      {/* The lime rule is the brand's signature edge, borrowed from the mark. */}
      <div aria-hidden="true" className="bg-brand-lime h-[3px]" />

      <header className="border-border/60 bg-background/80 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur sm:px-6">
        <BrandLink logoClassName="text-lg sm:text-xl" />
        <nav className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {/* Below `sm` the header keeps only the primary action; the sign-in
              page is one tap away from "Get started" anyway. */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            asChild
          >
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-16 px-6 py-20">
        <section className="space-y-6">
          <p className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wide uppercase">
            <span
              aria-hidden="true"
              className="text-brand-emerald dark:text-brand-lime font-mono leading-none tracking-[-0.12em]"
            >
              {"///"}
            </span>
            Multi-tenant starter
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            The base every{" "}
            <span className="bg-brand-lime text-brand-forest box-decoration-clone px-1 sm:whitespace-nowrap">
              customer-facing
            </span>{" "}
            app needs.
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
              className="border-border/60 bg-card rounded-xl border p-6"
            >
              {/* Lime tile, forest glyph: the one place the mark's fill shows up. */}
              <span className="bg-brand-lime text-brand-forest mb-4 flex size-9 items-center justify-center rounded-md">
                <feature.icon aria-hidden="true" className="size-5" />
              </span>
              <h2 className="mb-2 text-sm font-semibold">{feature.title}</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {feature.body}
              </p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-border/60 border-t px-6 py-8">
        <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-col gap-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <BrandLink logoClassName="text-base" />
          <p className="font-mono tracking-[0.14em] uppercase">
            Fleet operations · Built for bike shops
          </p>
        </div>
      </footer>
    </div>
  );
}


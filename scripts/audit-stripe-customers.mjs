#!/usr/bin/env node
/**
 * Read-only reconciliation for `companies.stripe_customer_id`.
 *
 * `20260101001000_company_billing_guard.sql` stops a signed-in session from
 * repointing a company's Stripe customer id, and both the portal and the
 * checkout now refuse an id they cannot prove. Neither of those repairs a row
 * that was already repointed while the write was open: the checkout quietly
 * creates a fresh customer instead, which hides the problem behind a working
 * purchase. This script is what makes those rows visible.
 *
 * It reads Stripe and the `companies` table, and writes to neither. Every
 * verdict is printed for a person to act on.
 *
 *   node scripts/audit-stripe-customers.mjs          # human-readable
 *   node scripts/audit-stripe-customers.mjs --json   # machine-readable
 *
 * Exit codes: 0 when every row is proven to belong to its company, 1 when any
 * row is not, 2 when the environment or an API is unavailable.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Stripe from "stripe";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The app reads `.env.local` through Next, which this script does not run. Only
 * missing values are filled in, so an exported variable still wins.
 */
function loadEnvLocal() {
  const path = resolve(ROOT, ".env.local");

  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnvLocal();

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const secretKey =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const stripeKey = process.env.STRIPE_SECRET_KEY;

if (!apiUrl || !secretKey || !stripeKey) {
  console.error(
    "Missing configuration. NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and " +
      "STRIPE_SECRET_KEY must be set (.env.local is read automatically).",
  );
  process.exit(2);
}

const stripe = new Stripe(stripeKey, {
  appInfo: { name: "platform-audit-stripe-customers", version: "0.1.0" },
});

let response;

try {
  response = await fetch(
    `${apiUrl}/rest/v1/companies?select=id,slug,stripe_customer_id` +
      "&stripe_customer_id=not.is.null&order=slug",
    { headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` } },
  );
} catch (error) {
  console.error(
    `Could not reach ${apiUrl}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}

if (!response.ok) {
  console.error(
    `Could not read companies: ${response.status} ${await response.text()}`,
  );
  process.exit(2);
}

/** @type {{ id: string, slug: string, stripe_customer_id: string }[]} */
const companies = await response.json();

/** Reads one customer back and says which side of the proof it is on. */
async function audit(company) {
  const customerId = company.stripe_customer_id;
  let customer;

  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (error) {
    return {
      status: "unreadable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (customer.deleted) {
    return { status: "deleted", detail: "Stripe reports it as deleted" };
  }

  const stampedId = customer.metadata?.company_id;
  const stampedSlug = customer.metadata?.company_slug;

  if (stampedId) {
    return stampedId === company.id
      ? { status: "owned", detail: "metadata.company_id matches" }
      : { status: "mismatch", detail: `metadata.company_id is ${stampedId}` };
  }

  if (stampedSlug) {
    return stampedSlug === company.slug
      ? { status: "legacy", detail: "matches by metadata.company_slug only" }
      : {
          status: "mismatch",
          detail: `metadata.company_slug is ${stampedSlug}`,
        };
  }

  return {
    status: "unowned",
    detail: "customer carries neither company_id nor company_slug",
  };
}

const findings = [];

// One at a time: it keeps the output in slug order and stays well inside
// Stripe's read limit for any realistic number of companies.
for (const company of companies) {
  findings.push({ company, ...(await audit(company)) });
}

const proven = findings.filter(
  (finding) => finding.status === "owned" || finding.status === "legacy",
);
const failing = findings.filter(
  (finding) => finding.status !== "owned" && finding.status !== "legacy",
);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: failing.length === 0, findings }, null, 2));
} else {
  for (const { company, status, detail } of findings) {
    console.log(
      `${status.padEnd(10)} ${company.slug}  ${company.stripe_customer_id}  ${detail}`,
    );
  }

  console.log(
    `\n${findings.length} customer(s) on file, ${proven.length} proven, ${failing.length} not.`,
  );

  if (failing.length > 0) {
    console.log(
      "The next checkout on an unproven row creates a fresh customer instead of " +
        "charging the old one. Nothing was changed here: decide which side is " +
        "wrong, then clear `stripe_customer_id` or reattach it by hand.",
    );
  } else if (findings.some((finding) => finding.status === "legacy")) {
    console.log(
      "Rows marked `legacy` predate the `company_id` stamp. They still work; " +
        "stamping the id on the customer in Stripe makes the proof a column " +
        "comparison rather than a slug comparison.",
    );
  }
}

process.exit(failing.length === 0 ? 0 : 1);

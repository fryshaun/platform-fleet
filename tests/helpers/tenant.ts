import { vi } from "vitest";

import type { MemberRole } from "@/lib/supabase/types";

import { companyRow } from "./fixtures";
import {
  createSupabaseMock,
  signedInUser,
  type SupabaseMock,
  type TableHandler,
} from "./supabase";

/** The shape of the `vi.fn()` a test file passes for `createClient`. */
type CreateClientMock = { mockResolvedValue: (client: unknown) => unknown };

/**
 * Wires the request-scoped Supabase client for a tenant Server Action.
 *
 * `getActionContext` always reads `companies` and `company_members` first, so
 * those two are provided by default and the caller supplies only the tables its
 * own action touches.
 */
export function tenantSetup(
  createClient: CreateClientMock,
  handlers: Record<string, TableHandler> = {},
  role: MemberRole = "owner",
): SupabaseMock {
  const mock = createSupabaseMock({
    auth: { getUser: vi.fn(async () => signedInUser()) },
    tables: {
      companies: () => ({ data: companyRow(), error: null }),
      company_members: () => ({ data: { role }, error: null }),
      ...handlers,
    },
  });

  createClient.mockResolvedValue(mock.client);
  return mock;
}

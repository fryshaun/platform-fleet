import { vi } from "vitest";

/**
 * A minimal stand-in for the `@supabase/supabase-js` query builder.
 *
 * The real builder is a thenable that is also chainable, and the application
 * relies on both: `await supabase.from(t).select(...)` and
 * `await supabase.from(t).update(x).eq(...).eq(...)`. Each chained call returns
 * the builder itself, and every method name is recorded so a test can assert the
 * exact filters that were applied instead of just the end result.
 */
export type DbError = { message: string; code?: string };

export type DbResult = {
  data?: unknown;
  error?: DbError | null;
  count?: number | null;
};

export type Call = { method: string; args: unknown[] };

/** Receives the current chain's calls and every chain seen so far. */
export type TableHandler = (calls: Call[], history: Call[][]) => DbResult;

const EMPTY_RESULT: DbResult = { data: null, error: null, count: null };

function createThenableBuilder(run: () => DbResult, calls: Call[]) {
  // `builder` is referenced from inside the proxy handler, which only runs after
  // the constructor returns, so the reference is safe despite appearing first.
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;

        if (property === "then") {
          return (
            resolve: (value: DbResult) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(run()).then(resolve, reject);
        }

        return (...args: unknown[]) => {
          calls.push({ method: property, args });
          return builder;
        };
      },
    },
  );

  return builder;
}

export type SupabaseMockOptions = {
  /** Keyed by table name. Unlisted tables resolve to `{ data: null }`. */
  tables?: Record<string, TableHandler>;
  /** Overrides merged onto the default `auth` stub. */
  auth?: Record<string, unknown>;
  /** Overrides for the bucket methods, keyed by bucket id. */
  storage?: Record<string, StorageBucketOverrides>;
  /**
   * Overrides for `supabase.rpc()`, keyed by function name.
   *
   * An unlisted function answers `{ data: null }`, which is what a caller has to
   * cope with anyway — `readHasPassword` falls back to the provider list when
   * `has_password()` gives it nothing.
   */
  rpc?: Record<string, (args?: unknown) => DbResult>;
};

/**
 * The slice of `supabase.storage.from(bucket)` the app uses.
 *
 * Only the three methods the products module calls are modelled; they resolve
 * successfully by default so a test only has to describe the failure it cares
 * about.
 */
export type StorageBucketStub = {
  createSignedUploadUrl: (path: string) => Promise<{
    data: { path: string; token: string } | null;
    error: DbError | null;
  }>;
  remove: (paths: string[]) => Promise<{ data: unknown; error: DbError | null }>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
};

export type StorageBucketOverrides = Partial<StorageBucketStub>;

export type SupabaseMock = {
  client: {
    from: (table: string) => unknown;
    rpc: (name: string, args?: unknown) => Promise<DbResult>;
    auth: Record<string, unknown>;
    storage: { from: (bucket: string) => StorageBucketStub };
  };
  /** Every chain started by `from(table)`, in order. */
  chainsFor: (table: string) => Call[][];
  /** All chained calls for a table, flattened across chains. */
  callsFor: (table: string) => Call[];
  /** Method names called on a table, in order, for readable assertions. */
  methodsFor: (table: string) => string[];
  /** Argument of the first call to `method` on `table`, or `undefined`. */
  argFor: (table: string, method: string) => unknown;
  /** Full argument list of every call to `method` on `table`. */
  argsFor: (table: string, method: string) => unknown[][];
  /** Every `rpc()` call, with the function name in `method`. */
  rpcCalls: Call[];
};

export function createSupabaseMock(
  options: SupabaseMockOptions = {},
): SupabaseMock {
  const handlers = options.tables ?? {};
  const chainsByTable = new Map<string, Call[][]>();
  const rpcCalls: Call[] = [];

  const chainsFor = (table: string) => {
    const existing = chainsByTable.get(table);
    if (existing) return existing;
    const created: Call[][] = [];
    chainsByTable.set(table, created);
    return created;
  };

  /**
   * The MFA surface, with the answers a happy path expects.
   *
   * `listFactors` answers "no factors" and the assurance level "aal1 → aal1", so
   * a test that only cares about, say, recovery codes does not have to describe
   * the authenticator it does not have.
   */
  const recoveryCodesStub = {
    getStatus: vi.fn(async () => ({
      data: null,
      error: { code: "mfa_factor_not_found", message: "Recovery codes not set up" },
    })),
    generate: vi.fn(async () => ({
      data: {
        id: "factor-codes",
        type: "recovery_code",
        friendly_name: "Backup codes",
        total: 2,
        codes: ["abcd1234efgh", "ijkl5678mnop"],
      },
      error: null,
    })),
    verify: vi.fn(async () => ({ data: { user: null }, error: null })),
    regenerate: vi.fn(async () => ({
      data: {
        id: "factor-codes",
        type: "recovery_code",
        total: 2,
        codes: ["qrst9012uvwx", "yzab3456cdef"],
      },
      error: null,
    })),
    unenroll: vi.fn(async () => ({ data: { id: "factor-codes" }, error: null })),
  };

  const mfaStub = {
    enroll: vi.fn(
      async (params?: { friendlyName?: string }) => ({
        data: {
          id: "factor-1",
          type: "totp" as const,
          friendly_name: params?.friendlyName,
          totp: {
            qr_code: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
            secret: "JBSWY3DPEHPK3PXP",
            uri: "otpauth://totp/Trackstand:owner@example.com?secret=JBSWY3DPEHPK3PXP",
          },
        },
        error: null,
      }),
    ),
    challenge: vi.fn(async () => ({
      data: { id: "challenge-1", type: "totp" as const, expires_at: 0 },
      error: null,
    })),
    verify: vi.fn(async () => ({ data: { user: null }, error: null })),
    challengeAndVerify: vi.fn(async () => ({
      data: { user: null },
      error: null,
    })),
    unenroll: vi.fn(async (params: { factorId: string }) => ({
      data: { id: params.factorId },
      error: null,
    })),
    listFactors: vi.fn(async () => ({
      data: { all: [], totp: [], phone: [] },
      error: null,
    })),
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    })),
    recoveryCodes: recoveryCodesStub,
  };

  const authStub: Record<string, unknown> = {
    getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    signInWithOAuth: vi.fn(),
    // Safe defaults so an action's `const { data, error } = await …` never
    // destructures `undefined`; tests override the one they care about.
    signInWithPassword: vi.fn(async () => ({
      data: { session: null, user: null },
      error: null,
    })),
    signUp: vi.fn(async () => ({
      data: { session: null, user: null },
      error: null,
    })),
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
    mfa: mfaStub,
    ...options.auth,
  };

  // `mfa` and the `recoveryCodes` inside it are nested, so a plain spread of the
  // overrides would drop every default the moment a test replaced one method.
  // Merged a level deeper for those two, and shallow everywhere else.
  const mfaOverrides = options.auth?.mfa as
    | Record<string, unknown>
    | undefined;

  if (mfaOverrides) {
    authStub.mfa = {
      ...mfaStub,
      ...mfaOverrides,
      recoveryCodes: {
        ...recoveryCodesStub,
        ...((mfaOverrides.recoveryCodes as Record<string, unknown> | undefined) ??
          {}),
      },
    };
  }


  const client = {
    from(table: string) {
      const history = chainsFor(table);
      const calls: Call[] = [];
      history.push(calls);

      const handler = handlers[table];
      return createThenableBuilder(
        () => (handler ? handler(calls, history) : EMPTY_RESULT),
        calls,
      );
    },
    async rpc(name: string, args?: unknown): Promise<DbResult> {
      rpcCalls.push({ method: name, args: [args] });

      const handler = options.rpc?.[name];
      return handler ? handler(args) : EMPTY_RESULT;
    },
    storage: {
      from(bucket: string): StorageBucketStub {
        const overrides = options.storage?.[bucket] ?? {};

        return {
          createSignedUploadUrl:
            overrides.createSignedUploadUrl ??
            (async (path: string) => ({
              data: { path, token: "test-upload-token" },
              error: null,
            })),
          remove:
            overrides.remove ??
            (async (paths: string[]) => ({ data: paths, error: null })),
          getPublicUrl:
            overrides.getPublicUrl ??
            ((path: string) => ({
              data: { publicUrl: `https://storage.test/${bucket}/${path}` },
            })),
        };
      },
    },
    auth: authStub,
  };

  const callsFor = (table: string) => chainsFor(table).flat();

  return {
    client,
    chainsFor,
    callsFor,
    methodsFor: (table: string) => callsFor(table).map((call) => call.method),
    argFor: (table: string, method: string) =>
      callsFor(table).find((call) => call.method === method)?.args[0],
    argsFor: (table: string, method: string) =>
      callsFor(table)
        .filter((call) => call.method === method)
        .map((call) => call.args),
    rpcCalls,
  };
}


/** A signed-in `getUser()` response. */
export function signedInUser(id = "user-1", email = "owner@example.com") {
  return { data: { user: { id, email } }, error: null };
}

/** An anonymous `getUser()` response. */
export function signedOutUser() {
  return { data: { user: null }, error: null };
}

import { describe, expect, it } from "vitest";

import { readParam } from "@/lib/search-params";

describe("readParam", () => {
  it("returns a scalar value unchanged", () => {
    expect(readParam("acme")).toBe("acme");
    expect(readParam("")).toBe("");
  });

  it("takes the first value when the query key repeats", () => {
    // `?status=pending&status=confirmed`
    expect(readParam(["pending", "confirmed"])).toBe("pending");
  });

  it("returns undefined for a missing key", () => {
    expect(readParam(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty array", () => {
    expect(readParam([])).toBeUndefined();
  });

  it("handles a single-element array", () => {
    expect(readParam(["only"])).toBe("only");
  });
});

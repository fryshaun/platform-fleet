import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("drops falsy values", () => {
    expect(cn("px-2", false, null, undefined, "", "py-4")).toBe("px-2 py-4");
  });

  it("supports conditional objects", () => {
    expect(cn("base", { active: true, muted: false })).toBe("base active");
  });

  it("supports arrays", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("lets later Tailwind utilities win over earlier conflicting ones", () => {
    // This is the reason `cn` exists rather than plain template strings: a
    // caller-supplied `className` must be able to override a default.
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("keeps non-conflicting utilities from both sides", () => {
    expect(cn("px-2 font-bold", "py-1")).toBe("px-2 font-bold py-1");
  });

  it("resolves a conditional override in favour of the later class", () => {
    expect(cn("bg-red-500", { "bg-blue-500": true })).toBe("bg-blue-500");
  });
});

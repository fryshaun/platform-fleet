import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLES,
  canAdminister,
  canFrontDesk,
  canManage,
  isAssignableRole,
  isOwner,
  ROLE_LABELS,
  roleLabel,
} from "@/lib/roles";

const ROLES = ["owner", "admin", "manager", "staff", "member"] as const;

describe("role labels", () => {
  it("names the legacy member role Viewer", () => {
    expect(ROLE_LABELS.member).toBe("Viewer");
    expect(roleLabel("member")).toBe("Viewer");
  });

  it("labels every role", () => {
    for (const role of ROLES) {
      expect(roleLabel(role)).toBeTruthy();
    }
  });
});

describe("canAdminister", () => {
  it.each(["owner", "admin"] as const)("allows %s", (role) => {
    expect(canAdminister(role)).toBe(true);
  });

  it.each(["manager", "staff", "member"] as const)("denies %s", (role) => {
    expect(canAdminister(role)).toBe(false);
  });
});

describe("canManage", () => {
  it.each(["owner", "admin", "manager"] as const)("allows %s", (role) => {
    expect(canManage(role)).toBe(true);
  });

  it.each(["staff", "member"] as const)("denies %s", (role) => {
    expect(canManage(role)).toBe(false);
  });
});

describe("canFrontDesk", () => {
  it.each(["owner", "admin", "manager", "staff"] as const)(
    "allows %s",
    (role) => {
      expect(canFrontDesk(role)).toBe(true);
    },
  );

  it("denies a viewer", () => {
    expect(canFrontDesk("member")).toBe(false);
  });
});

describe("isOwner", () => {
  it("allows only the owner role", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("admin")).toBe(false);
    expect(isOwner("manager")).toBe(false);
    expect(isOwner("staff")).toBe(false);
    expect(isOwner("member")).toBe(false);
  });
});

describe("assignable roles", () => {
  it("offers manager, staff and viewer", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["manager", "staff", "member"]);
  });

  it("rejects ownership and admin rights", () => {
    expect(isAssignableRole("owner")).toBe(false);
    expect(isAssignableRole("admin")).toBe(false);
  });

  it("accepts every assignable role", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(isAssignableRole(role)).toBe(true);
    }
  });

  it("rejects anything that is not a role", () => {
    expect(isAssignableRole("banana")).toBe(false);
    expect(isAssignableRole(null)).toBe(false);
    expect(isAssignableRole(1)).toBe(false);
  });
});

describe("role hierarchy", () => {
  it("nests administration inside management inside front desk", () => {
    for (const role of ROLES) {
      if (canAdminister(role)) expect(canManage(role)).toBe(true);
      if (canManage(role)) expect(canFrontDesk(role)).toBe(true);
    }

    expect(canAdminister("manager")).toBe(false);
    expect(canManage("staff")).toBe(false);
    expect(canFrontDesk("member")).toBe(false);
  });

  it("reserves ownership for the owner alone", () => {
    expect(isOwner("owner")).toBe(true);
    expect(ROLES.filter((role) => role !== "owner").some(isOwner)).toBe(false);
  });
});

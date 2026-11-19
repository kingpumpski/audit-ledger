import { describe, expect, it } from "vitest";
import { getEffectiveRoles } from "./business-roles";

describe("getEffectiveRoles", () => {
  it("grants owners the complete business application role set", () => {
    expect(getEffectiveRoles([], "owner")).toEqual([
      "admin", "accountant", "cashier", "auditor",
    ]);
  });

  it("maps each non-owner membership to its least-privilege application role", () => {
    expect(getEffectiveRoles([], "admin")).toEqual(["admin"]);
    expect(getEffectiveRoles([], "accountant")).toEqual(["accountant"]);
    expect(getEffectiveRoles([], "cashier")).toEqual(["cashier"]);
    expect(getEffectiveRoles([], "auditor")).toEqual(["auditor"]);
  });

  it("uses active business membership as the authority instead of global legacy roles", () => {
    expect(getEffectiveRoles(["admin"], "cashier")).toEqual(["cashier"]);
  });

  it("uses global roles only for accounts without a business membership", () => {
    expect(getEffectiveRoles(["accountant", "cashier"])).toEqual([
      "accountant", "cashier",
    ]);
  });

  it("does not grant legacy global roles when a membership exists but is inactive or unknown", () => {
    expect(getEffectiveRoles(["admin", "accountant"], "suspended")).toEqual([]);
    expect(getEffectiveRoles(["admin"], "pending")).toEqual([]);
  });

  it("ignores unsupported role values", () => {
    expect(getEffectiveRoles(["root", "guest"], "unknown")).toEqual([]);
  });
});

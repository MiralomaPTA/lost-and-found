import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/form-state";

describe("safeNext", () => {
  it.each(["/", "/admin/settings", "/items/L-0142?from=grid", "/mine#claims"])("keeps the app path %j", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/ /evil.example",
    "https://evil.example/",
    "evil.example",
    "javascript:alert(1)",
    "",
    "/" + "a".repeat(250),
    null,
    42,
  ])("rejects %j", (value) => {
    expect(safeNext(value)).toBeNull();
  });
});

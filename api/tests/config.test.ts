import { describe, it, expect } from "vitest";
import { envBool } from "../src/config/index.js";

describe("config envBool", () => {
  it("parses true, 'true', '1' as true", () => {
    expect(envBool.parse(true)).toBe(true);
    expect(envBool.parse("true")).toBe(true);
    expect(envBool.parse("1")).toBe(true);
  });

  it("parses false, 'false', and other strings as false", () => {
    expect(envBool.parse(false)).toBe(false);
    expect(envBool.parse("false")).toBe(false);
    expect(envBool.parse("0")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { getSetting, listSettings, setSetting } from "@/lib/server/settings";

describe("settings", () => {
  it("sets, gets, and lists settings", () => {
    expect(getSetting("theme", "system")).toBe("system");

    setSetting("theme", "dark");
    setSetting("sidebar_collapsed", true);

    expect(getSetting("theme", "system")).toBe("dark");
    expect(getSetting("sidebar_collapsed", false)).toBe(true);

    const all = listSettings();
    expect(all.theme).toBe("dark");
    expect(all.sidebar_collapsed).toBe(true);
  });
});

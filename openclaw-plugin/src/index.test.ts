import { describe, expect, it } from "vitest";
import entry from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

describe("telemed-fastapi-tools", () => {
  it("declares tool metadata", () => {
    expect(getToolPluginMetadata(entry)?.tools.map((tool) => tool.name)).toEqual([
      "hospital_scheduler_step",
      "hospital_list_my_appointments",
      "hospital_cancel_appointment",
    ]);
  });
});

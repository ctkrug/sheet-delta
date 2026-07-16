import { describe, expect, it } from "vitest";
import { render } from "./main";

describe("render", () => {
  it("renders the wordmark and both drop zones", () => {
    const root = document.createElement("div");
    render(root);

    expect(root.querySelector(".wordmark")?.textContent).toContain("Sheet Delta");
    expect(root.querySelectorAll(".dropzone")).toHaveLength(2);
  });
});

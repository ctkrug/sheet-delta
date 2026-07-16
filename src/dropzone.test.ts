import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDropzone, type Dropzone } from "./dropzone";

/** Builds a DragEvent carrying files, the way a real drop does. */
function dragEventWithFiles(type: string, files: File[]): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: { files, dropEffect: "none", types: ["Files"] },
  });
  return event;
}

function csv(name: string): File {
  return new File(["id\n1\n"], name);
}

let onFile: ReturnType<typeof vi.fn>;
let onReject: ReturnType<typeof vi.fn>;
let zone: Dropzone;

beforeEach(() => {
  onFile = vi.fn();
  onReject = vi.fn();
  zone = createDropzone({ label: "Before", onFile, onReject });
  document.body.replaceChildren(zone.element);
});

describe("createDropzone", () => {
  it("renders its label and the accepted formats", () => {
    expect(zone.element.textContent).toContain("Before");
    expect(zone.element.textContent).toContain(".csv");
    expect(zone.element.textContent).toContain(".xlsx");
  });

  it("is a focusable native button, not a div in disguise", () => {
    expect(zone.element.tagName).toBe("BUTTON");
    expect(zone.element.getAttribute("aria-label")).toContain("Before");

    zone.element.focus();
    expect(document.activeElement).toBe(zone.element);
  });

  it("keeps the file input out of the tab order so Tab stops once", () => {
    const input = zone.element.querySelector("input")!;

    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens the file browser when clicked", () => {
    const input = zone.element.querySelector("input")!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    zone.element.click();

    expect(click).toHaveBeenCalledOnce();
  });

  it("hands over a dropped spreadsheet", () => {
    const file = csv("before.csv");

    zone.element.dispatchEvent(dragEventWithFiles("drop", [file]));

    expect(onFile).toHaveBeenCalledWith(file);
    expect(onReject).not.toHaveBeenCalled();
  });

  // Story 7: dropping an unsupported file explains what would work.
  it("rejects an unsupported file by naming the accepted formats", () => {
    zone.element.dispatchEvent(dragEventWithFiles("drop", [new File(["x"], "chart.png")]));

    expect(onFile).not.toHaveBeenCalled();
    const message = onReject.mock.calls[0][0] as string;
    expect(message).toContain("chart.png");
    expect(message).toContain(".csv");
    expect(message).toContain(".xlsx");
  });

  it("ignores a drop that carries no file", () => {
    zone.element.dispatchEvent(dragEventWithFiles("drop", []));

    expect(onFile).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  // Story 7: dragging over the zone shows a themed state before the drop.
  describe("drag state", () => {
    const isDragging = () => zone.element.classList.contains("dropzone--dragging");

    it("activates on dragenter and clears on dragleave", () => {
      zone.element.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
      expect(isDragging()).toBe(true);

      zone.element.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
      expect(isDragging()).toBe(false);
    });

    it("stays active while dragging across child elements", () => {
      // dragenter on a child bubbles to the zone, and the matching dragleave
      // on the parent must not clear the state early.
      zone.element.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
      zone.element.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
      zone.element.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));

      expect(isDragging()).toBe(true);
    });

    it("clears on drop", () => {
      zone.element.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
      zone.element.dispatchEvent(dragEventWithFiles("drop", [csv("a.csv")]));

      expect(isDragging()).toBe(false);
    });

    it("cancels dragover so the browser doesn't navigate to the file", () => {
      const event = dragEventWithFiles("dragover", [csv("a.csv")]);

      zone.element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(event.dataTransfer!.dropEffect).toBe("copy");
    });
  });

  it("shows the chosen file's name in place of the hint", () => {
    zone.setFileName("january.xlsx");

    expect(zone.element.textContent).toContain("january.xlsx");
    expect(zone.element.classList.contains("dropzone--loaded")).toBe(true);
    expect(zone.element.getAttribute("aria-label")).toContain("january.xlsx");
  });

  it("marks and unmarks the zone whose file failed", () => {
    zone.setInvalid(true);
    expect(zone.element.classList.contains("dropzone--invalid")).toBe(true);
    expect(zone.element.getAttribute("aria-invalid")).toBe("true");

    zone.setInvalid(false);
    expect(zone.element.classList.contains("dropzone--invalid")).toBe(false);
    expect(zone.element.hasAttribute("aria-invalid")).toBe(false);
  });
});

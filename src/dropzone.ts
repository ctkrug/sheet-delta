import { ACCEPT_ATTRIBUTE, ACCEPTED_EXTENSIONS, isAcceptedFile } from "./parse";

/**
 * A file drop zone that also opens the file browser on click or keypress.
 *
 * The zone is a real <button> wrapping a visually hidden <input type=file>,
 * so keyboard and assistive tech get the native file-picker behaviour for
 * free instead of a div pretending to be a control.
 */

export interface DropzoneOptions {
  /** Shown as the zone's title, e.g. "Before". */
  label: string;
  /** Called with a file the user chose or dropped and that looks parseable. */
  onFile(file: File): void;
  /** Called when the user picks something this tool can't read. */
  onReject(message: string): void;
}

export interface Dropzone {
  readonly element: HTMLElement;
  /** Shows the chosen file's name in place of the hint. */
  setFileName(name: string): void;
  /** Marks the zone as the one whose file failed. */
  setInvalid(invalid: boolean): void;
}

function acceptedList(): string {
  const exts = [...ACCEPTED_EXTENSIONS];
  return `${exts.slice(0, -1).join(", ")} or ${exts[exts.length - 1]}`;
}

export function createDropzone(options: DropzoneOptions): Dropzone {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "dropzone";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ACCEPT_ATTRIBUTE;
  input.className = "visually-hidden";
  input.tabIndex = -1;
  // The zone itself is the control; the input must not be separately
  // focusable or Tab would stop twice on the same thing.
  input.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "dropzone__label";
  title.textContent = options.label;

  const hint = document.createElement("span");
  hint.className = "dropzone__hint";
  hint.textContent = `Drop a file here, or click to browse`;

  const formats = document.createElement("span");
  formats.className = "dropzone__formats";
  formats.textContent = acceptedList();

  element.append(input, title, hint, formats);
  element.setAttribute("aria-label", `${options.label} file: drop a file here or click to browse`);

  const accept = (file: File | undefined): void => {
    if (!file) return;
    if (!isAcceptedFile(file.name)) {
      options.onReject(`"${file.name}" isn't a spreadsheet. Drop a ${acceptedList()} file instead.`);
      return;
    }
    options.onFile(file);
  };

  element.addEventListener("click", () => input.click());
  input.addEventListener("click", (event) => event.stopPropagation()); // the click above would recurse
  input.addEventListener("change", () => {
    accept(input.files?.[0]);
    // Reset so choosing the same file twice still fires a change event.
    input.value = "";
  });

  // Drag state is tracked with a counter, not a boolean: dragging over a
  // child fires dragleave on the parent, which would otherwise flicker the
  // active state off mid-drag.
  let depth = 0;
  const setDragging = (dragging: boolean): void => {
    element.classList.toggle("dropzone--dragging", dragging);
  };

  element.addEventListener("dragenter", (event) => {
    event.preventDefault();
    depth++;
    setDragging(true);
  });
  element.addEventListener("dragover", (event) => {
    // Without this the browser navigates to the file instead of dropping it.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  element.addEventListener("dragleave", (event) => {
    event.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) setDragging(false);
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    depth = 0;
    setDragging(false);
    accept(event.dataTransfer?.files?.[0]);
  });

  return {
    element,
    setFileName(name: string): void {
      hint.textContent = name;
      element.classList.add("dropzone--loaded");
      element.setAttribute("aria-label", `${options.label} file: ${name}, click to choose another`);
    },
    setInvalid(invalid: boolean): void {
      element.classList.toggle("dropzone--invalid", invalid);
      if (invalid) {
        element.setAttribute("aria-invalid", "true");
      } else {
        element.removeAttribute("aria-invalid");
      }
    },
  };
}

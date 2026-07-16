import * as XLSX from "xlsx";
import { SheetDeltaError, type Sheet, type Workbook } from "./types";

/** File extensions the tool accepts, for validation and error copy. */
export const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;

/** Rejects files this size or larger, before attempting to read them. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** The `accept` attribute for the file inputs. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",");

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

/** Reports whether a file name carries an extension the tool can parse. */
export function isAcceptedFile(fileName: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/** Reports whether a file is plain text, and so has no encoding of its own. */
function isTextFormat(fileName: string): boolean {
  return extensionOf(fileName) === ".csv";
}

function formatList(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Bytes that open a real spreadsheet container. */
const CONTAINER_MAGICS: readonly (readonly number[])[] = [
  [0x50, 0x4b], // "PK": the ZIP wrapper of .xlsx (and .ods)
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE2: legacy .xls
];

/** How much of a file is inspected to decide whether it is text. */
const SNIFF_BYTES = 4096;

/**
 * The share of undecodable bytes above which a file is treated as binary.
 *
 * Not zero: a CSV saved as Latin-1 rather than UTF-8 is still a CSV worth
 * reading, and it yields one bad byte per accented character. Real prose
 * stays far below this; binary formats blow through it immediately.
 */
const MAX_UNDECODABLE_SHARE = 0.1;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Reports whether bytes are binary data rather than text.
 *
 * SheetJS never rejects input: given anything it does not recognize, it
 * decodes the bytes as text and parses that into a one-column sheet. So a
 * JPEG named `data.csv` becomes a grid of mojibake instead of an error,
 * which is a worse answer than saying no. This is the check SheetJS omits.
 *
 * A NUL byte settles it (no text encoding this tool reads emits one), and
 * otherwise the test is how much of the sample fails to decode as UTF-8.
 */
function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, SNIFF_BYTES);
  if (sample.length === 0) return false;
  if (sample.includes(0x00)) return true;

  // A sample can cut a multi-byte character in half, so the tail's own
  // replacement characters are an artifact of sampling, not evidence.
  const text = new TextDecoder("utf-8").decode(sample);
  let undecodable = 0;
  for (const char of text) {
    if (char === "�") undecodable++;
  }
  return undecodable / text.length > MAX_UNDECODABLE_SHARE;
}

/**
 * Converts one SheetJS worksheet to our row/column model.
 *
 * Every cell is read as a formatted string rather than a JS value: the
 * engine's comparison rule is defined over text, and letting SheetJS coerce
 * types here would make `1` and `"1"` differ by which file they came from.
 * `defval: ""` keeps blank cells present so the grid stays rectangular, and
 * `blankrows` keeps spacer rows, which are real content in an export.
 */
function toSheet(worksheet: XLSX.WorkSheet): Sheet {
  const grid = XLSX.utils.sheet_to_json<string[]>(worksheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });

  const rows = grid.map((row) => (row ?? []).map((cell) => (cell == null ? "" : String(cell))));
  const [header = [], ...body] = rows;

  // Ragged rows are normal in real exports (trailing empties get dropped).
  // Pad to the widest row so a header shorter than its data still shows
  // every column rather than silently truncating the sheet.
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = (row: string[]): string[] =>
    row.length === width ? row : [...row, ...Array(width - row.length).fill("")];

  return { header: pad(header), rows: body.map(pad) };
}

/**
 * Parses a spreadsheet file into a workbook of named sheets.
 *
 * Throws {@link SheetDeltaError} for anything the user can act on: an
 * unsupported extension, an oversized file, an empty or corrupt workbook,
 * or binary data wearing a spreadsheet's extension. SheetJS reports
 * malformed input by throwing arbitrary errors, so those are caught and
 * restated in terms of the file the user actually dropped.
 */
export async function parseFile(file: File): Promise<Workbook> {
  if (!isAcceptedFile(file.name)) {
    throw new SheetDeltaError(
      `"${file.name}" isn't a spreadsheet Sheet Delta can read. Accepted formats: ${formatList(ACCEPTED_EXTENSIONS)}.`,
    );
  }
  if (file.size === 0) {
    throw new SheetDeltaError(`"${file.name}" is empty.`);
  }
  if (file.size >= MAX_FILE_BYTES) {
    throw new SheetDeltaError(
      `"${file.name}" is larger than ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB. Try exporting a smaller range.`,
    );
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // A file in a real spreadsheet container is SheetJS's to judge; anything
  // else has to read as text before it is worth handing over. Formats that
  // are neither, like the HTML tables some systems export as .xls, stay
  // welcome: they are text, so they pass this and SheetJS sorts them out.
  const isContainer = CONTAINER_MAGICS.some((magic) => startsWith(bytes, magic));
  if (!isContainer && looksBinary(bytes)) {
    throw new SheetDeltaError(
      `"${file.name}" doesn't look like a spreadsheet. Its contents are binary data rather than rows and columns.`,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    // A CSV is bytes with no declared encoding, and SheetJS guesses a legacy
    // single-byte codepage for them unless the file opens with a BOM. Excel
    // writes that BOM and most other exporters do not, so the same data from
    // two tools would decode differently and diff as changed on every row
    // with an accent in it. Decoding as UTF-8 here settles it in one place
    // and keeps SheetJS's codepage tables (and their weight) out of the
    // bundle. TextDecoder drops a leading BOM, which is a marker, not data.
    // .xlsx and .xls carry their own encoding and are handed over as bytes.
    workbook = isTextFormat(file.name)
      ? XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string", raw: false })
      : XLSX.read(buffer, { type: "array", raw: false });
  } catch (cause) {
    throw new SheetDeltaError(
      `"${file.name}" couldn't be read. It may be corrupt, password-protected, or not really a spreadsheet.`,
      cause,
    );
  }

  if (workbook.SheetNames.length === 0) {
    throw new SheetDeltaError(`"${file.name}" has no sheets in it.`);
  }

  const sheets: Record<string, Sheet> = {};
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    sheets[name] = worksheet ? toSheet(worksheet) : { header: [], rows: [] };
  }

  return { sheetNames: [...workbook.SheetNames], sheets, fileName: file.name };
}

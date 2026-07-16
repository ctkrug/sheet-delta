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
 * unsupported extension, an oversized file, an empty or corrupt workbook.
 * SheetJS reports malformed input by throwing arbitrary errors, so those
 * are caught and restated in terms of the file the user actually dropped.
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

  let workbook: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
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

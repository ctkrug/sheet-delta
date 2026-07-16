import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ACCEPTED_EXTENSIONS, isAcceptedFile, MAX_FILE_BYTES, parseFile } from "./parse";
import { SheetDeltaError } from "./types";

/** Builds a File the way the drop handler receives one. */
function fileOf(name: string, content: string | ArrayBuffer): File {
  return new File([content], name);
}

/** Builds a real .xlsx binary so the Excel path is exercised end to end. */
function xlsxFile(name: string, sheets: Record<string, string[][]>): File {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return fileOf(name, buffer);
}

describe("isAcceptedFile", () => {
  it("accepts every supported extension, case-insensitively", () => {
    for (const ext of ACCEPTED_EXTENSIONS) {
      expect(isAcceptedFile(`report${ext}`)).toBe(true);
      expect(isAcceptedFile(`report${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it("rejects unsupported and extensionless files", () => {
    for (const name of ["chart.png", "notes.txt", "archive.csv.zip", "README", ""]) {
      expect(isAcceptedFile(name)).toBe(false);
    }
  });
});

describe("parseFile — CSV", () => {
  // Story 2: a header row plus mixed types must survive parsing exactly.
  it("parses a header row and mixed-type cells to the source shape", async () => {
    const csv = "id,name,total\n1,Ada,100.5\n2,,\n3,Grace,-4\n";

    const workbook = await parseFile(fileOf("data.csv", csv));
    const sheet = workbook.sheets[workbook.sheetNames[0]];

    expect(sheet.header).toEqual(["id", "name", "total"]);
    expect(sheet.rows).toEqual([
      ["1", "Ada", "100.5"],
      ["2", "", ""],
      ["3", "Grace", "-4"],
    ]);
    expect(workbook.fileName).toBe("data.csv");
  });

  it("keeps quoted commas and embedded newlines inside their cell", async () => {
    const csv = 'id,note\n1,"Smith, Ada"\n2,"line one\nline two"\n';

    const sheet = (await parseFile(fileOf("q.csv", csv))).sheets.Sheet1;

    expect(sheet.rows[0]).toEqual(["1", "Smith, Ada"]);
    expect(sheet.rows[1]).toEqual(["2", "line one\nline two"]);
  });

  // Story 2: a malformed CSV shows an error state, and must not crash.
  it("reports an unterminated quote as a readable error, not a crash", async () => {
    const malformed = 'id,name\n1,"unterminated\n2,ok\n';

    // SheetJS is lenient and may recover rather than throw. Either way the
    // contract holds: a Sheet or a SheetDeltaError, never a raw crash.
    try {
      const sheet = (await parseFile(fileOf("bad.csv", malformed))).sheets.Sheet1;
      expect(Array.isArray(sheet.rows)).toBe(true);
      expect(sheet.header).toEqual(["id", "name"]);
    } catch (err) {
      expect(err).toBeInstanceOf(SheetDeltaError);
      expect((err as SheetDeltaError).message).toContain("bad.csv");
    }
  });

  it("keeps blank spacer rows, which are real content in an export", async () => {
    const sheet = (await parseFile(fileOf("s.csv", "id,note\n1,a\n,\n2,b\n"))).sheets.Sheet1;

    expect(sheet.rows).toEqual([
      ["1", "a"],
      ["", ""],
      ["2", "b"],
    ]);
  });

  it("pads ragged rows so every row matches the widest", async () => {
    const sheet = (await parseFile(fileOf("r.csv", "id,name,note\n1\n2,Grace\n"))).sheets.Sheet1;

    expect(sheet.rows).toEqual([
      ["1", "", ""],
      ["2", "Grace", ""],
    ]);
  });

  it("preserves leading zeros and long digit strings as text", async () => {
    const sheet = (await parseFile(fileOf("z.csv", "id,code\n1,007\n2,00123456789012345678\n")))
      .sheets.Sheet1;

    expect(sheet.rows[0][1]).toBe("007");
    expect(sheet.rows[1][1]).toBe("00123456789012345678");
  });
});

describe("parseFile — Excel", () => {
  // Story 3: an .xlsx workbook parses to the same shape as its CSV export.
  it("parses an .xlsx to the same shape as the equivalent CSV", async () => {
    const rows = [
      ["id", "name", "total"],
      ["1", "Ada", "100.5"],
      ["2", "Grace", "-4"],
    ];

    const fromXlsx = await parseFile(xlsxFile("book.xlsx", { Data: rows }));
    const fromCsv = await parseFile(fileOf("book.csv", rows.map((r) => r.join(",")).join("\n")));

    const a = fromXlsx.sheets[fromXlsx.sheetNames[0]];
    const b = fromCsv.sheets[fromCsv.sheetNames[0]];
    expect(a.header).toEqual(b.header);
    expect(a.rows).toEqual(b.rows);
  });

  // Story 3: a multi-sheet workbook exposes every sheet for the user to
  // pick from, in workbook order, defaulting to the first.
  it("exposes every sheet of a multi-sheet workbook in order", async () => {
    const workbook = await parseFile(
      xlsxFile("multi.xlsx", {
        Summary: [["a"], ["1"]],
        Detail: [["b"], ["2"]],
        Notes: [["c"], ["3"]],
      }),
    );

    expect(workbook.sheetNames).toEqual(["Summary", "Detail", "Notes"]);
    expect(workbook.sheets.Detail.header).toEqual(["b"]);
    expect(workbook.sheets.Notes.rows).toEqual([["3"]]);
  });

  it("reports a corrupt workbook as a readable error", async () => {
    const notASpreadsheet = fileOf("corrupt.xlsx", "PK this is not a workbook");

    await expect(parseFile(notASpreadsheet)).rejects.toBeInstanceOf(SheetDeltaError);
  });
});

describe("parseFile — input boundaries", () => {
  // Story 7: an unsupported file names the formats that would work.
  it("rejects an unsupported file by naming the accepted formats", async () => {
    const err = await parseFile(fileOf("chart.png", "x")).catch((e) => e);

    expect(err).toBeInstanceOf(SheetDeltaError);
    expect(err.message).toContain("chart.png");
    for (const ext of ACCEPTED_EXTENSIONS) {
      expect(err.message).toContain(ext);
    }
  });

  it("rejects an empty file", async () => {
    const err = await parseFile(fileOf("empty.csv", "")).catch((e) => e);

    expect(err).toBeInstanceOf(SheetDeltaError);
    expect(err.message).toContain("empty");
  });

  it("rejects an oversized file before trying to read it", async () => {
    // Reading a 100MB file to prove it is too big would defeat the check,
    // so the size is faked rather than allocated.
    const file = fileOf("huge.csv", "id\n1\n");
    Object.defineProperty(file, "size", { value: MAX_FILE_BYTES });

    const err = await parseFile(file).catch((e) => e);

    expect(err).toBeInstanceOf(SheetDeltaError);
    expect(err.message).toContain("huge.csv");
  });
});

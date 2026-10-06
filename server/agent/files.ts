import ExcelJS from "exceljs";
import type { UploadedFile } from "../../shared/protocol";

const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export type ImageType = (typeof imageTypes)[number];

const textExtensions = [
  ".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm",
  ".yaml", ".yml", ".log",
];

function isText(file: UploadedFile): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/xml") {
    return true;
  }
  const name = file.name.toLowerCase();
  return textExtensions.some((ext) => name.endsWith(ext));
}

export function isSpreadsheet(file: UploadedFile): boolean {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.name.toLowerCase().endsWith(".xlsx")
  );
}

/** Reads every sheet of an .xlsx file as rows of cell text. */
export async function readSpreadsheet(file: UploadedFile): Promise<{ sheet: string; rows: string[][] }[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(file.data, "base64") as unknown as ArrayBuffer);
  return workbook.worksheets.map((ws) => {
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const values = row.values as unknown[];
      rows.push(values.slice(1).map((v) => cellText(v)));
    });
    return { sheet: ws.name, rows };
  });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return cellText(v.result);
  }
  return String(value);
}

function csvCell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * An uploaded file in a form every model provider can send: images and PDFs
 * as base64, everything readable as text, and a note for unsupported formats.
 */
export type Attachment =
  | { kind: "image"; name: string; mimeType: ImageType; data: string }
  | { kind: "pdf"; name: string; data: string }
  | { kind: "text"; name: string; text: string }
  | { kind: "note"; text: string };

/** Turns one uploaded file into an attachment the model can read. */
export async function toAttachment(file: UploadedFile): Promise<Attachment> {
  if (isSpreadsheet(file)) {
    try {
      const sheets = await readSpreadsheet(file);
      const data = sheets
        .map((s) => `# ${s.sheet}\n` + s.rows.map((r) => r.map(csvCell).join(",")).join("\n"))
        .join("\n\n");
      return { kind: "text", name: file.name, text: data || "(boş cədvəl)" };
    } catch {
      return { kind: "note", text: `[Attached file "${file.name}" could not be read as an Excel workbook.]` };
    }
  }

  if ((imageTypes as readonly string[]).includes(file.type)) {
    return { kind: "image", name: file.name, mimeType: file.type as ImageType, data: file.data };
  }

  if (file.type === "application/pdf") {
    return { kind: "pdf", name: file.name, data: file.data };
  }

  if (isText(file)) {
    return { kind: "text", name: file.name, text: Buffer.from(file.data, "base64").toString("utf8") };
  }

  // Unsupported formats (docx, xls, ...) still reach the model by name so it
  // can tell the user, rather than the file silently disappearing.
  return {
    kind: "note",
    text: `[Attached file "${file.name}" (${file.type || "unknown type"}) cannot be read yet: this format is not supported.]`,
  };
}

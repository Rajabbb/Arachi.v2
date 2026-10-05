import type Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import type { UploadedFile } from "../../shared/protocol";

type Block = Anthropic.Beta.BetaContentBlockParam;

const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof imageTypes)[number];

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

/** Turns one uploaded file into a content block Claude can read. */
export async function fileToBlock(file: UploadedFile): Promise<Block> {
  if (isSpreadsheet(file)) {
    try {
      const sheets = await readSpreadsheet(file);
      const data = sheets
        .map((s) => `# ${s.sheet}\n` + s.rows.map((r) => r.map(csvCell).join(",")).join("\n"))
        .join("\n\n");
      return {
        type: "document",
        title: file.name,
        source: { type: "text", media_type: "text/plain", data: data || "(boş cədvəl)" },
      };
    } catch {
      return { type: "text", text: `[Attached file "${file.name}" could not be read as an Excel workbook.]` };
    }
  }

  if ((imageTypes as readonly string[]).includes(file.type)) {
    return {
      type: "image",
      source: { type: "base64", media_type: file.type as ImageType, data: file.data },
    };
  }

  if (file.type === "application/pdf") {
    return {
      type: "document",
      title: file.name,
      source: { type: "base64", media_type: "application/pdf", data: file.data },
    };
  }

  if (isText(file)) {
    return {
      type: "document",
      title: file.name,
      source: {
        type: "text",
        media_type: "text/plain",
        data: Buffer.from(file.data, "base64").toString("utf8"),
      },
    };
  }

  // Unsupported formats (docx, xls, ...) still reach the model by name so it
  // can tell the user, rather than the file silently disappearing.
  return {
    type: "text",
    text: `[Attached file "${file.name}" (${file.type || "unknown type"}) cannot be read yet: this format is not supported.]`,
  };
}

/** Builds the content of a user turn: files first, then the text. */
export async function userContent(text: string, files: UploadedFile[]): Promise<Block[]> {
  const blocks = await Promise.all(files.map(fileToBlock));
  if (text.trim()) blocks.push({ type: "text", text });
  return blocks;
}

import type Anthropic from "@anthropic-ai/sdk";
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

/** Turns one uploaded file into a content block Claude can read. */
export function fileToBlock(file: UploadedFile): Block {
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

  // Unsupported formats (docx, xlsx, ...) still reach the model by name so it
  // can tell the user, rather than the file silently disappearing.
  return {
    type: "text",
    text: `[Attached file "${file.name}" (${file.type || "unknown type"}) cannot be read yet: this format is not supported.]`,
  };
}

/** Builds the content of a user turn: files first, then the text. */
export function userContent(text: string, files: UploadedFile[]): Block[] {
  const blocks = files.map(fileToBlock);
  if (text.trim()) blocks.push({ type: "text", text });
  return blocks;
}

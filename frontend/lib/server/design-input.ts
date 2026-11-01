import { z } from "zod";
import { ApiError } from "./http";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DESIGN_BODY_BYTES = 7 * 1024 * 1024;

export const designInputSchema = z.object({
  input_type: z.enum(["text", "photo", "chatgpt_pet"]),
  text: z.string().trim().max(2000).default(""),
  image_data_url: z.string().nullable().default(null),
}).strict().superRefine((input, context) => {
  if (input.input_type === "text" && !input.text) {
    context.addIssue({ code: "custom", path: ["text"], message: "Describe your mascot first." });
  }
  if (input.input_type === "text" && input.image_data_url !== null) {
    context.addIssue({ code: "custom", path: ["image_data_url"], message: "Choose photo or ChatGPT pet mode for images." });
  }
  if (input.input_type !== "text" && !input.image_data_url) {
    context.addIssue({ code: "custom", path: ["image_data_url"], message: "Upload a screenshot or select one character frame first." });
  }
});

export type DesignInput = z.infer<typeof designInputSchema>;

export function validateImageDataUrl(dataUrl: string): void {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || match[2].length === 0 || match[2].length % 4 !== 0) {
    throw new ApiError(400, "INVALID_IMAGE", "Upload a valid PNG, JPEG, or WebP image.");
  }
  const payload = match[2];
  const estimatedSize = payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  if (estimatedSize > MAX_IMAGE_BYTES) {
    throw new ApiError(413, "IMAGE_TOO_LARGE", "Use an image of 5 MiB or less, or crop a smaller frame.");
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.toString("base64") !== payload) {
    throw new ApiError(400, "INVALID_IMAGE", "The image encoding is invalid. Upload the image again.");
  }
  const format = match[1];
  const valid = format === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : format === "jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new ApiError(400, "INVALID_IMAGE", "The image contents do not match its PNG, JPEG, or WebP format.");
}

export function parseDesignInput(value: unknown): DesignInput {
  const parsed = designInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_INPUT", "Check your description or selected image.",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`));
  }
  if (parsed.data.image_data_url) validateImageDataUrl(parsed.data.image_data_url);
  return parsed.data;
}

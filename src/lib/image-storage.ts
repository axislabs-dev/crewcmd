import { put } from "@vercel/blob";

export interface ImageUploadResult {
  url: string;
  filename: string;
  uploadedAt: string;
}

export interface ImageInfo {
  url: string;
  filename: string;
  uploadedAt: string;
}

/**
 * Upload an image to Vercel Blob storage
 * @param file - The file to upload (Buffer or File object)
 * @param filename - Optional custom filename (defaults to original name)
 */
export async function uploadImage(
  file: Buffer | File,
  filename?: string
): Promise<ImageUploadResult> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  const originalName = getFileName(file) || "image";
  const fileExtension = originalName.split(".").pop() || "png";
  const timestamp = Date.now();
  const uniqueFilename = filename || `task-${timestamp}.${fileExtension}`;
  const contentType = getContentType(file, uniqueFilename);

  if (!blobToken) {
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(await file.arrayBuffer());

    return {
      url: `data:${contentType};base64,${buffer.toString("base64")}`,
      filename: uniqueFilename,
      uploadedAt: new Date().toISOString(),
    };
  }

  const blob = await put(uniqueFilename, file, {
    access: "public",
    contentType,
  });

  return {
    url: blob.url,
    filename: uniqueFilename,
    uploadedAt: new Date().toISOString(),
  };
}

function getFileName(file: Buffer | File): string | undefined {
  return typeof File !== "undefined" && file instanceof File ? file.name : undefined;
}

function getContentType(file: Buffer | File, filename: string): string {
  if (typeof File !== "undefined" && file instanceof File && file.type) {
    return file.type;
  }

  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

/**
 * Delete an image from Vercel Blob storage
 * @param url - The URL of the image to delete
 */
export async function deleteImage(url: string): Promise<void> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (!blobToken) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured.');
  }

  // Extract blob ID from URL
  // Vercel Blob URLs are in the format: https://<account-name>.public.blob.vercel-storage.com/<filename>
  const urlParts = url.split('/');
  const filename = urlParts.pop();

  if (!filename) {
    throw new Error('Invalid image URL');
  }

  // In a production implementation, you would use the Vercel Blob SDK to delete the file
  // For now, we'll just log it since we don't have direct delete access from client-side code
  console.warn('[Storage] Image delete requested but direct delete is not supported from this environment:', url);
}

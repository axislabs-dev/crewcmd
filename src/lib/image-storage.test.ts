import { afterEach, describe, expect, it, vi } from "vitest";
import { put } from "@vercel/blob";
import { uploadImage } from "./image-storage";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

describe("uploadImage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  it("falls back to a data URL when Vercel Blob is not configured", async () => {
    const upload = await uploadImage(Buffer.from("avatar"), "avatar-user-1.webp");

    expect(upload).toEqual({
      url: `data:image/webp;base64,${Buffer.from("avatar").toString("base64")}`,
      filename: "avatar-user-1.webp",
      uploadedAt: expect.any(String),
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("uses Vercel Blob when a token is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    vi.mocked(put).mockResolvedValueOnce({
      url: "https://example.public.blob.vercel-storage.com/avatar.png",
    } as Awaited<ReturnType<typeof put>>);

    const upload = await uploadImage(Buffer.from("avatar"), "avatar-user-1.png");

    expect(put).toHaveBeenCalledWith("avatar-user-1.png", expect.any(Buffer), {
      access: "public",
      contentType: "image/png",
    });
    expect(upload.url).toBe("https://example.public.blob.vercel-storage.com/avatar.png");
  });
});

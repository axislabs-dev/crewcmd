import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { createVoiceUploadToken } from "@/lib/voice-upload-tokens";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { token, expiresAt } = createVoiceUploadToken();
  return Response.json({ token, expiresAt });
}

import { NextRequest, NextResponse } from "next/server";
import { listModelProfileCatalog } from "@/lib/model-profiles";
import { requireAuth } from "@/lib/require-auth";
import {
  createModelProfile,
  listAccessibleModelProfiles,
  serializeModelProfile,
} from "@/lib/model-profile-records";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const persistedProfiles = await listAccessibleModelProfiles(request);

  return NextResponse.json({
    profiles: listModelProfileCatalog(),
    persistedProfiles: persistedProfiles.map(serializeModelProfile),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const created = await createModelProfile(request, body);
    if (!created) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }
    return NextResponse.json({ profile: serializeModelProfile(created) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create model profile";
    const status = message === "workspace_required" || message.endsWith("_required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

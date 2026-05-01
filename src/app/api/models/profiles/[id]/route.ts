import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  deleteModelProfile,
  getAccessibleModelProfile,
  serializeModelProfile,
  updateModelProfile,
} from "@/lib/model-profile-records";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const profile = await getAccessibleModelProfile(request, id);
  if (!profile) {
    return NextResponse.json({ error: "Model profile not found" }, { status: 404 });
  }

  return NextResponse.json({ profile: serializeModelProfile(profile) });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const profile = await getAccessibleModelProfile(request, id);
  if (!profile) {
    return NextResponse.json({ error: "Model profile not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const updated = await updateModelProfile(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Model profile not found" }, { status: 404 });
    }
    return NextResponse.json({ profile: serializeModelProfile(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update model profile";
    const status = message.endsWith("_required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const profile = await getAccessibleModelProfile(request, id);
  if (!profile) {
    return NextResponse.json({ error: "Model profile not found" }, { status: 404 });
  }

  const deleted = await deleteModelProfile(id);
  if (!deleted) {
    return NextResponse.json({ error: "Model profile not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

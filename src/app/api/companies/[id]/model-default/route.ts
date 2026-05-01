import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  canReadCompanyModelDefault,
  canWriteCompanyModelDefault,
  deleteCompanyModelDefault,
  getCompanyModelDefault,
  serializeCompanyModelDefault,
  setCompanyModelDefault,
} from "@/lib/company-model-defaults";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!(await canReadCompanyModelDefault(id))) {
    return NextResponse.json({ error: "Company model default not found" }, { status: 404 });
  }

  const defaultRecord = await getCompanyModelDefault(id);
  return NextResponse.json({ default: serializeCompanyModelDefault(defaultRecord) });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!(await canWriteCompanyModelDefault(id))) {
    return NextResponse.json({ error: "Only company admins can update model defaults" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const defaultRecord = await setCompanyModelDefault(id, body);
    if (!defaultRecord) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }
    return NextResponse.json({ default: serializeCompanyModelDefault(defaultRecord) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update model default";
    const status = message === "model_profile_not_found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!(await canWriteCompanyModelDefault(id))) {
    return NextResponse.json({ error: "Only company admins can clear model defaults" }, { status: 403 });
  }

  await deleteCompanyModelDefault(id);
  return NextResponse.json({ ok: true });
}

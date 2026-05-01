import { NextResponse } from "next/server";
import { listModelProfileCatalog } from "@/lib/model-profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    profiles: listModelProfileCatalog(),
  });
}

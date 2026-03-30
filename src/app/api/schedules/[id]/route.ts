import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

function execOpenClaw(command: string): boolean {
  try {
    execSync(`openclaw ${command}`, {
      timeout: 15000,
      encoding: "utf-8",
      env: { ...process.env },
    });
    return true;
  } catch (err) {
    console.error(`[api/schedules] Failed to exec: openclaw ${command}`, err);
    return false;
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
    }

    const command = enabled ? "cron enable" : "cron disable";
    const success = execOpenClaw(`${command} ${id}`);

    if (!success) {
      return NextResponse.json({ error: "Failed to update cron job" }, { status: 500 });
    }

    return NextResponse.json({ id, enabled });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

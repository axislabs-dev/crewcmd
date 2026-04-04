import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
  const uptime = Math.floor(process.uptime());

  let database: "connected" | "error" = "connected";
  let status: "ok" | "degraded" = "ok";
  let error: string | undefined;

  try {
    if (!db) throw new Error("No database connection configured");
    await db.execute(sql`SELECT 1`);
  } catch (e) {
    database = "error";
    status = "degraded";
    error = e instanceof Error ? e.message : "Unknown database error";
  }

  const body: Record<string, unknown> = {
    status,
    version,
    database,
    uptime,
    timestamp,
  };

  if (error) body.error = error;

  return NextResponse.json(body, { status: status === "ok" ? 200 : 503 });
}

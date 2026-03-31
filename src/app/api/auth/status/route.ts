import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    if (!db) {
      return NextResponse.json({ hasUsers: false });
    }

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);
    const totalUsers = Number(countResult[0]?.count ?? 0);

    return NextResponse.json({ hasUsers: totalUsers > 0 });
  } catch {
    return NextResponse.json({ hasUsers: false });
  }
}

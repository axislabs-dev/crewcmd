import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

interface RunEntry {
  ts: string;
  jobId: string;
  action: string;
  status: string;
  summary?: string;
  error?: string;
  delivered?: boolean;
  deliveryStatus?: string;
  sessionId?: string;
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job_id");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20, 100);

  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  const runsPath = join(homedir(), ".openclaw", "cron", "runs", `${jobId}.jsonl`);

  if (!existsSync(runsPath)) {
    return NextResponse.json({ runs: [] });
  }

  try {
    const content = readFileSync(runsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const finished: {
      ts: string;
      status: string;
      summary?: string;
      error?: string;
      sessionId?: string;
    }[] = [];

    for (const line of lines) {
      try {
        const entry: RunEntry = JSON.parse(line);
        if (entry.action === "finished") {
          finished.push({
            ts: entry.ts,
            status: entry.status,
            summary: entry.summary,
            error: entry.error,
            sessionId: entry.sessionId,
          });
        }
      } catch {
        // skip malformed lines
      }
    }

    // Sort by timestamp descending, take most recent N
    finished.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    const runs = finished.slice(0, limit);

    return NextResponse.json({ runs });
  } catch (err) {
    console.error("[api/automations/runs] Error:", err);
    return NextResponse.json({ error: "Failed to read run history" }, { status: 500 });
  }
}

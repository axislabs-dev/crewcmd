import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NODE_AGENT_MAP: Record<string, { emoji: string; callsign: string; color: string; role: string }[]> = {
  "Mac Mini M4 (Trading Floor)": [
    { emoji: "🎰", callsign: "Maverick", color: "#f0ff00", role: "CFO & Quantitative Strategy" },
    { emoji: "🧬", callsign: "Axiom", color: "#00ffcc", role: "Quant R&D Engineer" },
  ],
  "Mac Mini i7 (War Room)": [
    { emoji: "⚡", callsign: "Cipher", color: "#f0ff00", role: "CTO & Engineering" },
    { emoji: "🔨", callsign: "Forge", color: "#ff8844", role: "Senior Full-Stack Engineer" },
    { emoji: "⚡", callsign: "Blitz", color: "#44ddff", role: "Senior Full-Stack Engineer" },
    { emoji: "🔥", callsign: "Havoc", color: "#ff6600", role: "CMO & Marketing" },
    { emoji: "✂️", callsign: "Razor", color: "#ff00aa", role: "Video & Visual Assets" },
  ],
};

export async function GET() {
  return NextResponse.json(NODE_AGENT_MAP);
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    Object.assign(NODE_AGENT_MAP, body);
    return NextResponse.json(NODE_AGENT_MAP);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

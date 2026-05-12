import { redirect } from "next/navigation";

export default async function AgentDetailRedirect({
  params,
}: {
  params: Promise<{ callsign: string }>;
}) {
  const { callsign } = await params;
  redirect(`/team?agent=${encodeURIComponent(callsign)}`);
}

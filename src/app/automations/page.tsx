import { redirect } from "next/navigation";

/**
 * /automations redirects to /routines which contains the full automations UI.
 * The sidebar links here but the actual implementation lives at /routines.
 */
export default function AutomationsPage() {
  redirect("/routines");
}

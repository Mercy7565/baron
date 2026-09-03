import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The campaigns console lives under /merchant now. */
export default function LegacyCampaigns() {
  redirect("/merchant/campaigns");
}

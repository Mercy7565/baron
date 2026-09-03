import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The orchestrator used to be its own page, scoring campaigns against whatever
 * happened to be in the single demo cart. That framing was wrong: a merchant
 * runs a store, not one basket, and a page that reasons about one shopper's
 * cart cannot tell them whether a campaign is working. The orchestrator now
 * lives on Campaigns, scored on what actually fired.
 *
 * Kept as a redirect so existing links and bookmarks land somewhere useful.
 */
export default function MerchantOrchestrator(): never {
  redirect("/merchant/campaigns");
}

import { testCardDisplay } from "@countersign/vault";

import { WALLET_FINE, WALLET_HEADLINE, WALLET_TRUTH } from "@/lib/copy";

import { WalletClient } from "./WalletClient";

import { StoreChrome } from "@/components/StoreChrome";

export const dynamic = "force-dynamic";

export default function WalletPage() {
  return (
    <StoreChrome>
      <h1 style={{ fontSize: 38 }}>{WALLET_HEADLINE}</h1>
        <p className="judge-note">
          The card vault, ready for the day server-to-server charge is enabled. The assistant never
          sees the number, today or then.
        </p>
      <p className="st-lede">{WALLET_TRUTH}</p>
      {/* The digits come from the single vault constant, never written here. */}
      <WalletClient testCard={testCardDisplay()} truth={WALLET_TRUTH} fine={WALLET_FINE} />
    </StoreChrome>
  );
}

import { Logo } from "@/components/Logo";

import { LoginClient } from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; need?: string }>;
}) {
  const { next, need } = await searchParams;

  return (
    <div data-surface="stage" style={{ display: "grid", placeItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 620, padding: 28 }}>
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Logo height={34} />
          </div>
          <p style={{ marginTop: 8, color: "var(--nl-mint-64)" }}>
            One site, two jobs. Pick the one you are here to do.
          </p>
        </div>

        <LoginClient next={next ?? null} need={need ?? null} />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { CopyBlock } from "./CopyBlock";

/**
 * The Action schema URL, taken from the browser's own origin.
 *
 * Reading `window.location.origin` means the deployed page shows the deployed
 * host with no configuration — and a laptop shows `localhost`, which a Custom
 * GPT genuinely cannot reach. The helper below only appears in that case, so a
 * live deployment shows a clean https URL and nothing else.
 */
export function SchemaUrl() {
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (origin === null) {
    return (
      <p className="st-muted" style={{ fontSize: 14 }}>
        Reading this page&rsquo;s address…
      </p>
    );
  }

  const isLocal = origin.includes("localhost");

  return (
    <>
      <CopyBlock label="Action schema" value={`${origin}/api/agent/openapi.yaml`} />
      {isLocal && (
        <p className="st-muted" style={{ fontSize: 14, margin: "0 0 4px" }}>
          This is a <code>localhost</code> address. A Custom GPT runs on OpenAI&rsquo;s servers and
          cannot reach it — deploy first, then open this page on the deployed host and the URL above
          will be the right one.
        </p>
      )}
    </>
  );
}

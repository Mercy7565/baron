"use client";

import { useState } from "react";

/** A value a judge should be able to take to ChatGPT without retyping it. */
export function CopyBlock({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the text is selectable either way.
    }
  }

  return (
    <div style={{ margin: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span className="st-muted" style={{ fontSize: 13 }}>
          {label}
        </span>
        <button
          className="st-btn st-btn--quiet"
          style={{ fontSize: 13, padding: "5px 12px" }}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 14,
          border: "1px solid var(--nl-ink)",
          borderRadius: 8,
          background: "var(--nl-mint)",
          color: "var(--nl-ink)",
          fontSize: 13,
          whiteSpace: multiline ? "pre-wrap" : "pre",
          overflowX: "auto",
          maxHeight: multiline ? 260 : undefined,
          overflowY: multiline ? "auto" : undefined,
        }}
      >
        {value}
      </pre>
    </div>
  );
}

"use client";

import { type ReactNode, useState } from "react";

/**
 * The raw machinery, folded away by default.
 *
 * A shopper should see a shop. A judge should be one click from the verdict,
 * the ignored inputs and the JSON — without either audience getting the other's
 * experience by accident.
 */
export function Evidence({ children, label = "Evidence" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="nl-evidence">
      <button
        className="nl-btn nl-btn--ghost"
        style={{ fontSize: 13, padding: "6px 14px" }}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? `Hide ${label.toLowerCase()}` : label}
      </button>
      {open && <div style={{ marginTop: "var(--space-2)" }}>{children}</div>}
    </div>
  );
}

"use client";

import { useState } from "react";

const FALLBACK = "/products/placeholder.svg";

/**
 * A product photo that cannot render as a broken icon.
 *
 * Most catalog images are remote. A remote URL can rot — the id changes, the
 * host blocks the referrer, the network is unreachable — and the browser's
 * default answer to that is a torn-page glyph, which reads as a broken store.
 * One failed load swaps in a local placeholder instead, and the swap only ever
 * happens once so a failing fallback cannot loop.
 */
export function ProductImage({
  src,
  alt,
  className,
  loading,
}: {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);

  return (
    <img
      className={className}
      src={failed ? FALLBACK : src}
      alt={alt}
      loading={loading ?? "lazy"}
      onError={() => setFailed(true)}
    />
  );
}

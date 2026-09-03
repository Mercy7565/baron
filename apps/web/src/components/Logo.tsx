/**
 * The wordmark. It already reads "Baron", so nothing beside it may repeat the
 * name — the image is the whole brand mark.
 */
export function Logo({ height = 26, href }: { height?: number; href?: string }) {
  const img = (
    <img
      src="/baron-logo.png"
      alt="Baron"
      style={{ height, width: "auto", display: "block" }}
    />
  );

  return href === undefined ? img : (
    <a href={href} style={{ display: "inline-block", lineHeight: 0 }}>
      {img}
    </a>
  );
}

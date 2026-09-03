/**
 * The identity of a basket.
 *
 * Sorted `sku_id:qty` pairs, joined. Two baskets with the same fingerprint are
 * the same purchase; anything else — a line added, a quantity nudged, a line
 * removed — is a different purchase and must not inherit the other's price or
 * its Payment Link.
 *
 * Deliberately not a hash: a merchant reading a log should be able to see what
 * the basket was without a lookup.
 */
export function cartFingerprint(lines: Array<{ sku_id: string; qty: number }>): string {
  return lines
    .filter((l) => l.qty > 0)
    .map((l) => `${l.sku_id}:${l.qty}`)
    .sort()
    .join("|");
}

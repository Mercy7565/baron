import type { Availability as AvailabilityValue } from "@countersign/catalog";

export function Availability({ value, stock }: { value: AvailabilityValue; stock: number }) {
  const inStock = value === "in_stock" && stock > 0;
  return (
    <span className="cs-badge" data-tone={inStock ? "ok" : "danger"} data-availability={value}>
      {inStock ? `in stock (${stock})` : "out of stock"}
    </span>
  );
}

import { Price } from "./Price";

export function CartLine({
  skuId,
  title,
  qty,
  unitPaise,
  totalPaise,
}: {
  skuId: string;
  title: string;
  qty: number;
  unitPaise: number;
  totalPaise: number;
}) {
  return (
    <div className="cs-row" data-sku={skuId} style={{ justifyContent: "space-between" }}>
      <span>
        {title} <span className="cs-muted">× {qty}</span>
      </span>
      <span className="mono">
        <Price paise={unitPaise} /> → <Price paise={totalPaise} />
      </span>
    </div>
  );
}

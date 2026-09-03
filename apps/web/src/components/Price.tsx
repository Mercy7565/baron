/** Renders integer paise. Never accepts a float or a rupee string. */
export function Price({ paise, className }: { paise: number; className?: string }) {
  const rupees = (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <span className={className} data-price-paise={paise}>
      ₹{rupees}
    </span>
  );
}

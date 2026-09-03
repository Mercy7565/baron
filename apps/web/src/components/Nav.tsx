const LINKS: Array<[string, string]> = [
  ["/", "store"],
  ["/cart", "cart"],
  ["/campaigns", "campaigns"],
  ["/policy", "policy"],
  ["/audit", "audit"],
  ["/failures", "failures"],
  ["/protocols", "protocols"],
  ["/lab", "lab"],
];

export function Nav() {
  return (
    <nav className="cs-nav" aria-label="main">
      <strong>CounterSign</strong>
      {LINKS.map(([href, label]) => (
        <a key={href} href={href}>
          {label}
        </a>
      ))}
      <a href="/catalog.json" className="cs-muted">
        catalog.json
      </a>
    </nav>
  );
}

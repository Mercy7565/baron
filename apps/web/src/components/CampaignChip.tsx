export function CampaignChip({
  id,
  name,
  active,
  inWindow,
}: {
  id: string;
  name: string;
  active: boolean;
  inWindow: boolean;
}) {
  const live = active && inWindow;
  const tone = live ? "ok" : active ? "warn" : undefined;
  const label = live ? "live" : active ? "outside window" : "off";

  return (
    <span className="cs-badge" data-tone={tone} data-campaign={id} title={id}>
      {name} · {label}
    </span>
  );
}

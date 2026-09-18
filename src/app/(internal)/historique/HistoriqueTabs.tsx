import Link from "next/link";
import { Icon } from "@/components/Icon";

/**
 * Les deux cases de l'historique : ce qui s'est passé avec le client, et ce
 * qui a été commandé à la production. Le client choisi suit d'une case à
 * l'autre, pour comparer sans le rechercher.
 */
export function HistoriqueTabs({
  active,
  clientId,
}: {
  active: "clients" | "production";
  clientId?: string | null;
}) {
  const query = clientId ? `?client=${encodeURIComponent(clientId)}` : "";
  const tabs = [
    { key: "clients", href: `/historique${query}`, label: "Fiches clients", icon: "clock" },
    { key: "production", href: `/historique/production${query}`, label: "Production", icon: "layers" },
  ] as const;

  return (
    <nav
      className="no-print grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-[#e9eff6] p-1.5 shadow-inner sm:max-w-md"
      aria-label="Historique"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors duration-200 ${
            active === tab.key
              ? "bg-white text-[#0b4f88] shadow-[0_4px_14px_rgba(34,72,112,.12)]"
              : "text-ink-faint hover:bg-white/55 hover:text-ink-soft"
          }`}
        >
          <Icon name={tab.icon} className="h-4 w-4"/>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

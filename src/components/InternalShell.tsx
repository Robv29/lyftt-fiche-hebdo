"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { BrandLogo } from "./BrandLogo";

type NavItem = { href: string; label: string; icon: string; badge?: number | null };

export function InternalShell({ children, profile, links }: { children: React.ReactNode; profile: { name: string; role: string }; links: NavItem[] }) {
  const pathname = usePathname();
  const initials = profile.name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const currentSection = links.find((link) => link.href === "/" ? pathname === "/" : pathname.startsWith(link.href))?.label ?? "LYFTT";
  const ticketLink = links.find((link) => link.href === "/retours");
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(new Date());
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <Link href="/" className="brand" aria-label="LYFTT, accueil"><BrandLogo className="w-[88px]" priority /></Link>
          <p>Production sociale</p>
        </div>
        <nav className="side-nav" aria-label="Navigation principale">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return <Link key={link.href} href={link.href} className={active ? "nav-item active" : "nav-item"}><Icon name={link.icon} className="nav-icon"/><span>{link.label}</span>{Boolean(link.badge) && <b>{link.badge}</b>}</Link>;
          })}
        </nav>
        <div className="profile-chip"><span>{initials}</span><div><strong>{profile.name}</strong><small>{profile.role}</small></div><Icon name="arrow" className="profile-arrow"/></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-context"><BrandLogo variant="ink" className="topbar-mobile-logo"/><span>{currentSection}</span><small>{today}</small></div>
          <div className="topbar-actions">
            {ticketLink && <Link href="/retours" className="topbar-icon" aria-label={`${ticketLink.badge ?? 0} ticket(s) client à traiter`}><Icon name="bell"/>{Boolean(ticketLink.badge) && <b>{ticketLink.badge}</b>}</Link>}
            <div className="topbar-profile"><span>{initials}</span><div><strong>{profile.name}</strong><small>{profile.role}</small></div></div>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
      {/*
        La barre défile horizontalement plutôt que de tronquer la liste : avec
        `slice(0, 5)`, Production, Indicateurs et Équipe n'étaient accessibles
        depuis aucun écran sur téléphone.
      */}
      <nav className="mobile-nav" aria-label="Navigation mobile">
        {links.map((link) => { const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href); return <Link key={link.href} href={link.href} className={active ? "active" : ""}><Icon name={link.icon}/><span>{link.label.split(" ")[0]}</span>{Boolean(link.badge) && <b>{link.badge}</b>}</Link>; })}
      </nav>
    </div>
  );
}

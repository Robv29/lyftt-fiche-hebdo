"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

type NavItem = { href: string; label: string; icon: string; badge?: number | null };

export function InternalShell({ children, profile, links }: { children: React.ReactNode; profile: { name: string; role: string }; links: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="LYFTT, accueil"><span>lyftt</span><i>.</i></Link>
        <nav className="side-nav" aria-label="Navigation principale">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return <Link key={link.href} href={link.href} className={active ? "nav-item active" : "nav-item"}><Icon name={link.icon} className="nav-icon"/><span>{link.label}</span>{Boolean(link.badge) && <b>{link.badge}</b>}</Link>;
          })}
        </nav>
        <div className="profile-chip"><span>{profile.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span><div><strong>{profile.name}</strong><small>{profile.role}</small></div></div>
      </aside>
      <main className="main-content">{children}</main>
      <nav className="mobile-nav" aria-label="Navigation mobile">
        {links.slice(0, 5).map((link) => { const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href); return <Link key={link.href} href={link.href} className={active ? "active" : ""}><Icon name={link.icon}/><span>{link.label.split(" ")[0]}</span>{Boolean(link.badge) && <b>{link.badge}</b>}</Link>; })}
      </nav>
    </div>
  );
}

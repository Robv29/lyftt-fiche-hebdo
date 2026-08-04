import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Icon } from "@/components/Icon";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("clients").select(`id, name, logo_url, is_active, whatsapp_group_name, validation_deadline_weekday, validation_deadline_time, approval_policy, client_contacts ( first_name, last_name, email, is_primary ), weekly_sheets ( id, status, iso_week )`).order("name");
  if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
  const { data: clients } = await query;

  return <div className="space-y-7">
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Portefeuille</p><h1 className="page-title mt-1">Clients</h1><p className="mt-2 text-sm text-ink-soft">Rythmes éditoriaux, contacts et suivi des prestations.</p></div>
    </header>
    <form className="relative max-w-md"><Icon name="search" className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-ink-faint"/><input name="q" defaultValue={q} className="field pl-10" placeholder="Rechercher un client…" aria-label="Rechercher un client"/></form>
    {!clients?.length ? <div className="card flex min-h-64 flex-col items-center justify-center p-8 text-center"><span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#edf4ff] text-[#1468ff]"><Icon name="users" className="h-6 w-6"/></span><h2 className="font-semibold">Aucun client trouvé</h2><p className="mt-1 max-w-sm text-sm text-ink-faint">Ajoutez votre premier client pour générer automatiquement ses prochaines fiches.</p></div> :
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{clients.map(client => {
        const contacts = client.client_contacts as unknown as { first_name:string; last_name:string|null; email:string|null; is_primary:boolean }[];
        const sheets = client.weekly_sheets as unknown as { id:string; status:string; iso_week:number }[];
        const primary = contacts?.find(c=>c.is_primary) ?? contacts?.[0];
        const open = sheets?.filter(s=>!["approved_by_client","tacitly_approved","rejected","expired"].includes(s.status)).length ?? 0;
        return <Link href={`/clients/${client.id}`} key={client.id} className="card lift-card group p-5">
          <div className="flex items-start justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#edf2f8] text-sm font-bold text-[#46546a]">{client.name.slice(0,2).toUpperCase()}</span><span className={client.is_active ? "badge bg-state-approved/10 text-state-approved" : "badge bg-canvas text-ink-faint"}>{client.is_active ? "Actif" : "En pause"}</span></div>
          <h2 className="mt-5 text-lg font-semibold tracking-[-.02em]">{client.name}</h2><p className="mt-1 text-sm text-ink-faint">{primary ? `${primary.first_name} ${primary.last_name ?? ""}` : "Contact à compléter"}</p>
          <div className="mt-5 flex items-center justify-between border-t pt-4 text-xs text-ink-soft"><span>{open ? `${open} fiche${open>1?"s":""} en cours` : "À jour"}</span><span className="reveal-on-card-hover flex items-center gap-1 font-semibold text-[#0759e6]">Ouvrir <Icon name="arrow" className="h-3 w-3"/></span></div>
        </Link>;
      })}</div>}
  </div>;
}

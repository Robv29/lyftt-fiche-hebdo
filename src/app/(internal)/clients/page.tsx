import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { ClientAdmin } from "./ClientAdmin";
import { resolveClientLogoUrl } from "@/lib/media/client-logo";

export default async function ClientsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createSupabaseServerClient();

  const [{ data: clients }, { data: managers }] = await Promise.all([
    supabase.from("clients").select("id, name, logo_url, notes, is_active, validation_deadline_weekday, validation_deadline_time, approval_policy, contract_start_date, contract_end_date, pause_start_date, pause_end_date, client_contacts ( first_name, last_name, phone ), client_assignments ( role, profiles ( full_name ) )").order("name"),
    supabase.from("profiles").select("id, full_name").in("role", ["community_manager", "super_admin", "production_manager"]).eq("is_active", true).order("full_name"),
  ]);

  return <div className="space-y-7">
    <header><p className="eyebrow">Portefeuille</p><h1 className="page-title mt-1">Clients</h1><p className="mt-2 text-sm text-ink-soft">Cadrez les contacts, échéances et règles de validation avant de produire.</p></header>
    <ClientAdmin clients={await Promise.all((clients ?? []).map(async (c) => {
      const contact = (c.client_contacts as unknown as { first_name:string; last_name:string|null; phone:string|null }[])?.[0];
      const assignments = (c.client_assignments as unknown as { role:string; profiles:{full_name:string}|null }[]) ?? [];
      let settings: { monthlyCadence?: { photo?:number; video?:number; story?:number; visual?:number } } = {};
      try { settings = typeof c.notes === "string" ? JSON.parse(c.notes) : {}; } catch { settings = {}; }
      const cadence = settings.monthlyCadence ?? {};
      return { id:c.id, name:c.name, isActive:c.is_active, deadlineWeekday:c.validation_deadline_weekday, deadlineTime:c.validation_deadline_time, approvalPolicy:c.approval_policy, contactName:contact ? `${contact.first_name} ${contact.last_name ?? ""}`.trim() : null, managerName:assignments.find((assignment)=>assignment.role==="community_manager")?.profiles?.full_name ?? "Non assigné", contractStartDate:c.contract_start_date, contractEndDate:c.contract_end_date, pauseStartDate:c.pause_start_date, pauseEndDate:c.pause_end_date, logoUrl:await resolveClientLogoUrl(c.logo_url), cadenceLabel:`${Number(cadence.photo??0)} photo · ${Number(cadence.video??0)} vidéo · ${Number(cadence.story??0)} story · ${Number(cadence.visual??0)} visuel` };
    }))} managers={(managers ?? []).map((m) => ({ id:m.id, name:m.full_name }))}/>
  </div>;
}

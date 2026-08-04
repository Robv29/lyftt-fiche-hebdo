import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { ClientAdmin } from "./ClientAdmin";

export default async function ClientsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createSupabaseServerClient();

  const [{ data: clients }, { data: managers }] = await Promise.all([
    supabase.from("clients").select("id, name, is_active, validation_deadline_weekday, validation_deadline_time, approval_policy, client_contacts ( first_name, last_name, phone )").order("name"),
    supabase.from("profiles").select("id, full_name").in("role", ["community_manager", "super_admin", "production_manager"]).eq("is_active", true).order("full_name"),
  ]);

  return <div className="space-y-7">
    <header><p className="eyebrow">Portefeuille</p><h1 className="page-title mt-1">Clients</h1><p className="mt-2 text-sm text-ink-soft">Cadrez les contacts, échéances et règles de validation avant de produire.</p></header>
    <ClientAdmin clients={(clients ?? []).map((c) => {
      const contact = (c.client_contacts as unknown as { first_name:string; last_name:string|null; phone:string|null }[])?.[0];
      return { id:c.id, name:c.name, isActive:c.is_active, deadlineWeekday:c.validation_deadline_weekday, deadlineTime:c.validation_deadline_time, approvalPolicy:c.approval_policy, contactName:contact ? `${contact.first_name} ${contact.last_name ?? ""}`.trim() : null };
    })} managers={(managers ?? []).map((m) => ({ id:m.id, name:m.full_name }))}/>
  </div>;
}

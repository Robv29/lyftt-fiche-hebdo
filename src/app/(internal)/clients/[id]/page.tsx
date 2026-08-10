import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { sheetStatusLabel, SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/domain/types";
import { LYFTT_CLIENT_TYPE_IDS, type LyfttClientType } from "@/lib/domain/hashtags";
import { Icon } from "@/components/Icon";
import { ClientEditor } from "./ClientEditor";
import { resolveClientLogoUrl } from "@/lib/media/client-logo";

const weekDays = ["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];
const brandTones = ["chaleureux","premium","expert","dynamique","institutionnel"] as const;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  const [{ data: client }, { data: managers }] = await Promise.all([
    supabase.from("clients").select(`id, name, logo_url, notes, timezone, is_active, approval_policy, tacit_approval_notice, validation_deadline_weekday, validation_deadline_time, reminders_enabled, reminder_channel_email, reminder_channel_whatsapp, whatsapp_group_name, post_signature, client_contacts ( id, first_name, last_name, email, phone, role_label, is_primary ), client_assignments ( role, profiles ( id, full_name ) ), weekly_sheets ( id, iso_week, iso_year, status, period_start, weekly_sheet_items ( id, publication_type, format, hashtags ) )`).eq("id",id).maybeSingle(),
    supabase.from("profiles").select("id, full_name").in("role", ["community_manager", "super_admin", "production_manager"]).eq("is_active", true).order("full_name"),
  ]);
  if (!client) notFound();
  const clientLogoUrl = await resolveClientLogoUrl(client.logo_url);
  const contacts = client.client_contacts as unknown as {id:string;first_name:string;last_name:string|null;email:string|null;phone:string|null;role_label:string|null;is_primary:boolean}[];
  const sheets = (client.weekly_sheets as unknown as {id:string;iso_week:number;iso_year:number;status:string;period_start:string;weekly_sheet_items:{id:string;publication_type:string;format:string;hashtags:string[]}[]}[]).sort((a,b)=>b.period_start.localeCompare(a.period_start));
  const assignments = client.client_assignments as unknown as {role:string;profiles:{id:string;full_name:string}|null}[];
  const primaryContact = contacts.find((contact)=>contact.is_primary) ?? contacts[0];
  const communityManager = assignments.find((assignment)=>assignment.role === "community_manager");
  let settings: {
    defaultNetworks?: string[];
    brandProfile?: { clientType?: string; activity?: string; website?: string; city?: string; postalCode?: string; audience?: string; tone?: string; keywords?: string };
    customHashtags?: string[];
    recommendedHashtags?: string[];
    monthlyCadence?: { photo?: number; video?: number; story?: number; visual?: number };
  } = {};
  try { settings = typeof client.notes === "string" ? JSON.parse(client.notes) : {}; } catch { settings = {}; }
  const rawClientType = settings.brandProfile?.clientType;
  const clientType: LyfttClientType = LYFTT_CLIENT_TYPE_IDS.includes(rawClientType as LyfttClientType)
    ? rawClientType as LyfttClientType
    : "artisan";
  const networks = (settings.defaultNetworks ?? []).filter((network): network is SocialNetwork => SOCIAL_NETWORKS.includes(network as SocialNetwork));
  const customHashtags = settings.customHashtags?.length
    ? settings.customHashtags
    : (settings.recommendedHashtags ?? []).slice(-5);
  const recentTags = [...new Set(sheets.flatMap(s=>s.weekly_sheet_items.flatMap(i=>i.hashtags)))];
  const tags = (settings.recommendedHashtags?.length ? settings.recommendedHashtags : recentTags).slice(0,20);
  const cadence = {
    photo:Number(settings.monthlyCadence?.photo ?? 0),
    video:Number(settings.monthlyCadence?.video ?? 0),
    story:Number(settings.monthlyCadence?.story ?? 0),
    visual:Number(settings.monthlyCadence?.visual ?? 0),
  };
  const rawTone = settings.brandProfile?.tone;
  const brandTone = brandTones.includes(rawTone as typeof brandTones[number])
    ? rawTone as typeof brandTones[number]
    : "chaleureux";

  return <div className="space-y-7">
    <header><Link href="/clients" className="mb-5 inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-ink">← Clients</Link><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3 sm:gap-4">{clientLogoUrl ? <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-white shadow-sm sm:h-14 sm:w-14">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={clientLogoUrl} alt={`Logo ${client.name}`} className="h-full w-full object-contain p-1.5"/>
    </span> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e8effa] text-base font-bold text-[#3e526f] sm:h-14 sm:w-14 sm:text-lg">{client.name.slice(0,2).toUpperCase()}</span>}<div className="min-w-0"><h1 className="page-title break-words">{client.name}</h1><p className="mt-1 break-words text-sm text-ink-soft">{client.is_active ? "Collaboration active" : "Client en pause"} · {client.timezone}</p></div></div>{profile?.role === "super_admin" && <Link href={`/budget/${client.id}`} className="btn-secondary"><Icon name="chart" className="h-4 w-4"/>Budget</Link>}<ClientEditor initial={{
      id: client.id,
      name: client.name,
      logoUrl: clientLogoUrl,
      communityManagerId: communityManager?.profiles?.id ?? managers?.[0]?.id ?? "",
      contacts: (contacts.length ? contacts : [primaryContact]).filter(Boolean).map((c)=>({ firstName:c?.first_name ?? "", lastName:c?.last_name ?? "", phone:c?.phone ?? "", email:c?.email ?? "" })),
      brand: {
        clientType,
        activity:settings.brandProfile?.activity ?? "",
        website:settings.brandProfile?.website ?? "",
        city:settings.brandProfile?.city ?? "",
        postalCode:settings.brandProfile?.postalCode ?? "",
        audience:settings.brandProfile?.audience ?? "",
        tone:brandTone,
        keywords:settings.brandProfile?.keywords ?? "",
      },
      networks:networks.length ? networks : ["instagram","facebook"],
      cadence,
      validation:{ deadlineWeekday:client.validation_deadline_weekday, deadlineTime:String(client.validation_deadline_time), approvalPolicy:client.approval_policy as "explicit_required"|"tacit_allowed", tacitNotice:client.tacit_approval_notice ?? "Sans retour avant cette échéance, les contenus seront considérés comme validés, selon les modalités prévues ensemble.", whatsappGroup:client.whatsapp_group_name ?? "", postSignature:client.post_signature ?? "" },
      customHashtags,
    }} managers={(managers ?? []).map((manager)=>({id:manager.id,name:manager.full_name}))}/></div></header>
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="card p-4 sm:p-6"><div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="eyebrow">Cadence éditoriale</p><h2 className="mt-1 text-lg font-semibold">Prestations en cours</h2></div><span className="rounded-full bg-[#edf4ff] px-3 py-1 text-xs font-semibold text-[#1468ff]">Volume mensuel vendu</span></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">{[{label:"Photos",count:cadence.photo},{label:"Vidéos / Reels",count:cadence.video},{label:"Visuels",count:cadence.visual}].map((item)=><div key={item.label} className="rounded-xl bg-canvas p-4"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{item.label}</strong><span className="text-2xl font-semibold tracking-tight">{item.count}</span></div><p className="mt-1 text-xs text-ink-faint">par mois</p></div>)}</div>
        </section>
        <section className="card overflow-hidden"><div className="flex items-center justify-between border-b px-4 py-4 sm:px-6 sm:py-5"><div><p className="eyebrow">Historique</p><h2 className="mt-1 font-semibold">Fiches hebdomadaires</h2></div><Link href="/fiches" className="mobile-inline-btn min-h-11 shrink-0 px-2 text-xs font-semibold text-[#1468ff]">Tout voir</Link></div>{sheets.length ? <ul className="divide-y">{sheets.slice(0,6).map(s=><li key={s.id}><Link href={`/fiches/${s.id}`} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-4 hover:bg-canvas sm:px-6"><span className="grid h-10 w-10 place-items-center rounded-xl bg-canvas text-xs font-bold">S{s.iso_week}</span><div className="min-w-0"><strong className="text-sm">Semaine {s.iso_week}</strong><p className="text-xs text-ink-faint">{s.weekly_sheet_items.length} contenu{s.weekly_sheet_items.length>1?"s":""}</p><span className="mt-1 inline-flex max-w-full rounded-full bg-canvas px-2 py-0.5 text-[10px] text-ink-soft sm:hidden">{sheetStatusLabel(s.status)}</span></div><span className="hidden items-center gap-2 sm:flex"><span className="badge bg-canvas text-ink-soft">{sheetStatusLabel(s.status)}</span><Icon name="arrow" className="h-4 w-4 text-ink-faint"/></span><Icon name="arrow" className="h-4 w-4 text-ink-faint sm:hidden"/></Link></li>)}</ul> : <p className="p-8 text-center text-sm text-ink-faint">Aucune fiche créée pour ce client.</p>}</section>
        <section className="card p-6"><p className="eyebrow">Bibliothèque</p><h2 className="mt-1 font-semibold">Hashtags récents</h2>{tags.length ? <div className="mt-4 flex flex-wrap gap-2">{tags.map(t=><span key={t} className="rounded-lg bg-[#f0f3f7] px-2.5 py-1.5 text-xs text-ink-soft">{t}</span>)}</div> : <p className="mt-4 text-sm text-ink-faint">Aucun hashtag enregistré.</p>}</section>
      </div>
      <aside className="space-y-6">
        <section className="card p-5"><p className="eyebrow">Validation</p><div className="mt-4 space-y-4 text-sm"><div className="flex gap-3"><Icon name="clock" className="mt-0.5 h-4 w-4 text-[#1468ff]"/><div><strong>Échéance client</strong><p className="text-ink-faint">Chaque {weekDays[client.validation_deadline_weekday-1]} à {String(client.validation_deadline_time).slice(0,5).replace(":","h")}</p></div></div><div className="flex gap-3"><Icon name="check" className="mt-0.5 h-4 w-4 text-[#1468ff]"/><div><strong>Mode de validation</strong><p className="text-ink-faint">{client.approval_policy === "tacit_allowed" ? "Validation tacite autorisée" : "Validation explicite requise"}</p></div></div></div></section>
        <section className="card p-5"><p className="eyebrow">Contacts</p><div className="mt-4 space-y-4">{contacts.map(c=><div key={c.id} className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eff1f4] text-xs font-bold">{c.first_name[0]}{c.last_name?.[0]}</span><div className="min-w-0"><strong className="block truncate text-sm">{c.first_name} {c.last_name}</strong><p className="truncate text-xs text-ink-faint">{c.email ?? c.phone ?? c.role_label ?? "Contact"}</p></div>{c.is_primary&&<span className="ml-auto text-[10px] font-semibold text-[#0759e6]">PRINCIPAL</span>}</div>)}</div></section>
        <section className="card p-5"><p className="eyebrow">Équipe LYFTT</p><div className="mt-4 space-y-3">{assignments.map((a,i)=><div key={i} className="flex items-center justify-between text-sm"><span>{a.profiles?.full_name ?? "Non assigné"}</span><span className="text-xs text-ink-faint">{a.role.replaceAll("_"," ")}</span></div>)}</div></section>
        <section className="rounded-[20px] bg-[#123f73] p-5 text-white shadow-[0_16px_36px_rgba(18,63,115,.16)]"><Icon name="spark" className="h-5 w-5 text-[#8fd1ff]"/><h2 className="mt-4 font-semibold">Mises à jour du site</h2><p className="mt-1 text-xs leading-relaxed text-white/70">Le suivi apparaîtra ici dès qu’une prestation web sera enregistrée dans Supabase.</p></section>
      </aside>
    </div>
  </div>;
}

import Link from "next/link";
import { resolveMediaUrl } from "@/lib/media/signed-url";
import { addDays, format } from "date-fns";
import { fr } from "date-fns/locale";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ITEM_APPROVAL_STATUS_LABELS, MEDIA_FORMAT_LABELS, SOCIAL_NETWORK_LABELS, type ItemApprovalStatus, type MediaFormat, type SocialNetwork } from "@/lib/domain/types";
import { PublicationChecklist, type DailyPublication } from "./PublicationChecklist";

function todayInParis():string { return new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Paris", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date()); }

export default async function PublicationsPage({ searchParams }:{ searchParams:Promise<{date?:string}> }) {
  const requested=(await searchParams).date; const date=/^\d{4}-\d{2}-\d{2}$/.test(requested??"") ? requested! : todayInParis();
  const supabase=await createSupabaseServerClient();
  const { data:rows }=await supabase.from("weekly_sheet_items").select(`id, scheduled_time, format, networks, caption, hashtags, approval_status, published_at, media_downloaded_at, content_copied_at, media_external_url, media_pending_note, media_assets:media_asset_id ( kind, storage_path, file_name, preview_path, purged_at, preview_purged_at ), weekly_sheets!inner ( clients ( name ) )`).eq("scheduled_date",date).eq("is_cancelled",false).order("scheduled_time",{ascending:true});
  const admin=createSupabaseAdminClient();
  const items:DailyPublication[]=await Promise.all((rows??[]).map(async(row)=>{
    const sheet=row.weekly_sheets as unknown as { clients:{name:string}|null }|null;
    const media=row.media_assets as unknown as {kind:"image"|"video"|"document";storage_path:string;file_name:string;preview_path:string|null;purged_at:string|null;preview_purged_at:string|null}|null;
    // Après la purge qui suit la publication, l'original n'existe plus : on
    // sert l'aperçu tant qu'il est conservé plutôt qu'un lien mort.
    const signed=media ? await resolveMediaUrl({ storagePath:media.storage_path, previewPath:media.preview_path, purgedAt:media.purged_at, previewPurgedAt:media.preview_purged_at }) : null;
    const formatValue=row.format as MediaFormat;
    return { id:row.id, clientName:sheet?.clients?.name??"Client", scheduledTime:row.scheduled_time, formatLabel:MEDIA_FORMAT_LABELS[formatValue], networks:(row.networks??[]).map((network:SocialNetwork)=>SOCIAL_NETWORK_LABELS[network]), caption:row.caption, hashtags:row.hashtags??[], approvalLabel:ITEM_APPROVAL_STATUS_LABELS[row.approval_status as ItemApprovalStatus], approved:["approved","approved_after_fix"].includes(row.approval_status), publishedAt:row.published_at, mediaDownloadedAt:row.media_downloaded_at, contentCopiedAt:row.content_copied_at, mediaUrl:signed?.url??row.media_external_url??null, mediaFileName:media?.file_name??null, mediaKind:media?.kind??null, mediaRequired:formatValue!=="texte_seul" };
  }));
  const day=new Date(`${date}T12:00:00`); const previous=format(addDays(day,-1),"yyyy-MM-dd"); const next=format(addDays(day,1),"yyyy-MM-dd");
  return <div className="space-y-7"><header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Checklist quotidienne</p><h1 className="page-title mt-1">Publications</h1><p className="mt-2 text-sm text-ink-soft">{format(day,"EEEE d MMMM yyyy",{locale:fr})} · texte, hashtags et médias prêts à poster.</p></div><nav className="grid grid-cols-[44px_1fr_44px] gap-2" aria-label="Changer de date"><Link href={`/publications?date=${previous}`} className="mobile-inline-btn btn-secondary px-0" aria-label="Jour précédent">←</Link><Link href="/publications" className="btn-secondary">Aujourd’hui</Link><Link href={`/publications?date=${next}`} className="mobile-inline-btn btn-secondary px-0" aria-label="Jour suivant">→</Link></nav></header><PublicationChecklist initialItems={items}/></div>;
}

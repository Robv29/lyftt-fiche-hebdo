import Link from "next/link";
import { resolveMediaUrl } from "@/lib/media/signed-url";
import { addDays, format, startOfISOWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ITEM_APPROVAL_STATUS_LABELS, MEDIA_FORMAT_LABELS, SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS, type ItemApprovalStatus, type MediaFormat, type SocialNetwork } from "@/lib/domain/types";
import { PublicationChecklist, type DailyPublication } from "./PublicationChecklist";
import { UnpublishedWeekPanel, type UnpublishedItem } from "./UnpublishedWeekPanel";

function todayInParis():string { return new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Paris", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date()); }


export default async function PublicationsPage({ searchParams }:{ searchParams:Promise<{date?:string}> }) {
  const requested=(await searchParams).date; const date=/^\d{4}-\d{2}-\d{2}$/.test(requested??"") ? requested! : todayInParis();
  const supabase=await createSupabaseServerClient();
  const { data:rows }=await supabase.from("weekly_sheet_items").select(`id, scheduled_date, scheduled_time, format, networks, caption, hashtags, approval_status, published_at, media_downloaded_at, content_copied_at, collaboration_handle, collaboration_done_at, media_external_url, media_pending_note, published_networks, media_assets:media_asset_id ( kind, storage_path, file_name, preview_path, purged_at, preview_purged_at ), weekly_sheet_item_media ( position, media_assets ( kind, storage_path, file_name, preview_path, purged_at, preview_purged_at ) ), weekly_sheets!inner ( clients ( name, notes ) )`).eq("scheduled_date",date).eq("is_cancelled",false).order("scheduled_date",{ascending:true}).order("scheduled_time",{ascending:true});
  const admin=createSupabaseAdminClient();
  const items:DailyPublication[]=await Promise.all((rows??[]).map(async(row)=>{
    const sheet=row.weekly_sheets as unknown as { clients:{name:string;notes:string|null}|null }|null;
    /*
     * Réseaux à cocher : ceux enregistrés sur la fiche du client. À défaut,
     * ceux portés par la publication elle-même — une fiche ancienne peut
     * précéder le réglage.
     */
    let clientNetworks:SocialNetwork[]=[];
    try {
      const settings=sheet?.clients?.notes ? JSON.parse(sheet.clients.notes) : {};
      clientNetworks=((settings?.defaultNetworks ?? []) as string[])
        .filter((network):network is SocialNetwork => SOCIAL_NETWORKS.includes(network as SocialNetwork));
    } catch { clientNetworks=[]; }
    const plannedNetworks=clientNetworks.length ? clientNetworks : ((row.networks??[]) as SocialNetwork[]);
    const media=row.media_assets as unknown as {kind:"image"|"video"|"document";storage_path:string;file_name:string;preview_path:string|null;purged_at:string|null;preview_purged_at:string|null}|null;
    // Après la purge qui suit la publication, l'original n'existe plus : on
    // sert l'aperçu tant qu'il est conservé plutôt qu'un lien mort.
    const signed=media ? await resolveMediaUrl({ storagePath:media.storage_path, previewPath:media.preview_path, purgedAt:media.purged_at, previewPurgedAt:media.preview_purged_at }) : null;
    /*
     * Un carrousel se publie entier : la couverture seule ne suffit pas, il
     * faut pouvoir télécharger chaque image. Les publications antérieures à
     * la galerie n'ont que leur média unique, qui en tient lieu.
     */
    type GalleryRow={position:number;media_assets:{kind:"image"|"video"|"document";storage_path:string;file_name:string;preview_path:string|null;purged_at:string|null;preview_purged_at:string|null}|null};
    const galleryRows=((row.weekly_sheet_item_media??[]) as unknown as GalleryRow[])
      .filter((entry)=>entry.media_assets)
      .sort((a,b)=>a.position-b.position)
      .map((entry)=>entry.media_assets!);
    const gallerySource=galleryRows.length>0?galleryRows:media?[media]:[];
    const gallery=await Promise.all(gallerySource.map(async(asset)=>({
      fileName:asset.file_name,
      kind:asset.kind,
      url:(await resolveMediaUrl({storagePath:asset.storage_path,previewPath:asset.preview_path,purgedAt:asset.purged_at,previewPurgedAt:asset.preview_purged_at}))?.url??null,
    })));

    const formatValue=row.format as MediaFormat;
    return { id:row.id, scheduledDate:row.scheduled_date, clientName:sheet?.clients?.name??"Client", scheduledTime:row.scheduled_time, format:formatValue, formatLabel:MEDIA_FORMAT_LABELS[formatValue], networks:(row.networks??[]).map((network:SocialNetwork)=>SOCIAL_NETWORK_LABELS[network]), plannedNetworks, publishedNetworks:((row.published_networks??[]) as SocialNetwork[]), caption:row.caption, hashtags:row.hashtags??[], approvalLabel:ITEM_APPROVAL_STATUS_LABELS[row.approval_status as ItemApprovalStatus], approved:["approved","approved_after_fix"].includes(row.approval_status), publishedAt:row.published_at, mediaDownloadedAt:row.media_downloaded_at, contentCopiedAt:row.content_copied_at, mediaUrl:signed?.url??row.media_external_url??null, mediaFileName:media?.file_name??null, mediaKind:media?.kind??null, mediaRequired:formatValue!=="texte_seul", gallery, collaborationHandle:(row.collaboration_handle as string|null)?.trim()||null, collaborationDoneAt:row.collaboration_done_at as string|null };
  }));
  /*
   * Prochaine date qui porte du contenu. L'écran reste centré sur le jour
   * sélectionné ; ce simple repère évite d'avancer à l'aveugle jour après jour
   * quand la journée est vide.
   */
  let nextWithContent:string|null=null;
  if (items.length===0) {
    const { data:ahead }=await supabase
      .from("weekly_sheet_items")
      .select("scheduled_date")
      .gt("scheduled_date",date)
      .eq("is_cancelled",false)
      .is("published_at",null)
      .order("scheduled_date",{ascending:true})
      .limit(1);
    nextWithContent=(ahead?.[0]?.scheduled_date as string|undefined) ?? null;
  }

  const day=new Date(`${date}T12:00:00`);
  const previousDay=addDays(day,-1);
  const nextDay=addDays(day,1);
  const previous=format(previousDay,"yyyy-MM-dd");
  const next=format(nextDay,"yyyy-MM-dd");
  const selectedDayLabel=format(day,"EEEE d MMMM yyyy",{locale:fr});

  /*
   * Alerte de retard, pas inventaire général : seuls les jours de la semaine
   * en cours qui sont déjà passés comptent. Le jour affiché peut être
   * n'importe quelle date parcourue dans la checklist ; la semaine et
   * « aujourd'hui » restent celles du calendrier réel, sans quoi naviguer
   * changerait ce que l'alerte considère comme en retard.
   */
  const realToday=todayInParis();
  const currentWeekStart=format(startOfISOWeek(new Date(`${realToday}T12:00:00`)),"yyyy-MM-dd");
  const { data:unpublishedRows }=await supabase
    .from("weekly_sheet_items")
    .select("id, scheduled_date, scheduled_time, format, weekly_sheets!inner ( clients ( name ) )")
    .gte("scheduled_date",currentWeekStart)
    .lt("scheduled_date",realToday)
    .eq("is_cancelled",false)
    .is("published_at",null)
    .order("scheduled_date",{ascending:true})
    .order("scheduled_time",{ascending:true});
  const unpublishedItems:UnpublishedItem[]=(unpublishedRows??[]).map((row)=>{
    const sheet=row.weekly_sheets as unknown as { clients:{name:string}|null }|null;
    return {
      id:row.id,
      scheduledDate:row.scheduled_date,
      scheduledTime:row.scheduled_time,
      clientName:sheet?.clients?.name??"Client",
      formatLabel:MEDIA_FORMAT_LABELS[row.format as MediaFormat],
    };
  });

  return <div className="space-y-7">
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">Checklist quotidienne</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="page-title">Publications</h1>
          <UnpublishedWeekPanel items={unpublishedItems}/>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          <time dateTime={date} className="capitalize">{selectedDayLabel}</time> · texte, hashtags et médias prêts à poster.
        </p>
      </div>
      <nav className="grid grid-cols-[44px_1fr_44px] gap-2" aria-label="Changer le jour affiché">
        <Link href={`/publications?date=${previous}`} className="mobile-inline-btn btn-secondary px-0" aria-label={`Voir le ${format(previousDay,"d MMMM yyyy",{locale:fr})}`}>←</Link>
        <Link href="/publications" className="btn-secondary">Aujourd’hui</Link>
        <Link href={`/publications?date=${next}`} className="mobile-inline-btn btn-secondary px-0" aria-label={`Voir le ${format(nextDay,"d MMMM yyyy",{locale:fr})}`}>→</Link>
      </nav>
    </header>
    <PublicationChecklist key={date} initialItems={items} nextWithContent={nextWithContent}/>
  </div>;
}

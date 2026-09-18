import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CONTENT_BUCKETS, type ContentBucket } from "@/lib/domain/content-buckets";
import type { BucketProgress, BucketStatus, DepositSummary, VisualsState } from "@/lib/domain/planning";
import { VisualsValidation } from "./VisualsValidation";

export interface OverviewRow {
  clientId: string;
  clientName: string;
  hasSheet: boolean;
  /**
   * Semaine creuse du rythme vendu, sans fiche : rien n'est attendu. Une
   * fiche créée quand même une semaine creuse s'affiche normalement.
   */
  offWeek: boolean;
  topic: string | null;
  /** Fichiers déposés et textes rédigés, tout à la fois. */
  done: boolean;
  href: string;
  progress: Record<ContentBucket, BucketProgress>;
  /** Ce qui reste à déposer et à rédiger ; null tant que la fiche n'existe pas. */
  deposit: DepositSummary | null;
  sheetId: string | null;
  /** Validation des visuels, indépendante des textes ; null sans fiche. */
  visuals: { state: VisualsState; validatedAt: string | null; validatedByName: string | null } | null;
}

/**
 * Un indicateur : fichier (flèche de dépôt) ou texte (bulle).
 *
 * Plein : fait. Cerclé : à faire. Les deux se lisent côte à côte dans chaque
 * colonne, pour voir d'un regard qu'un fichier est déposé même si son texte
 * n'est pas encore écrit.
 */
function Dot({ status, color, icon, label }: { status: BucketStatus; color: string; icon: "upload" | "message"; label: string }) {
  if (status === "none") return null;
  const ready = status === "ready";
  return (
    <span
      className="grid h-6 w-6 place-items-center rounded-full border-2"
      style={ready ? { background: color, borderColor: color, color: "#fff" } : { borderColor: color, color }}
      title={label}
      aria-label={label}
      role="img"
    >
      <Icon name={icon} className="h-3 w-3"/>
    </span>
  );
}

function BucketCell({ progress, color, label }: { progress: BucketProgress; color: string; label: string }) {
  if (progress.files === "none" && progress.texts === "none") return <span className="text-ink-faint">—</span>;
  // Compris dans le forfait, mais aucune fiche créée : rond vide, sans marque.
  if (progress.files === "expected" || progress.texts === "expected") {
    return <span className="mx-auto block h-6 w-6 rounded-full border-2" style={{ borderColor: color }} title={`${label} : fiche à créer`}/>;
  }
  return (
    <span className="flex items-center justify-center gap-1">
      <Dot status={progress.files} color={color} icon="upload" label={`${label} : ${progress.files === "ready" ? "fichiers déposés" : "fichiers à déposer"}`}/>
      <Dot status={progress.texts} color={color} icon="message" label={`${label} : ${progress.texts === "ready" ? "textes rédigés" : "textes à rédiger"}`}/>
    </span>
  );
}

/**
 * Vue Monday : chaque client, chaque famille de contenu — fichiers et textes.
 *
 * Le pourcentage de complétion d'une fiche ne dit pas *quoi* manque ; ce
 * tableau répond colonne par colonne, et sépare ce qui est déposé de ce qui est
 * rédigé : un texte en retard ne cache plus des fichiers déjà livrés.
 */
export function ProductionOverview({ rows, weekLabel, weekOffset, maxWeekOffset, canValidateVisuals }: { rows: OverviewRow[]; weekLabel: string; weekOffset: number; maxWeekOffset: number; canValidateVisuals: boolean }) {
  const filesDone = rows.filter((row) => row.deposit && row.deposit.filesMissing === 0).length;
  const visualsDone = rows.filter((row) => row.visuals?.state === "validated").length;
  const textsDone = rows.filter((row) => row.deposit && row.deposit.textsMissing === 0).length;
  /*
   * Une semaine sans publication ne compte pas dans « sur N clients » : elle
   * ferait baisser les taux sans qu'il y ait rien à livrer.
   */
  const offWeek = rows.filter((row) => row.offWeek).length;
  const expected = rows.length - offWeek;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          {weekLabel} · sur {expected} client{expected > 1 ? "s" : ""} : fichiers déposés {filesDone} ·
          visuels validés {visualsDone} · textes rédigés {textsDone}.
          {offWeek > 0 && ` ${offWeek} sans publication cette semaine.`}
        </p>
        <div className="flex items-center gap-1.5">
          {weekOffset > 0 ? (
            <Link href={`/production?week=${weekOffset - 1}`} className="btn-secondary min-h-9 px-3 text-xs">
              <Icon name="arrow" className="h-3.5 w-3.5 rotate-180"/>{weekOffset === 1 ? "Cette semaine" : "Semaine précédente"}
            </Link>
          ) : null}
          {weekOffset < maxWeekOffset && (
            <Link href={`/production?week=${weekOffset + 1}`} className="btn-secondary min-h-9 px-3 text-xs">
              Semaine suivante<Icon name="arrow" className="h-3.5 w-3.5"/>
            </Link>
          )}
        </div>
      </div>

      {/* Légende : sans elle, deux ronds par colonne ne se devinent pas. */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5"><Dot status="ready" color="#64748b" icon="upload" label="Fichiers"/>Fichiers</span>
        <span className="flex items-center gap-1.5"><Dot status="ready" color="#64748b" icon="message" label="Textes"/>Textes</span>
        <span className="text-ink-faint">Plein : fait · cerclé : à faire · les visuels se valident dans la colonne Statut</span>
      </p>

      {rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-ink-faint">Aucun client actif cette semaine.</p>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Sujet de la semaine</th>
                  {CONTENT_BUCKETS.map((bucket) => <th key={bucket.key} className="px-2 py-3 text-center">{bucket.label}</th>)}
                  <th className="px-4 py-3 text-right">Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.clientId} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3"><Link href={row.href} className="font-semibold hover:underline">{row.clientName}</Link></td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-ink-faint">{row.topic ?? "—"}</td>
                    {CONTENT_BUCKETS.map((bucket) => (
                      <td key={bucket.key} className="px-2 py-3 text-center">
                        <BucketCell progress={row.progress[bucket.key]} color={bucket.accent} label={bucket.label}/>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      {row.offWeek
                        ? <span className="badge bg-canvas text-ink-faint" title="Le rythme vendu ne prévoit aucune publication cette semaine.">Pas de publication</span>
                        : !row.hasSheet || !row.deposit || !row.sheetId || !row.visuals
                        ? <span className="badge bg-state-changes/10 text-state-changes">Fiche à créer</span>
                        : (
                          <span className="flex flex-col items-end gap-1">
                            {row.done && <span className="badge bg-state-approved/10 text-state-approved">Fait</span>}
                            {/* Fichiers manquants, bouton de validation, ou validation posée — selon l'état. */}
                            <VisualsValidation
                              sheetId={row.sheetId}
                              state={row.visuals.state}
                              filesMissing={row.deposit.filesMissing}
                              validatedAt={row.visuals.validatedAt}
                              validatedByName={row.visuals.validatedByName}
                              canValidate={canValidateVisuals}
                            />
                            {!row.done && (row.deposit.textsMissing === 0
                              ? <span className="badge bg-state-approved/10 text-state-approved">Textes rédigés</span>
                              : <span className="badge bg-[#fff7e6] text-[#8a5700]">Textes : {row.deposit.textsMissing} à rédiger</span>)}
                          </span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

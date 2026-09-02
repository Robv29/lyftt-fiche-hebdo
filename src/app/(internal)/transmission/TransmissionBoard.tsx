"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ClientCard } from "@/components/ClientCard";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui";
import {
  contactFullName,
  formatMontantCa,
  formatParisDateTime,
  parisDateTimeLocalValue,
} from "@/lib/domain/crm-transmission";
import {
  setTransmissionRendezVous,
  setTransmissionStatut,
  type TransmissionActionResult,
} from "./actions";

export interface TransmissionRow {
  id: string;
  crmProspectId: number;
  entreprise: string;
  contactPrenom: string | null;
  contactNom: string | null;
  email: string | null;
  telephone: string | null;
  ficheMission: string | null;
  montantCa: number | null;
  menuComposeLe: string | null;
  dateRdv: string | null;
  statut: string;
  clientId: string | null;
}

export function TransmissionBoard({ rows }: { rows: TransmissionRow[] }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<TransmissionActionResult | null>(null);

  const run = (action: () => Promise<TransmissionActionResult>) => {
    startTransition(async () => {
      try {
        setFeedback(await action());
      } catch {
        setFeedback({
          ok: false,
          message: "L’enregistrement a été interrompu. Rechargez la page puis réessayez.",
        });
      }
    });
  };

  const sections = [
    {
      key: "a_traiter",
      title: "À traiter",
      hint: "Clients signés qui attendent d’être créés.",
      list: rows.filter((row) => row.statut === "a_traiter"),
    },
    {
      key: "traite",
      title: "Traitées",
      hint: "Fiches prises en charge. Le menu du client y reste consultable.",
      list: rows.filter((row) => row.statut === "traite"),
    },
  ];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="send"
        title="Aucune fiche transmise"
        description="Les clients qui signent et composent leur menu dans le CRM apparaissent ici automatiquement."
      />
    );
  }

  return (
    <div className="space-y-7">
      {feedback?.message && (
        <p
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}
        >
          {feedback.message}
        </p>
      )}

      {sections.map((section) => (
        <section key={section.key} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {section.title}
              <span className="ml-2 font-normal text-ink-faint">{section.list.length}</span>
            </h2>
            <p className="text-xs text-ink-faint">{section.hint}</p>
          </div>

          {section.list.length === 0 ? (
            <p className="card px-5 py-8 text-center text-sm text-ink-faint">
              {section.key === "a_traiter" ? "Rien à prendre en charge." : "Aucune fiche traitée pour l’instant."}
            </p>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2">
              {section.list.map((row) => {
                const contact = contactFullName(row.contactPrenom, row.contactNom);
                const montant = formatMontantCa(row.montantCa);
                const traitee = row.statut === "traite";
                return (
                  <ClientCard
                    key={row.id}
                    name={row.entreprise}
                    muted={traitee}
                    email={row.email}
                    phone={row.telephone}
                    badges={
                      <>
                        {montant && <span className="ml-2 badge bg-[#e8f2ff] text-[#0b5e9f]">{montant}</span>}
                        {traitee && <span className="ml-2 badge bg-canvas text-ink-faint">Traitée</span>}
                      </>
                    }
                    detail={
                      <p className="mt-1 text-xs text-ink-faint">
                        Fiche CRM n° {row.crmProspectId}
                        {row.menuComposeLe && <> · menu composé le {formatParisDateTime(row.menuComposeLe)}</>}
                      </p>
                    }
                    lines={
                      <p className="mt-2 text-xs text-ink-soft">
                        {contact ?? "Contact non renseigné"}
                      </p>
                    }
                    footer={
                      <div className="grid gap-2 sm:grid-cols-2">
                        {/*
                          Pas de création automatique : l'onboarding réclame une
                          vingtaine de champs — hashtags, réseaux, jour
                          d'échéance, logo — que le CRM ne connaît pas. Le nom
                          part en paramètre d'URL, le formulaire s'ouvre dessus,
                          et la fiche se referme toute seule à l'enregistrement.
                        */}
                        {row.clientId ? (
                          <Link href={`/clients/${row.clientId}`} className="btn-secondary text-xs">
                            Voir le dossier
                          </Link>
                        ) : (
                          <Link
                            href={`/clients?nom=${encodeURIComponent(row.entreprise)}&transmission=${row.id}`}
                            className="btn-primary text-xs"
                          >
                            <Icon name="plus" className="h-3.5 w-3.5"/>Créer le client
                          </Link>
                        )}
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={pending}
                          onClick={() => run(() => setTransmissionStatut(row.id, traitee ? "a_traiter" : "traite"))}
                        >
                          <Icon name={traitee ? "clock" : "check"} className="h-3.5 w-3.5"/>
                          {traitee ? "Remettre à traiter" : "Marquer traité"}
                        </button>
                      </div>
                    }
                  >
                    {/*
                      Le rendez-vous vient de Calendly, quand le client a choisi
                      son créneau. Il n'arrive parfois jamais — rendez-vous pris
                      par téléphone, adresse différente de celle du CRM — d'où
                      la saisie à la main, sans laquelle la fiche resterait
                      muette sur la seule date qui compte.
                    */}
                    {row.dateRdv ? (
                      <div className="rounded-xl bg-canvas px-3 py-2">
                        <p className="flex flex-wrap items-center gap-2 text-xs">
                          <Icon name="calendar" className="h-4 w-4 shrink-0 text-[#0b5e9f]"/>
                          <span className="font-semibold">Rendez-vous</span>
                          <span className="text-ink-soft">{formatParisDateTime(row.dateRdv)}</span>
                        </p>
                        {/*
                          Corrigeable : Calendly renvoie le créneau initial, et
                          un report convenu au téléphone ne repasse jamais par
                          lui. Une date fausse est pire qu'une date absente.
                        */}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-ink-faint">Corriger la date</summary>
                          <RendezVousForm
                            row={row}
                            pending={pending}
                            defaultValue={parisDateTimeLocalValue(row.dateRdv)}
                            onSubmit={run}
                          />
                        </details>
                      </div>
                    ) : (
                      <RendezVousForm row={row} pending={pending} defaultValue="" onSubmit={run}/>
                    )}

                    {row.ficheMission && (
                      <details className="rounded-xl border border-line bg-canvas/60 px-3 py-2">
                        <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Fiche mission</summary>
                        {/*
                          Le menu est saisi en texte libre dans le CRM, une
                          prestation par ligne. Sans `whitespace-pre-line`, tout
                          se retrouve en un seul paragraphe illisible.
                        */}
                        <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-ink-soft">
                          {row.ficheMission}
                        </p>
                      </details>
                    )}
                  </ClientCard>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Saisie du créneau, en heure de Paris — la seule que le chef de projet ait en
 * tête quand il recopie un rendez-vous.
 */
function RendezVousForm({
  row,
  pending,
  defaultValue,
  onSubmit,
}: {
  row: TransmissionRow;
  pending: boolean;
  defaultValue: string;
  onSubmit: (action: () => Promise<TransmissionActionResult>) => void;
}) {
  return (
    <form
      action={(formData) => {
        formData.set("transmissionId", row.id);
        onSubmit(() => setTransmissionRendezVous(formData));
      }}
      className="mt-2 flex flex-wrap items-end gap-2"
    >
      <div className="min-w-[12rem] flex-1">
        <label className="label text-xs" htmlFor={`rdv-${row.id}`}>Date du rendez-vous</label>
        <input
          id={`rdv-${row.id}`}
          name="dateRdv"
          type="datetime-local"
          className="field"
          defaultValue={defaultValue}
          required
        />
      </div>
      <button type="submit" className="btn-secondary text-xs" disabled={pending}>Enregistrer</button>
    </form>
  );
}

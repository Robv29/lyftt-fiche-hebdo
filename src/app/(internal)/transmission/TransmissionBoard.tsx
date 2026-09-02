"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { ClientCard } from "@/components/ClientCard";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui";
import {
  contactFullName,
  formatMontantCa,
  formatParisDateTime,
  menuAffiche,
  menuDivergeDepuisValidation,
  parisDateTimeLocalValue,
  prochaineEtapeTransmission,
  transmissionAvancement,
  transmissionEtapes,
  NOMBRE_ETAPES_TRANSMISSION,
  type EtapeTransmissionKey,
} from "@/lib/domain/crm-transmission";
import {
  corrigerTransmissionMenu,
  envoyerTransmissionRecap,
  setTransmissionRendezVous,
  setTransmissionStatut,
  validerTransmissionMenu,
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
  /** Menu tel que le CRM l'a transmis. */
  ficheMission: string | null;
  /** Correction de la production, quand elle existe. Prime à l'affichage. */
  menuCorrige: string | null;
  /** Dernier menu réellement différent reçu du CRM. */
  ficheMissionMajLe: string | null;
  montantCa: number | null;
  menuComposeLe: string | null;
  dateRdv: string | null;
  statut: string;
  clientId: string | null;
  clientCreeLe: string | null;
  menuValideLe: string | null;
  recapEnvoyeLe: string | null;
  recapEnvoyeA: string | null;
}

type Lanceur = (action: () => Promise<TransmissionActionResult>) => void;

export function TransmissionBoard({ rows }: { rows: TransmissionRow[] }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<TransmissionActionResult | null>(null);

  const run: Lanceur = (action) => {
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

  /*
   * Les fiches arrivent déjà triées par avancement : le filtre conserve cet
   * ordre, donc chaque section s'ouvre sur ce que personne n'a encore regardé.
   */
  const sections = [
    {
      key: "a_traiter",
      title: "À traiter",
      hint: "Clients signés dont le parcours n’est pas bouclé.",
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
              {section.list.map((row) => (
                <CarteTransmission key={row.id} row={row} pending={pending} run={run}/>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Une fiche transmise, présentée comme un parcours de trois étapes datées.
 *
 * L'ancienne carte listait des boutons sans ordre : on ne savait pas ce qui
 * avait déjà été fait pour ce client, ni ce qu'il restait. Les trois gestes
 * sont désormais numérotés, chacun affichant sa date une fois franchi.
 */
function CarteTransmission({
  row,
  pending,
  run,
}: {
  row: TransmissionRow;
  pending: boolean;
  run: Lanceur;
}) {
  const contact = contactFullName(row.contactPrenom, row.contactNom);
  const montant = formatMontantCa(row.montantCa);
  const traitee = row.statut === "traite";

  const etapes = transmissionEtapes(row);
  const avancement = transmissionAvancement(row);
  const prochaine = prochaineEtapeTransmission(row);
  const menu = menuAffiche(row);
  const diverge = menuDivergeDepuisValidation(row);

  const corps: Record<EtapeTransmissionKey, ReactNode> = {
    menu: (
      <>
        <div className="mt-2 rounded-xl border border-line bg-canvas/60 px-3 py-2.5">
          <p className="eyebrow mb-1.5">
            {menu.corrige ? "Menu retenu, corrigé par vos soins" : "Menu composé par le client"}
          </p>
          {/*
            `whitespace-pre-line` préserve le découpage ligne par ligne : une
            prestation par ligne, comme le client l'a composé.
          */}
          {menu.texte ? (
            <p className="whitespace-pre-line text-xs leading-relaxed text-ink-soft">{menu.texte}</p>
          ) : (
            <p className="text-xs italic text-ink-faint">
              Le client n&apos;a pas encore composé son menu.
            </p>
          )}
        </div>

        {/*
          La version du CRM reste consultable même corrigée : c'est elle qui
          fait foi si le client conteste ce qu'il a commandé.
        */}
        {menu.corrige && row.ficheMission && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-ink-faint">
              Voir le menu d’origine du CRM
            </summary>
            <p className="mt-1.5 whitespace-pre-line rounded-xl bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
              {row.ficheMission}
            </p>
          </details>
        )}

        {diverge && (
          <Avertissement>
            Le CRM a renvoyé un menu différent depuis votre relecture.
            {menu.corrige
              ? " Votre version est conservée : comparez-la à l’originale avant de revalider."
              : " Relisez-le avant d’envoyer le récapitulatif."}
          </Avertissement>
        )}

        <div className="mt-2">
          <button
            type="button"
            className={`text-xs ${row.menuValideLe ? "btn-secondary" : "btn-primary"}`}
            disabled={pending}
            onClick={() => run(() => validerTransmissionMenu(row.id))}
          >
            <Icon name="check" className="h-3.5 w-3.5"/>
            {row.menuValideLe ? "Revalider le menu" : "Valider le menu"}
          </button>
        </div>

        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-faint">Corriger le menu</summary>
          <MenuForm row={row} pending={pending} defaultValue={menu.texte ?? ""} onSubmit={run}/>
        </details>
      </>
    ),

    recap: (
      <>
        {/*
          Le rendez-vous est ici parce que le récapitulatif le mentionne : le
          renseigner avant l'envoi évite un second message pour le préciser.
          Il vient de Calendly quand le client a choisi son créneau, et n'y
          arrive parfois jamais — rendez-vous pris par téléphone, adresse
          différente de celle du CRM — d'où la saisie à la main.
        */}
        {row.dateRdv ? (
          <div className="mt-2 rounded-xl bg-canvas px-3 py-2">
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <Icon name="calendar" className="h-4 w-4 shrink-0 text-[#0b5e9f]"/>
              <span className="font-semibold">Rendez-vous</span>
              <span className="text-ink-soft">{formatParisDateTime(row.dateRdv)}</span>
            </p>
            {/*
              Corrigeable : Calendly renvoie le créneau initial, et un report
              convenu au téléphone ne repasse jamais par lui. Une date fausse
              est pire qu'une date absente.
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

        {row.recapEnvoyeA && (
          <p className="mt-2 text-[11px] text-ink-faint">Envoyé à {row.recapEnvoyeA}</p>
        )}

        {/*
          Souple, mais pas silencieux : un menu déjà juste n'a pas besoin
          d'être corrigé pour partir. On signale l'étape sautée, on ne la
          rend pas obligatoire.
        */}
        {!row.menuValideLe && (
          <Avertissement>
            Validez d’abord le menu à l’étape 1 : le client recevra ce qu’il contient, il doit avoir été relu.
          </Avertissement>
        )}

        {row.email ? (
          <div className="mt-2">
            <button
              type="button"
              className={`text-xs ${row.recapEnvoyeLe ? "btn-secondary" : "btn-primary"}`}
              disabled={pending || !row.menuValideLe}
              title={row.menuValideLe ? undefined : "Validez le menu à l’étape 1"}
              onClick={() => {
                // Un e-mail part chez un vrai client : la confirmation évite le
                // clic de trop, et le doublon dans sa boîte.
                const question = row.recapEnvoyeLe
                  ? `Renvoyer le récapitulatif à ${row.email} ?`
                  : `Envoyer le récapitulatif à ${row.email} ?`;
                if (window.confirm(question)) run(() => envoyerTransmissionRecap(row.id));
              }}
            >
              <Icon name="send" className="h-3.5 w-3.5"/>
              {row.recapEnvoyeLe ? "Renvoyer le récapitulatif" : "Envoyer le récapitulatif"}
            </button>
          </div>
        ) : (
          <Avertissement ton="erreur">
            Aucune adresse e-mail sur cette fiche : complétez le contact dans le CRM.
          </Avertissement>
        )}
      </>
    ),

    client: (
      <div className="mt-2">
        {/*
          Pas de création automatique : l'onboarding réclame une vingtaine de
          champs — hashtags, réseaux, jour d'échéance, logo — que le CRM ne
          connaît pas. Le nom part en paramètre d'URL, le formulaire s'ouvre
          dessus, et la fiche se referme toute seule à l'enregistrement.
        */}
        {row.clientId ? (
          <Link href={`/clients/${row.clientId}`} className="btn-secondary text-xs">
            Voir le dossier
          </Link>
        ) : row.recapEnvoyeLe ? (
          <Link
            href={`/clients?nom=${encodeURIComponent(row.entreprise)}&transmission=${row.id}`}
            className="btn-primary text-xs"
          >
            <Icon name="plus" className="h-3.5 w-3.5"/>Créer le client
          </Link>
        ) : (
          /*
            Le dossier ne s'ouvre qu'une fois le client informé : créer la fiche
            avant l'envoi, c'est engager la production sur un accompagnement que
            personne n'a confirmé au client.
          */
          <div className="space-y-1.5">
            <Avertissement>
              Envoyez d’abord le récapitulatif au client à l’étape 2.
            </Avertissement>
            <button type="button" className="btn-primary text-xs" disabled title="Envoyez le récapitulatif à l’étape 2">
              <Icon name="plus" className="h-3.5 w-3.5"/>Créer le client
            </button>
          </div>
        )}
      </div>
    ),
  };

  return (
    <ClientCard
      name={row.entreprise}
      muted={traitee}
      email={row.email}
      phone={row.telephone}
      badges={
        <>
          {montant && <span className="ml-2 badge bg-[#e8f2ff] text-[#0b5e9f]">{montant}</span>}
          <span
            className={`ml-2 badge ${
              avancement === NOMBRE_ETAPES_TRANSMISSION
                ? "bg-state-approved/10 text-state-approved"
                : "bg-canvas text-ink-soft"
            }`}
          >
            {avancement === NOMBRE_ETAPES_TRANSMISSION
              ? "Parcours terminé"
              : `Étape ${prochaine?.rang ?? 1} sur ${NOMBRE_ETAPES_TRANSMISSION}`}
          </span>
          {traitee && <span className="ml-2 badge bg-canvas text-ink-faint">Traitée</span>}
        </>
      }
      detail={
        <p className="mt-1 text-xs text-ink-faint">
          Fiche CRM n° {row.crmProspectId}
          {row.menuComposeLe && <> · menu composé le {formatParisDateTime(row.menuComposeLe)}</>}
        </p>
      }
      lines={<p className="mt-2 text-xs text-ink-soft">{contact ?? "Contact non renseigné"}</p>}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={pending}
            onClick={() => run(() => setTransmissionStatut(row.id, traitee ? "a_traiter" : "traite"))}
          >
            <Icon name={traitee ? "clock" : "check"} className="h-3.5 w-3.5"/>
            {traitee ? "Remettre à traiter" : "Marquer traité"}
          </button>
          {/* Le dossier commercial reste la source : un aller-retour vaut mieux
              qu'une donnée recopiée qu'on croit à jour. */}
          <a
            href={`https://lyftt-crm.vercel.app/prospects/${row.crmProspectId}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-accent hover:underline"
          >
            Ouvrir la fiche dans le CRM →
          </a>
        </div>
      }
    >
      <ol className="space-y-4">
        {etapes.map((etape) => (
          <Etape
            key={etape.key}
            rang={etape.rang}
            titre={etape.titre}
            attendu={etape.attendu}
            franchie={etape.franchie}
            le={etape.le}
            courante={prochaine?.key === etape.key}
          >
            {corps[etape.key]}
          </Etape>
        ))}
      </ol>
    </ClientCard>
  );
}

/**
 * Une étape du parcours : sa pastille, son titre, sa date, ses commandes.
 *
 * Trois états visuels seulement — franchie, en cours, à venir. Le vert d'une
 * étape franchie et sa date sont ce qui permet de lire l'avancement d'une
 * carte sans rien ouvrir.
 */
function Etape({
  rang,
  titre,
  attendu,
  franchie,
  le,
  courante,
  children,
}: {
  rang: number;
  titre: string;
  attendu: string;
  franchie: boolean;
  le: string | null;
  courante: boolean;
  children: ReactNode;
}) {
  const pastille = franchie
    ? "bg-state-approved/10 text-state-approved"
    : courante
      ? "bg-[#e8f2ff] text-[#0b5e9f] ring-2 ring-[#0b5e9f]/15"
      : "bg-canvas text-ink-faint";

  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${pastille}`}
      >
        {franchie ? <Icon name="check" className="h-3.5 w-3.5"/> : rang}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">
          {titre}
          {franchie ? (
            <span className="ml-2 font-normal text-state-approved">
              {le ? `le ${formatParisDateTime(le)}` : "fait"}
            </span>
          ) : (
            <span className="ml-2 font-normal text-ink-faint">{attendu}</span>
          )}
        </p>
        {children}
      </div>
    </li>
  );
}

/** Signalement discret : une étape sautée, un menu qui a bougé, un contact absent. */
function Avertissement({
  children,
  ton = "attention",
}: {
  children: ReactNode;
  ton?: "attention" | "erreur";
}) {
  const couleurs =
    ton === "erreur"
      ? "border-state-changes/30 bg-state-changes/5 text-state-changes"
      : "border-state-progress/30 bg-state-progress/5 text-state-progress";

  return (
    <p className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${couleurs}`}>
      <Icon name="warning" className="mt-px h-3.5 w-3.5 shrink-0"/>
      <span>{children}</span>
    </p>
  );
}

/**
 * Correction du menu, dans sa propre colonne en base.
 *
 * Le CRM renvoie la fiche à chaque modification du dossier commercial : sa
 * version et celle de la production vivent séparément, faute de quoi la
 * seconde disparaîtrait au prochain envoi.
 */
function MenuForm({
  row,
  pending,
  defaultValue,
  onSubmit,
}: {
  row: TransmissionRow;
  pending: boolean;
  defaultValue: string;
  onSubmit: Lanceur;
}) {
  return (
    <form
      action={(formData) => {
        formData.set("transmissionId", row.id);
        onSubmit(() => corrigerTransmissionMenu(formData));
      }}
      className="mt-2 space-y-2"
    >
      <label className="label text-xs" htmlFor={`menu-${row.id}`}>
        Menu retenu, une prestation par ligne
      </label>
      <textarea
        id={`menu-${row.id}`}
        name="menu"
        rows={8}
        className="field text-xs leading-relaxed"
        defaultValue={defaultValue}
      />
      <p className="text-[11px] text-ink-faint">
        Votre version est conservée à part : le CRM ne peut plus l’écraser. Videz le champ pour
        reprendre la sienne.
      </p>
      <button type="submit" className="btn-primary text-xs" disabled={pending}>
        Enregistrer et valider
      </button>
    </form>
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
  onSubmit: Lanceur;
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

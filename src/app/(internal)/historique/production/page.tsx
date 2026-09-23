import { redirect } from "next/navigation";
import { denyCommercial } from "@/lib/internal/authorization";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { todayInParis } from "@/lib/domain/client-lifecycle";
import {
  firstNameOf,
  involvedPeople,
  isResponsible,
  matchesPerson,
  matchesVerdictFilter,
  PRODUCTION_KIND_LABELS,
  productionHistorySummary,
  productionVerdict,
  productionVerdictLabel,
  UNKNOWN_PERSON_KEY,
  type ProductionHistoryInput,
  type ProductionRequestKind,
  type ProductionRequestStatus,
  type ProductionTally,
  type ProductionVerdict,
  type ProductionVerdictFilter,
} from "@/lib/domain/production-requests";
import { loadProductionRequestClients } from "@/lib/internal/production-clients";
import { PRODUCTION_LEAD_ROLES } from "@/lib/domain/production-board";
import { HistoriqueTabs } from "../HistoriqueTabs";
import { ProductionHistoryFilters } from "./ProductionHistoryFilters";
import type { FilterOption } from "./ProductionHistoryFilters";

export const dynamic = "force-dynamic";

/*
 * Historique de production : ce qui a été commandé, pour quand, rendu quand et
 * par qui. La ponctualité vient du module de domaine, le même que celui des
 * Indicateurs — les deux écrans ne peuvent pas se contredire.
 */

const PERIODS: { value: string; label: string; days: number | null }[] = [
  { value: "30j", label: "30 derniers jours", days: 30 },
  { value: "90j", label: "90 derniers jours", days: 90 },
  { value: "6m", label: "6 derniers mois", days: 183 },
  { value: "tout", label: "Depuis le début", days: null },
];
const DEFAULT_PERIOD = "90j";

const VERDICT_FILTERS: { value: ProductionVerdictFilter; label: string }[] = [
  { value: "a_lheure", label: "À l’heure" },
  { value: "en_retard", label: "Livrées en retard" },
  { value: "non_livree_en_retard", label: "Non livrées, en retard" },
  { value: "en_attente", label: "En attente" },
];

const MAX_ROWS = 500;

const VERDICT_TONES: Record<ProductionVerdict["kind"], string> = {
  on_time: "bg-[#e8f8f1] text-[#128359]",
  late: "bg-[#ffedef] text-[#ce3540]",
  overdue: "bg-[#ffedef] text-[#ce3540]",
  pending: "bg-canvas text-ink-soft",
  unknown: "bg-canvas text-ink-faint",
};

const moment = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
});
const dueDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});
const dayOnly = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris",
});

function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

interface HistoryRow extends ProductionHistoryInput {
  id: string;
  kind: ProductionRequestKind;
  title: string;
  clientName: string;
  createdAt: string;
  requestedByName: string | null;
  validatedAt: string | null;
  validatedByName: string | null;
  verdict: ProductionVerdict;
}

export default async function ProductionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; periode?: string; statut?: string; personne?: string }>;
}) {
  await denyCommercial();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const today = todayInParis();

  /*
   * Les noms des clients viennent de `production_request_clients()` : depuis
   * que l'historique porte les commandes de toute l'agence, `clients_select`
   * n'en nommerait qu'une partie et le reste s'afficherait « Client ». La
   * fonction ne rend que l'identifiant et le nom — la fiche client, elle, ne
   * s'ouvre pas.
   */
  const clientsResult = await loadProductionRequestClients();
  const clients = [...clientsResult.names].map(([id, name]) => ({ id, name }));
  const selectedClient = clients.find((client) => client.id === params.client) ?? null;
  const period = PERIODS.find((option) => option.value === params.periode)
    ?? PERIODS.find((option) => option.value === DEFAULT_PERIOD)!;
  const verdictFilter = VERDICT_FILTERS.find((option) => option.value === params.statut)?.value ?? null;

  // Lecture sous RLS : chacun ne voit que les commandes de ses clients.
  let query = supabase
    .from("production_requests")
    .select(`id, client_id, kind, title, created_at, requested_by_name, due_on, status,
      assigned_to, assigned_to_name, delivered_at, delivered_by, delivered_by_name,
      validated_at, validated_by_name`)
    .order("due_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (selectedClient) query = query.eq("client_id", selectedClient.id);
  if (period.days !== null) query = query.gte("due_on", daysBefore(today, period.days));
  const requestsResult = await query;

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">Suivi · production</p>
        <h1 className="page-title mt-1">Historique — Production{selectedClient ? ` · ${selectedClient.name}` : ""}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Ce qui a été commandé à la production : pour quand, rendu quand, par qui.
        </p>
      </div>
      <p className="print-only text-xs text-ink-faint">Édité le {dayOnly.format(new Date())}</p>
    </header>
  );

  /*
   * Une requête en échec ne doit pas se lire comme une absence de commandes :
   * un tableau vide ferait croire que tout a été rendu à l'heure. On le dit.
   */
  const failure = clientsResult.error ? { message: clientsResult.error } : requestsResult.error;
  if (failure) {
    console.error("[historique/production] chargement impossible", failure.message);
    return (
      <div className="history-page space-y-6">
        {header}
        <HistoriqueTabs active="production" clientId={selectedClient?.id ?? params.client ?? null}/>
        <p className="card px-4 py-8 text-center text-sm text-state-changes">
          L’historique de production n’a pas pu être chargé. Réessayez dans un instant ; si le problème
          persiste, l’erreur technique est : {failure.message}
        </p>
      </div>
    );
  }

  const rows: HistoryRow[] = (requestsResult.data ?? []).map((row) => {
    const input: ProductionHistoryInput = {
      dueOn: row.due_on as string,
      deliveredAt: (row.delivered_at as string | null) ?? null,
      status: row.status as ProductionRequestStatus,
      assignedToId: (row.assigned_to as string | null) ?? null,
      assignedToName: (row.assigned_to_name as string | null) ?? null,
      deliveredById: (row.delivered_by as string | null) ?? null,
      deliveredByName: (row.delivered_by_name as string | null) ?? null,
    };
    return {
      ...input,
      id: row.id as string,
      kind: row.kind as ProductionRequestKind,
      title: row.title as string,
      clientName: clientsResult.names.get(row.client_id as string) ?? "Client",
      createdAt: row.created_at as string,
      requestedByName: (row.requested_by_name as string | null) ?? null,
      validatedAt: (row.validated_at as string | null) ?? null,
      validatedByName: (row.validated_by_name as string | null) ?? null,
      verdict: productionVerdict(input, today),
    };
  });

  // Personnes proposées : celles qui apparaissent sur la période, plus « non renseigné ».
  const peopleByKey = new Map<string, string>();
  for (const row of rows) {
    for (const person of involvedPeople(row)) {
      if (!peopleByKey.has(person.key)) peopleByKey.set(person.key, person.name ?? "Ancien membre");
    }
  }
  const people: FilterOption[] = [
    ...[...peopleByKey].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    { value: UNKNOWN_PERSON_KEY, label: "Non renseigné" },
  ];
  const personKey = params.personne && people.some((person) => person.value === params.personne)
    ? params.personne
    : null;

  /*
   * La synthèse suit le client, la période et la personne choisis ; le tableau
   * par personne compare tout le monde sur le même périmètre ; le verdict ne
   * filtre que le détail — sans quoi « en retard » afficherait 0 % à l'heure.
   * Les tuiles d'une personne ne comptent que ce dont elle répond (même règle
   * que « Par personne ») ; la liste montre aussi ce qu'elle a livré pour un autre.
   */
  const scoped = personKey ? rows.filter((row) => matchesPerson(row, personKey)) : rows;
  const accountable = personKey ? rows.filter((row) => isResponsible(row, personKey)) : rows;
  const summary = productionHistorySummary(accountable, today);
  const byPerson = productionHistorySummary(rows, today).byPerson;
  const detail = verdictFilter ? scoped.filter((row) => matchesVerdictFilter(row.verdict, verdictFilter)) : scoped;

  return (
    <div className="history-page space-y-6">
      {header}

      <HistoriqueTabs active="production" clientId={selectedClient?.id ?? null}/>

      <ProductionHistoryFilters
        state={{
          client: selectedClient?.id ?? "",
          periode: period.value,
          statut: verdictFilter ?? "",
          personne: personKey ?? "",
        }}
        clients={clients.map((client) => ({ value: client.id, label: client.name }))}
        periods={PERIODS.map(({ value, label }) => ({ value, label }))}
        statuses={VERDICT_FILTERS}
        people={people}
      />

      <p className="print-only text-xs text-ink-faint">
        {selectedClient ? selectedClient.name : "Tous les clients"} · échéances : {period.label.toLowerCase()}
        {personKey ? ` · ${people.find((person) => person.value === personKey)?.label}` : ""}
        {verdictFilter ? ` · ${VERDICT_FILTERS.find((option) => option.value === verdictFilter)?.label}` : ""}
      </p>

      <SummaryTiles total={summary.total}/>

      {/*
        Le palmarès nominatif reste à l'encadrement : depuis que l'historique
        porte les commandes de toute l'agence, ce tableau classerait chaque
        graphiste et vidéaste devant toute l'équipe. Le détail des commandes,
        lui, reste lisible de tous.
      */}
      {byPerson.length > 0 && (PRODUCTION_LEAD_ROLES as readonly string[]).includes(profile.role) && (
        <section className="section-card">
          <div className="section-card-header">
            <div>
              <h2 className="text-sm font-semibold">Par personne</h2>
              <p className="mt-0.5 text-xs text-ink-faint">
                La personne à qui la commande était confiée ; à défaut, celle qui l’a livrée.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-canvas text-[11px] font-semibold uppercase tracking-[.08em] text-ink-faint">
                <tr>
                  <th scope="col" className="px-5 py-2.5">Personne</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Commandes</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Livrées</th>
                  <th scope="col" className="px-3 py-2.5 text-right">À l’heure</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Retard moyen</th>
                  <th scope="col" className="px-5 py-2.5 text-right">Non livrées en retard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byPerson.map((person) => (
                  <tr key={person.key ?? UNKNOWN_PERSON_KEY}>
                    <td className="px-5 py-2.5 font-medium">
                      {person.name ?? <span className="font-normal text-ink-faint">Non renseigné</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{person.orders}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{person.delivered}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {person.onTimeRate === null ? "—" : `${person.onTimeRate} % (${person.onTime}/${person.delivered})`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatDelay(person.averageDelayDays)}</td>
                    <td className={`px-5 py-2.5 text-right tabular-nums ${person.overdue > 0 ? "font-semibold text-state-changes" : ""}`}>
                      {person.overdue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Commandes</h2>
          <span className="text-xs text-ink-faint">
            {detail.length} affichée{detail.length > 1 ? "s" : ""}
            {rows.length >= MAX_ROWS ? ` · limitées aux ${MAX_ROWS} échéances les plus récentes` : ""}
          </span>
        </div>

        {detail.length === 0 ? (
          <p className="card px-4 py-8 text-center text-sm text-ink-faint">
            {rows.length === 0 ? "Aucune commande de production sur cette période." : "Aucune commande ne correspond à ces filtres."}
          </p>
        ) : (
          <>
            <div className="card hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="bg-canvas text-[11px] font-semibold uppercase tracking-[.08em] text-ink-faint">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Commande</th>
                    <th scope="col" className="px-3 py-2.5">Commandée</th>
                    <th scope="col" className="px-3 py-2.5">Confiée à</th>
                    <th scope="col" className="px-3 py-2.5">Échéance</th>
                    <th scope="col" className="px-3 py-2.5">Livrée</th>
                    <th scope="col" className="px-3 py-2.5">Validée</th>
                    <th scope="col" className="px-4 py-2.5">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {detail.map((row) => (
                    <tr key={row.id} className="break-inside-avoid">
                      <td className="max-w-[16rem] px-4 py-3">
                        <span className="badge bg-[#f1edff] text-[#6f50c9]">{PRODUCTION_KIND_LABELS[row.kind] ?? "Production"}</span>
                        <p className="mt-1 font-semibold leading-snug text-ink">{row.title}</p>
                        <p className="text-ink-faint">{row.clientName}</p>
                      </td>
                      <td className="px-3 py-3"><Stamp at={row.createdAt} by={row.requestedByName}/></td>
                      <td className="px-3 py-3"><Person name={row.assignedToName}/></td>
                      <td className="whitespace-nowrap px-3 py-3">{dueDay.format(new Date(`${row.dueOn}T12:00:00Z`))}</td>
                      <td className="px-3 py-3"><Stamp at={row.deliveredAt} by={row.deliveredByName} empty="—"/></td>
                      <td className="px-3 py-3"><Stamp at={row.validatedAt} by={row.validatedByName} empty="—"/></td>
                      <td className="px-4 py-3"><VerdictBadge verdict={row.verdict}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-3 md:hidden">
              {detail.map((row) => (
                <li key={row.id} className="card break-inside-avoid p-4 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="badge bg-[#f1edff] text-[#6f50c9]">{PRODUCTION_KIND_LABELS[row.kind] ?? "Production"}</span>
                      <p className="mt-1 text-sm font-semibold leading-snug">{row.title}</p>
                      <p className="text-ink-faint">{row.clientName}</p>
                    </div>
                    <VerdictBadge verdict={row.verdict}/>
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                    <dt className="text-ink-faint">Commandée</dt>
                    <dd><Stamp at={row.createdAt} by={row.requestedByName}/></dd>
                    <dt className="text-ink-faint">Confiée à</dt>
                    <dd><Person name={row.assignedToName}/></dd>
                    <dt className="text-ink-faint">Échéance</dt>
                    <dd>{dueDay.format(new Date(`${row.dueOn}T12:00:00Z`))}</dd>
                    <dt className="text-ink-faint">Livrée</dt>
                    <dd><Stamp at={row.deliveredAt} by={row.deliveredByName} empty="—"/></dd>
                    <dt className="text-ink-faint">Validée</dt>
                    <dd><Stamp at={row.validatedAt} by={row.validatedByName} empty="—"/></dd>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="space-y-1.5 rounded-2xl bg-[#e8f2ff] px-4 py-3 text-xs leading-relaxed text-[#385a78]">
        <p>
          À l’heure : livrée au plus tard le jour de l’échéance, heure de Paris. « Livrée » est la date du dernier
          dépôt ; un renvoi en production efface la livraison précédente.
        </p>
        <p>
          Avant le 18 septembre 2026, ni la personne à qui la commande était confiée ni celle qui l’a validée
          n’étaient enregistrées : elles restent « non renseigné ». Qui a livré a été retrouvé d’après le fichier déposé.
        </p>
        <p>
          Corrections clients non comptées : aucune date de livraison n’est enregistrée et leur échéance est
          celle de la fiche.
        </p>
      </div>
    </div>
  );
}

function formatDelay(days: number | null): string {
  if (days === null) return "—";
  return `${String(days).replace(".", ",")} j`;
}

function SummaryTiles({ total }: { total: ProductionTally }) {
  return (
    <section className="card grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-6">
      <Tile valeur={total.orders} libelle={total.orders > 1 ? "commandes" : "commande"}/>
      <Tile
        valeur={total.onTimeRate === null ? "—" : `${total.onTimeRate} %`}
        libelle={total.delivered === 0 ? "à l’heure · aucune livraison" : `à l’heure (${total.onTime}/${total.delivered} livrées)`}
      />
      <Tile valeur={formatDelay(total.averageDelayDays)} libelle="retard moyen des livraisons en retard"/>
      <Tile valeur={total.late} libelle={total.late > 1 ? "livrées en retard" : "livrée en retard"}/>
      <Tile
        valeur={total.overdue}
        libelle={total.overdue > 1 ? "non livrées, échéance passée" : "non livrée, échéance passée"}
        alerte={total.overdue > 0}
      />
      <Tile valeur={total.pending} libelle="en attente, dans les temps"/>
    </section>
  );
}

function Tile({ valeur, libelle, alerte = false }: { valeur: number | string; libelle: string; alerte?: boolean }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2.5">
      <p className={`text-xl font-semibold tracking-[-.02em] ${alerte ? "text-state-changes" : ""}`}>{valeur}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-ink-faint">{libelle}</p>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: ProductionVerdict }) {
  return <span className={`badge whitespace-nowrap ${VERDICT_TONES[verdict.kind]}`}>{productionVerdictLabel(verdict)}</span>;
}

function Person({ name }: { name: string | null }) {
  if (!name) return <span className="text-ink-faint">non renseigné</span>;
  return <span title={name}>{firstNameOf(name) ?? name}</span>;
}

/** Date et auteur d'un geste ; l'auteur manquant est dit, pas deviné. */
function Stamp({ at, by, empty = "non renseigné" }: { at: string | null; by: string | null; empty?: string }) {
  if (!at) return <span className="text-ink-faint">{empty}</span>;
  return (
    <span className="block whitespace-nowrap">
      {moment.format(new Date(at))}
      <span className="block text-ink-faint">
        {by ? <>par <span className="text-ink-soft" title={by}>{firstNameOf(by) ?? by}</span></> : "par : non renseigné"}
      </span>
    </span>
  );
}

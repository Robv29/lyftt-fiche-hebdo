"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestShooting, type ShootingActionResult } from "./actions";
import {
  SHOOTING_KIND_LABELS,
  SHOOTING_STATUS_LABELS,
  filterShootings,
  formatDuration,
  shootingStats,
  shootingsByKind,
  shootingsPerMonth,
  onTimeRate,
  type ShootingKind,
  type ShootingStatus,
} from "@/lib/domain/shootings";

export interface ShootingRow {
  lineId: string;
  clientId: string;
  clientName: string;
  date: string;
  label: string;
  status: ShootingStatus;
  kind: ShootingKind | null;
  place: string | null;
  leadName: string | null;
  durationMinutes: number | null;
  deliveryDays: number | null;
  deliveredOn: string | null;
  assetsCount: number | null;
}

const STATUS_STYLE: Record<ShootingStatus, string> = {
  realise: "bg-state-approved/10 text-state-approved",
  cale: "bg-[#e8f2ff] text-[#0b5e9f]",
  annule: "bg-state-changes/10 text-state-changes",
};

const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("fr-FR", {
  month: "short", year: "2-digit", timeZone: "UTC",
});

const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));

export function ShootingsView({
  shootings,
  clients,
}: {
  shootings: ShootingRow[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState<ShootingActionResult | null>(null);
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const shown = useMemo(() => filterShootings(shootings, {
    clientId: clientId || null,
    status: (status || null) as ShootingStatus | null,
    kind: (kind || null) as ShootingKind | null,
    from: from || null,
    to: to || null,
  }), [shootings, clientId, status, kind, from, to]);

  const stats = useMemo(() => shootingStats(shown), [shown]);
  const punctuality = useMemo(() => onTimeRate(stats), [stats]);
  const perMonth = useMemo(() => shootingsPerMonth(shown), [shown]);
  const byKind = useMemo(() => shootingsByKind(shown), [shown]);
  const peak = Math.max(1, ...perMonth.map((entry) => entry.count));
  const filtered = Boolean(clientId || status || kind || from || to);

  return (
    <div className="space-y-6">
      {/*
        Demander un shooting ne crée pas de shooting : cela passe par les
        tickets clients, où le chef de projet accuse réception. Créer une date
        ici sans qu'il l'ait validée aurait mis deux personnes en désaccord sur
        un tournage à organiser.
      */}
      <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        {feedback?.message && (
          <p className={`mb-3 rounded-xl border px-4 py-3 text-sm ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}>
            {feedback.message}
          </p>
        )}
        {asking ? (
          <form
            action={(formData) => startTransition(async () => {
              const result = await requestShooting(formData);
              setFeedback(result);
              if (result.ok) { setAsking(false); router.refresh(); }
            })}
            className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end"
          >
            <Field label="Client">
              <select name="clientId" required className="field bg-white" defaultValue={clientId}>
                <option value="">Choisir…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Ce qui est demandé">
              <input name="note" required maxLength={2000} className="field bg-white"
                placeholder="Tournage produits, prévoir une demi-journée en boutique"/>
            </Field>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={pending}>
                {pending ? "Envoi…" : "Envoyer"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              Un shooting à organiser&nbsp;? La demande part au chef de projet, qui en accuse réception.
            </p>
            <button type="button" className="btn-primary" onClick={() => { setAsking(true); setFeedback(null); }}>
              Demander un shooting
            </button>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Shootings réalisés" value={String(stats.done)} />
        <Kpi label="À venir" value={String(stats.upcoming)} />
        <Kpi label="Contenus livrés" value={String(stats.assets)} />
        <Kpi
          label="Durée moyenne"
          value={formatDuration(stats.averageMinutes)}
          /*
            Une moyenne calculée sur trois fiches parmi vingt se lirait comme
            une moyenne générale : on dit sur quoi elle porte.
          */
          detail={stats.missingDuration > 0
            ? `${stats.missingDuration} durée${stats.missingDuration > 1 ? "s" : ""} non renseignée${stats.missingDuration > 1 ? "s" : ""}`
            : null}
        />
        <Kpi label="Durée totale" value={formatDuration(stats.totalMinutes)} />
        {/*
          Sans délai promis ni date de livraison, il n'y a rien à mesurer :
          afficher « 0 % à temps » se lirait comme une catastrophe, alors que
          c'est une absence d'information.
        */}
        <Kpi
          label="Livraisons à temps"
          value={punctuality === null ? "—" : `${punctuality} %`}
          detail={stats.measuredDeliveries === 0
            ? "Aucune livraison datée"
            : `sur ${stats.measuredDeliveries} livraison${stats.measuredDeliveries > 1 ? "s" : ""} mesurée${stats.measuredDeliveries > 1 ? "s" : ""}`}
        />
      </section>

      <section className="rounded-2xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Field label="Client">
            <select className="field bg-white" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Tous</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select className="field bg-white" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous</option>
              {(Object.keys(SHOOTING_STATUS_LABELS) as ShootingStatus[]).map((key) => (
                <option key={key} value={key}>{SHOOTING_STATUS_LABELS[key]}</option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select className="field bg-white" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Tous</option>
              {(Object.keys(SHOOTING_KIND_LABELS) as ShootingKind[]).map((key) => (
                <option key={key} value={key}>{SHOOTING_KIND_LABELS[key]}</option>
              ))}
            </select>
          </Field>
          <Field label="Du"><input type="date" className="field bg-white" value={from} onChange={(e) => setFrom(e.target.value)}/></Field>
          <Field label="Au"><input type="date" className="field bg-white" value={to} onChange={(e) => setTo(e.target.value)}/></Field>
          {filtered && (
            <button
              type="button"
              className="text-xs font-semibold text-accent hover:underline"
              onClick={() => { setClientId(""); setStatus(""); setKind(""); setFrom(""); setTo(""); }}
            >
              Tout afficher
            </button>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-faint">
            {filtered ? "Aucun shooting ne correspond à ces filtres." : "Aucun shooting inscrit."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((shooting) => (
              <li key={shooting.lineId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`badge shrink-0 ${STATUS_STYLE[shooting.status]}`}>
                  {SHOOTING_STATUS_LABELS[shooting.status]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{shooting.label}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-faint">
                    <Link href={`/clients/${shooting.clientId}`} className="hover:text-ink">
                      {shooting.clientName}
                    </Link>
                    {" · "}{formatDay(shooting.date)}
                    {shooting.kind ? ` · ${SHOOTING_KIND_LABELS[shooting.kind]}` : ""}
                    {shooting.place ? ` · ${shooting.place}` : ""}
                    {shooting.leadName ? ` · ${shooting.leadName}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">
                  {formatDuration(shooting.durationMinutes)}
                </span>
                {/*
                  La fiche du shooting, pas le budget : cet onglet est fait pour
                  la production, et le budget lui est fermé par la RLS.
                */}
                <Link href={`/shootings/${shooting.lineId}`} className="shrink-0 text-xs font-semibold text-accent hover:underline">
                  Ouvrir la fiche
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {perMonth.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <p className="eyebrow">Shootings réalisés par mois</p>
            <ul className="mt-4 flex items-end gap-2" style={{ height: 140 }}>
              {perMonth.map((entry) => (
                <li key={entry.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] font-semibold text-ink-soft">{entry.count}</span>
                  <span
                    className="w-full rounded-t bg-[#1176d3]"
                    style={{ height: `${Math.round((entry.count / peak) * 100)}%`, minHeight: 4 }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-[10px] text-ink-faint">
                    {monthFormat.format(new Date(`${entry.month}-01T00:00:00Z`))}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <p className="eyebrow">Par type</p>
            <ul className="mt-4 space-y-2 text-sm">
              {(Object.keys(SHOOTING_KIND_LABELS) as ShootingKind[]).map((key) => (
                <li key={key} className="flex items-center justify-between gap-3">
                  <span>{SHOOTING_KIND_LABELS[key]}</span>
                  <strong>{byKind.counts[key]}</strong>
                </li>
              ))}
              {byKind.unknown > 0 && (
                <li className="flex items-center justify-between gap-3 border-t border-line pt-2 text-ink-faint">
                  <span>Type non renseigné</span>
                  <strong>{byKind.unknown}</strong>
                </li>
              )}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[.12em] text-ink-faint">{label}</p>
      <strong className="mt-1 block text-2xl tracking-[-.04em]">{value}</strong>
      {detail && <p className="mt-1 text-[11px] text-ink-faint">{detail}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

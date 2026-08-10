"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { formatEuros } from "@/lib/domain/budget";
import {
  INVOICE_STATUS_LABELS,
  isInvoiceSettled,
  nextInvoiceStatus,
  type InvoiceStatus,
} from "@/lib/domain/invoicing";
import { setInvoiceStatus, setMonthInvoiceStatus, type BudgetActionResult } from "../actions";

export interface ClientDossier {
  clientId: string;
  clientName: string;
  totalCents: number;
  lineCount: number;
  status: InvoiceStatus;
  details: string[];
}

export interface MonthDossier {
  month: string;
  label: string;
  clients: ClientDossier[];
  totalCents: number;
}

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  a_faire: "bg-[#fff4e5] text-[#8a5700]",
  faite: "bg-[#e8f2ff] text-[#0b5e9f]",
  prelevement_programme: "bg-[#e8f8f1] text-state-approved",
};

export function InvoiceRun({ dossiers }: { dossiers: MonthDossier[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<BudgetActionResult | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(dossiers[0]?.month ?? null);

  const run = (action: () => Promise<BudgetActionResult>) => {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok) router.refresh();
      } catch {
        setFeedback({ ok: false, message: "Enregistrement interrompu. Réessayez." });
      }
    });
  };

  if (dossiers.length === 0) {
    return (
      <p className="card px-4 py-10 text-center text-sm text-ink-faint">
        Aucune prestation notée sur un client au comptant. Ouvrez la fiche budget
        d&apos;un client pour en ajouter.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {feedback?.message && (
        <p className={`rounded-md border px-4 py-3 text-sm ${feedback.ok ? "border-state-approved/30 bg-state-approved/5 text-state-approved" : "border-state-changes/30 bg-state-changes/5 text-state-changes"}`}>
          {feedback.message}
        </p>
      )}

      {dossiers.map((dossier) => {
        /*
         * Les actions groupées ne visent que les dossiers non encore avancés :
         * marquer un mois « facturé » ne doit pas faire reculer ceux qui sont
         * déjà en prélèvement.
         */
        const toInvoice = dossier.clients.filter((client) => client.status === "a_faire");
        const toSchedule = dossier.clients.filter((client) => client.status === "faite");
        const settled = dossier.clients.every((client) => isInvoiceSettled(client.status));
        const open = openMonth === dossier.month;

        return (
          <section key={dossier.month} className={`card overflow-hidden ${settled ? "border-state-approved/40" : ""}`}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
              <button
                type="button"
                className="min-w-0 text-left"
                aria-expanded={open}
                onClick={() => setOpenMonth(open ? null : dossier.month)}
              >
                <h2 className="font-semibold capitalize">{dossier.label}</h2>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {dossier.clients.length} client{dossier.clients.length > 1 ? "s" : ""} ·{" "}
                  {settled
                    ? "tout est prélevé"
                    : `${toInvoice.length} à facturer, ${toSchedule.length} à prélever`}
                </p>
              </button>
              <div className="flex items-center gap-3">
                <strong className="text-sm">{formatEuros(dossier.totalCents)}</strong>
                <Icon name="arrow" className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}/>
              </div>
            </header>

            <div className="flex flex-wrap gap-2 border-b bg-[#fbfcfe] p-4">
              <button
                type="button"
                className="btn-primary"
                disabled={pending || toInvoice.length === 0}
                onClick={() => run(() => setMonthInvoiceStatus(
                  dossier.month,
                  "faite",
                  toInvoice.map((client) => client.clientId),
                ))}
              >
                <Icon name="check" className="h-4 w-4"/>
                Tout facturer ({toInvoice.length})
              </button>
              <button
                type="button"
                className="btn-primary bg-state-approved"
                disabled={pending || toSchedule.length === 0}
                onClick={() => run(() => setMonthInvoiceStatus(
                  dossier.month,
                  "prelevement_programme",
                  toSchedule.map((client) => client.clientId),
                ))}
              >
                <Icon name="check" className="h-4 w-4"/>
                Tout prélever ({toSchedule.length})
              </button>
            </div>

            {open && (
              <ul className="divide-y">
                {dossier.clients.map((client) => {
                  const next = nextInvoiceStatus(client.status);
                  return (
                    <li key={client.clientId} className={`flex flex-wrap items-center justify-between gap-3 p-4 ${isInvoiceSettled(client.status) ? "bg-[#f6fdf9]" : ""}`}>
                      <div className="min-w-0">
                        <Link href={`/budget/${client.clientId}`} className="text-sm font-medium hover:underline">
                          {client.clientName}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-ink-faint" title={client.details.join(" · ")}>
                          {client.details.join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <strong className="text-sm">{formatEuros(client.totalCents)}</strong>
                        <span className={`badge shrink-0 ${STATUS_BADGE[client.status]}`}>
                          {INVOICE_STATUS_LABELS[client.status]}
                        </span>
                        {next && (
                          <button
                            type="button"
                            className={`text-xs font-semibold hover:underline ${next === "prelevement_programme" ? "text-state-approved" : "text-[#0b5e9f]"}`}
                            disabled={pending}
                            onClick={() => run(() => setInvoiceStatus(client.clientId, dossier.month, next))}
                          >
                            {next === "faite" ? "Facture faite" : "Prélèvement programmé"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

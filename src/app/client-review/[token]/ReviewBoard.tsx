"use client";

import { useState, useTransition } from "react";
import { approveAll, approveItem, createTicket, type ActionResult } from "./actions";
import { TicketForm } from "./TicketForm";
import type { ReviewItem, ReviewSheet } from "@/lib/review/access";
import { canApproveAll } from "@/lib/domain/sheet-status";
import {
  ITEM_APPROVAL_STATUS_LABELS,
  MEDIA_FORMAT_LABELS,
  PUBLICATION_TYPE_LABELS,
  SOCIAL_NETWORK_LABELS,
} from "@/lib/domain/types";

/** §5 — Consultation de la fiche, validation et demandes de modification. */
export function ReviewBoard({ token, sheet }: { token: string; sheet: ReviewSheet }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionResult | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [duplicateItemId, setDuplicateItemId] = useState<string | null>(null);

  const openTicketStatuses = sheet.items.flatMap((item) =>
    Array.from({ length: item.openTicketCount }, () => "new" as const),
  );

  const showApproveAll = canApproveAll({
    items: sheet.items.map((item) => ({
      approvalStatus: item.approvalStatus,
      isCancelled: item.isCancelled,
    })),
    ticketStatuses: openTicketStatuses,
  });

  const run = (action: () => Promise<ActionResult>, itemId?: string) => {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) {
        setOpenForm(null);
        setDuplicateItemId(null);
      } else if (result.duplicateOf && itemId) {
        setDuplicateItemId(itemId);
      }
    });
  };

  return (
    <section>
      {feedback?.message && (
        <p
          role="status"
          className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <ul className="space-y-4">
        {sheet.items.map((item) => (
          <li key={item.id} className="card lift-card overflow-hidden">
            <PublicationCard
              item={item}
              pending={pending}
              isFormOpen={openForm === item.id}
              needsDuplicateConfirmation={duplicateItemId === item.id}
              onApprove={() =>
                run(() => {
                  const formData = new FormData();
                  formData.set("itemId", item.id);
                  return approveItem(token, formData);
                })
              }
              onToggleForm={() => {
                setOpenForm(openForm === item.id ? null : item.id);
                setFeedback(null);
                setDuplicateItemId(null);
              }}
              onSubmitTicket={(formData) => {
                if (duplicateItemId === item.id) formData.set("confirmDuplicate", "1");
                run(() => createTicket(token, formData), item.id);
              }}
            />
          </li>
        ))}
      </ul>

      <div className="sticky bottom-3 z-10 mt-8 flex flex-col gap-3 rounded-2xl border border-white/80 bg-white/90 p-3 shadow-[0_16px_45px_rgba(32,72,108,.16)] backdrop-blur-xl sm:flex-row sm:items-center sm:p-4">
        {showApproveAll && (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              run(() => {
                const formData = new FormData();
                return approveAll(token, formData);
              })
            }
          >
            {pending ? "Validation…" : "Tout valider"}
          </button>
        )}

        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setOpenForm(openForm === "sheet" ? null : "sheet");
            setFeedback(null);
          }}
        >
          J&apos;ai une modification à demander
        </button>
      </div>

      {openForm === "sheet" && (
        <TicketForm
          item={null}
          pending={pending}
          onSubmit={(formData) => run(() => createTicket(token, formData))}
          onCancel={() => setOpenForm(null)}
        />
      )}
    </section>
  );
}

interface CardProps {
  item: ReviewItem;
  pending: boolean;
  isFormOpen: boolean;
  needsDuplicateConfirmation: boolean;
  onApprove: () => void;
  onToggleForm: () => void;
  onSubmitTicket: (formData: FormData) => void;
}

function PublicationCard({
  item,
  pending,
  isFormOpen,
  needsDuplicateConfirmation,
  onApprove,
  onToggleForm,
  onSubmitTicket,
}: CardProps) {
  const isApproved = ["approved", "approved_after_fix"].includes(item.approvalStatus);
  const hasOpenRequest = item.openTicketCount > 0;

  return (
    <article className={item.isCancelled ? "opacity-60" : undefined}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-[#fbfcfe] px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            {formatDay(item.scheduledDate)}
            {item.scheduledTime && (
              <span className="ml-2 font-normal text-ink-soft">
                {item.scheduledTime.slice(0, 5).replace(":", "h")}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            {PUBLICATION_TYPE_LABELS[item.publicationType]} ·{" "}
            {MEDIA_FORMAT_LABELS[item.format]}
            {item.networks.length > 0 && (
              <> · {item.networks.map((n) => SOCIAL_NETWORK_LABELS[n]).join(", ")}</>
            )}
          </p>
        </div>
        <StatusBadge item={item} />
      </header>

      <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,190px)_1fr] sm:p-5">
        <MediaPreview item={item} />

        <div className="min-w-0">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {item.caption || <span className="text-ink-faint">Texte à venir</span>}
          </p>
          {item.hashtags.length > 0 && (
            <p className="mt-3 break-words text-sm text-ink-soft">
              {item.hashtags.join(" ")}
            </p>
          )}
        </div>
      </div>

      {item.isCancelled ? (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-faint">
          Cette publication a été annulée.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-line bg-[#fbfcfe] px-4 py-4 sm:px-5">
          {!isApproved && !hasOpenRequest && (
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={onApprove}
            >
              Valider
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onToggleForm}>
            {isFormOpen ? "Fermer" : "Demander une modification"}
          </button>
        </div>
      )}

      {isFormOpen && (
        <div className="px-4 pb-4">
          {needsDuplicateConfirmation && (
            <p className="mb-3 rounded-md border border-state-progress/30 bg-state-progress/5 px-3 py-2 text-xs text-state-progress">
              Envoyez à nouveau pour confirmer la création d&apos;une seconde demande.
            </p>
          )}
          <TicketForm
            item={item}
            pending={pending}
            onSubmit={onSubmitTicket}
            onCancel={onToggleForm}
          />
        </div>
      )}
    </article>
  );
}

function StatusBadge({ item }: { item: ReviewItem }) {
  const label = ITEM_APPROVAL_STATUS_LABELS[item.approvalStatus];
  const tone = ["approved", "approved_after_fix"].includes(item.approvalStatus)
    ? "bg-state-approved/10 text-state-approved"
    : item.approvalStatus === "changes_requested"
      ? "bg-state-changes/10 text-state-changes"
      : item.approvalStatus === "pending"
        ? "bg-canvas text-ink-soft"
        : "bg-state-progress/10 text-state-progress";

  return <span className={`badge ${tone}`}>{label}</span>;
}

/**
 * §5 — Une vidéo non téléversée n'empêche pas le commentaire : on affiche une
 * miniature, un lien, ou la mention « Vidéo transmise séparément ».
 */
function MediaPreview({ item }: { item: ReviewItem }) {
  /*
   * Carrousel : le client doit voir toutes les images avant de valider.
   * Elles défilent horizontalement, au format réel, plutôt que d'être
   * empilées — c'est ainsi qu'elles seront vues sur le réseau.
   */
  if (item.gallery.length > 1) {
    return (
      <div>
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2" aria-label={`Carrousel de ${item.gallery.length} images`}>
          {item.gallery.map((image, index) => (
            <figure key={`${image.fileName}-${index}`} className="relative w-[78%] shrink-0 snap-center sm:w-[62%]">
              {image.kind === "video" && image.url
                ? <video controls preload="metadata" className="max-h-[70vh] w-full rounded-2xl border border-line bg-black object-contain"><source src={image.url}/></video>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={image.url ?? undefined} alt={`Image ${index + 1} sur ${item.gallery.length} du ${formatDay(item.scheduledDate)}`} className="max-h-[70vh] w-full rounded-2xl border border-line bg-canvas object-contain"/>}
              <figcaption className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
                {index + 1}/{item.gallery.length}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-1 text-center text-[11px] text-ink-faint">Faites défiler pour voir les {item.gallery.length} images.</p>
      </div>
    );
  }

  if (item.media?.kind === "video" && item.media.url) {
    return (
      /*
       * Format réel, sans recadrage : un carré tronquait le haut et le bas des
       * reels verticaux, et le client validait un cadrage qui n'était pas celui
       * de la publication. La hauteur est simplement bornée pour que la carte
       * reste lisible.
       */
      <video
        controls
        preload="metadata"
        poster={item.media.thumbnailUrl ?? undefined}
        className="max-h-[70vh] w-full rounded-2xl border border-line bg-black object-contain"
      >
        <source src={item.media.url} />
      </video>
    );
  }

  if (item.media?.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.media.thumbnailUrl ?? item.media.url}
        alt={`Visuel du ${formatDay(item.scheduledDate)}`}
        className="max-h-[70vh] w-full rounded-2xl border border-line bg-canvas object-contain"
      />
    );
  }

  if (item.mediaExternalUrl) {
    return (
      <a
        href={item.mediaExternalUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-line bg-canvas px-3 py-6 text-center text-xs underline"
      >
        Voir le visuel
      </a>
    );
  }

  return (
    <p className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-line bg-canvas px-3 py-6 text-center text-xs text-ink-faint">
      {item.mediaPendingNote ?? "Vidéo transmise séparément"}
    </p>
  );
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

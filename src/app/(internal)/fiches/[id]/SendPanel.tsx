"use client";

import { useMemo, useState, useTransition } from "react";
import {
  generateReviewLink,
  markMessageSent,
  revokeReviewLink,
  type InternalActionResult,
} from "@/lib/internal/actions";
import {
  isRenderComplete,
  renderTemplate,
  whatsappLink,
  type TemplateContext,
} from "@/lib/domain/templates";
import type { MessageTemplateType } from "@/lib/domain/types";

interface Template {
  type: MessageTemplateType;
  label: string;
  body: string;
}

interface ActiveLink {
  id: string;
  tokenPrefix: string;
  expiresAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
}

/**
 * §2 / §4 — Génération du lien puis message d'accompagnement prérempli.
 *
 * L'envoi WhatsApp n'est pas automatisé : le community manager copie le
 * message, l'envoie lui-même, puis marque l'envoi comme fait.
 */
export function SendPanel({
  sheetId,
  activeLink,
  templates,
  context,
  recipientPhone,
  recipients,
  recipientLabel,
  canSend,
  initialTemplateType = "standard",
}: {
  sheetId: string;
  hasActiveLink: boolean;
  activeLink: ActiveLink | null;
  templates: Template[];
  context: TemplateContext;
  recipientPhone?: string;
  /** Tous les contacts qui reçoivent le planning. */
  recipients?: { name: string; phone: string | null }[];
  recipientLabel?: string;
  canSend: boolean;
  /** Modèle présélectionné — « reminder » quand on arrive par « Relancer ». */
  initialTemplateType?: MessageTemplateType;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<InternalActionResult | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [templateType, setTemplateType] = useState<MessageTemplateType>(initialTemplateType);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const template = templates.find((t) => t.type === templateType) ?? templates[0];

  const rendered = useMemo(
    /*
     * Le second lien dérive du premier : même jeton, même expiration. Le
     * client n'a donc qu'une adresse à conserver, et révoquer le lien ferme
     * les deux accès d'un coup.
     */
    () => renderTemplate(template.body, {
      ...context,
      review_link: reviewUrl ?? "",
      request_link: reviewUrl ? `${reviewUrl}/demandes` : "",
    }),
    [template, context, reviewUrl],
  );

  const body = draft ?? rendered.body;
  const complete = isRenderComplete(rendered) && Boolean(reviewUrl);

  const run = (action: () => Promise<InternalActionResult>) => {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.reviewUrl) {
        setReviewUrl(result.reviewUrl);
        setDraft(null);
      }
    });
  };

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Envoi au client</h2>

      {feedback?.message && (
        <p
          className={`mt-2 rounded-md border px-3 py-2 text-xs ${
            feedback.ok
              ? "border-state-approved/30 bg-state-approved/5 text-state-approved"
              : "border-state-changes/30 bg-state-changes/5 text-state-changes"
          }`}
        >
          {feedback.message}
        </p>
      )}

      {activeLink && !reviewUrl && (
        <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink-soft">
          <p>
            Un lien actif existe (…{activeLink.tokenPrefix}) — {activeLink.accessCount}{" "}
            consultation(s).
          </p>
          <p className="mt-1">
            {activeLink.lastAccessedAt
              ? `Dernière consultation le ${new Date(activeLink.lastAccessedAt).toLocaleDateString("fr-FR")}`
              : "Jamais consulté."}
          </p>
          <p className="mt-1">
            Le lien complet n&apos;est affiché qu&apos;à sa création. Régénérez-le si vous
            ne l&apos;avez plus.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !canSend}
          onClick={() => run(() => generateReviewLink(sheetId))}
        >
          {activeLink ? "Régénérer le lien" : "Générer le lien client"}
        </button>

        {activeLink && (
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() =>
              run(() => revokeReviewLink(activeLink.id, sheetId, "Révocation manuelle"))
            }
          >
            Révoquer
          </button>
        )}
      </div>

      {!canSend && <p className="mt-2 text-xs leading-relaxed text-state-progress">Le lien client sera disponible lorsque la préparation atteindra 100 %.</p>}

      {reviewUrl && (
        <div className="mt-3 rounded-md border border-state-approved/30 bg-state-approved/5 px-3 py-2">
          <p className="text-xs font-medium text-state-approved">
            Lien créé — copiez-le maintenant, il ne sera plus affiché.
          </p>
          <p className="mt-1 break-all font-mono text-xs">{reviewUrl}</p>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <label className="label" htmlFor="template">
          Modèle de message
        </label>
        <select
          id="template"
          className="field"
          value={templateType}
          onChange={(event) => {
            setTemplateType(event.target.value as MessageTemplateType);
            setDraft(null);
            setCopied(false);
          }}
        >
          {templates.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>

        <label className="label mt-3" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          rows={12}
          className="field font-mono text-xs"
          value={body}
          onChange={(event) => {
            setDraft(event.target.value);
            setCopied(false);
          }}
        />

        {!reviewUrl && (
          <p className="mt-2 text-xs text-state-progress">
            Générez d&apos;abord le lien : le message ne peut pas être envoyé sans.
          </p>
        )}
        {rendered.missing.length > 0 && (
          <p className="mt-2 text-xs text-state-changes">
            Informations manquantes : {rendered.missing.join(", ")}.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!complete}
            onClick={async () => {
              await navigator.clipboard.writeText(body);
              setCopied(true);
            }}
          >
            {copied ? "Copié" : "Copier le message"}
          </button>

          {/*
            WhatsApp n'ouvre qu'une conversation à la fois : avec plusieurs
            destinataires, on propose un bouton par personne plutôt qu'un lien
            unique qui en oublierait silencieusement.
          */}
          {recipients && recipients.length > 1 ? (
            recipients.map((recipient) => (
              <a
                key={recipient.name}
                className={`btn-secondary ${complete ? "" : "pointer-events-none opacity-50"}`}
                href={whatsappLink(body, recipient.phone ?? undefined)}
                target="_blank"
                rel="noreferrer noopener"
              >
                WhatsApp · {recipient.name.split(" ")[0]}
              </a>
            ))
          ) : (
            <a
              className={`btn-secondary ${complete ? "" : "pointer-events-none opacity-50"}`}
              href={whatsappLink(body, recipientPhone)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Ouvrir WhatsApp
            </a>
          )}
        </div>

        {recipients && recipients.length > 1 && (
          <p className="mt-2 text-xs text-ink-faint">
            {recipients.length} destinataires : {recipients.map((r) => r.name).join(", ")}.
            Le message est identique pour chacun.
          </p>
        )}

        <form
          action={(formData) => {
            formData.set("sheetId", sheetId);
            formData.set("templateType", templateType);
            formData.set("channel", "whatsapp");
            formData.set("body", body);
            if (recipientLabel) formData.set("recipientLabel", recipientLabel);
            run(() => markMessageSent(formData));
          }}
          className="mt-3"
        >
          <button type="submit" className="btn-primary w-full" disabled={!complete || pending}>
            Marquer comme envoyé
          </button>
        </form>
      </div>
    </section>
  );
}

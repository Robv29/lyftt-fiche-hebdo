"use client";

import { useState } from "react";
import {
  getTicketTypeDefinition,
  groupedTicketTypes,
  type TicketType,
} from "@/lib/domain/ticket-types";
import type { ReviewItem } from "@/lib/review/access";
import { ATTACHMENT_MAX_BYTES } from "@/lib/security/attachments";

/**
 * §6 — Formulaire de demande de modification.
 *
 * Les champs affichés dépendent du type choisi : c'est ce qui évite les retours
 * du type « je n'aime pas la photo » sans précision.
 */

interface Props {
  item: ReviewItem | null;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
}

export function TicketForm({ item, pending, onSubmit, onCancel }: Props) {
  /*
   * Rien de présélectionné sur une publication.
   *
   * « Modifier le texte » l'était, et 55 demandes sur 96 sont arrivées sous ce
   * type — dont une vingtaine parlaient en fait d'une image, d'une vidéo ou des
   * hashtags. Comme le routage lit la catégorie du type, aucune de celles-là
   * n'a été confiée à un graphiste ou à un monteur. Le client choisit donc,
   * explicitement.
   *
   * Sans publication ciblée, la liste ne contient qu'« Ajouter une
   * publication » : un choix forcé entre une seule option n'apprend rien à
   * personne, on garde la présélection.
   */
  const [type, setType] = useState<TicketType | "">(item ? "" : "publication_add");
  const definition = type ? getTicketTypeDefinition(type) : null;
  /** Hashtags que le client coche pour les retirer. */
  const [droppedHashtags, setDroppedHashtags] = useState<string[]>([]);

  const availableGroups = groupedTicketTypes()
    .map((group) => ({
      ...group,
      // Sans publication ciblée, seules les demandes au niveau de la fiche ont du sens.
      types: group.types.filter((t) => (item ? true : t.sheetLevel)),
    }))
    .filter((group) => group.types.length > 0);

  return (
    <form
      action={(formData) => onSubmit(formData)}
      className="reveal-panel mt-4 space-y-4 rounded-[18px] border border-[#cbdff1] bg-[#f7fafe] p-4 sm:p-5"
    >
      <input type="hidden" name="itemId" value={item?.id ?? ""} />

      <div>
        <label className="label" htmlFor={`type-${item?.id ?? "sheet"}`}>
          Que souhaitez-vous modifier ?
        </label>
        <select
          id={`type-${item?.id ?? "sheet"}`}
          name="ticketType"
          className="field"
          required
          value={type}
          onChange={(event) => {
            setType(event.target.value as TicketType | "");
            setDroppedHashtags([]);
          }}
        >
          {item && <option value="">— Que faut-il corriger ? —</option>}
          {availableGroups.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.types.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {definition?.form === "text" && item && (
        <>
          <div>
            <span className="label">Texte actuel</span>
            <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-soft">
              {item.caption || "—"}
            </p>
          </div>
          <div>
            <label className="label" htmlFor={`selection-${item.id}`}>
              Partie concernée <span className="font-normal text-ink-faint">(facultatif)</span>
            </label>
            <input
              id={`selection-${item.id}`}
              name="selection"
              className="field"
              placeholder="Copiez ici le passage à corriger"
            />
          </div>
        </>
      )}

      {/*
        Les hashtags de la publication, cochables.
        Le formulaire texte générique ne les montrait nulle part : pour en
        retirer un, le client devait recopier la liste entière à la main, ce
        qu'il faisait mal et redemandait la semaine suivante.
      */}
      {definition?.form === "hashtags" && item && (
        <>
          <div>
            <span className="label">Hashtags actuels</span>
            {item.hashtags.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-faint">
                Aucun hashtag sur cette publication.
              </p>
            ) : (
              <>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {item.hashtags.map((tag) => {
                    const dropped = droppedHashtags.includes(tag);
                    return (
                      <li key={tag}>
                        <label
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                            dropped
                              ? "border-state-changes bg-state-changes/10 text-state-changes line-through"
                              : "border-line bg-surface text-ink-soft"
                          }`}
                        >
                          <input
                            type="checkbox"
                            name="removeHashtags"
                            value={tag}
                            className="h-4 w-4"
                            checked={dropped}
                            onChange={(event) =>
                              setDroppedHashtags((current) =>
                                event.target.checked
                                  ? [...current, tag]
                                  : current.filter((value) => value !== tag),
                              )
                            }
                          />
                          {tag}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-ink-faint">
                  Cochez ceux à retirer. Les autres sont conservés.
                </p>
              </>
            )}
          </div>
          <div>
            <label className="label" htmlFor={`addHashtags-${item.id}`}>
              Hashtags à ajouter <span className="font-normal text-ink-faint">(facultatif)</span>
            </label>
            <input
              id={`addHashtags-${item.id}`}
              name="addHashtags"
              className="field"
              placeholder="#ConcertLive #Terrasse"
            />
          </div>
        </>
      )}

      {definition?.options && (
        <div>
          <label className="label" htmlFor={`option-${item?.id ?? "sheet"}`}>
            Précisez
          </label>
          <select
            id={`option-${item?.id ?? "sheet"}`}
            name="option"
            className="field"
            defaultValue={definition.options[0]?.value}
          >
            {definition.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {definition?.form === "video" && (
        <div>
          <label className="label" htmlFor={`timecode-${item?.id ?? "sheet"}`}>
            Moment concerné{" "}
            <span className="font-normal text-ink-faint">(facultatif, ex. 00:12)</span>
          </label>
          <input
            id={`timecode-${item?.id ?? "sheet"}`}
            name="timecode"
            className="field"
            placeholder="00:12"
          />
        </div>
      )}

      <div>
        <label className="label" htmlFor={`description-${item?.id ?? "sheet"}`}>
          Votre demande <span className="text-state-changes">*</span>
        </label>
        <textarea
          id={`description-${item?.id ?? "sheet"}`}
          name="description"
          rows={3}
          required
          minLength={3}
          className="field"
          placeholder={placeholderFor(type)}
        />
      </div>

      {definition?.form === "text" && (
        <div>
          <label className="label" htmlFor={`suggestion-${item?.id ?? "sheet"}`}>
            Proposition de nouveau texte{" "}
            <span className="font-normal text-ink-faint">(facultatif)</span>
          </label>
          <textarea
            id={`suggestion-${item?.id ?? "sheet"}`}
            name="suggestion"
            rows={3}
            className="field"
            defaultValue=""
          />
        </div>
      )}

      {(definition?.form === "photo" ||
        definition?.form === "video" ||
        definition?.form === "graphic") && (
        <div>
          <label className="label" htmlFor={`attachment-${item?.id ?? "sheet"}`}>
            Joindre un fichier{" "}
            <span className="font-normal text-ink-faint">
              (facultatif, {Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} Mo maximum)
            </span>
          </label>
          <input
            id={`attachment-${item?.id ?? "sheet"}`}
            name="attachment"
            type="file"
            accept="image/*,video/mp4,video/quicktime,application/pdf"
            className="field file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1 file:text-xs file:text-white"
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`name-${item?.id ?? "sheet"}`}>
            Votre nom
          </label>
          <input id={`name-${item?.id ?? "sheet"}`} name="clientName" className="field" />
        </div>
        <div>
          <label className="label" htmlFor={`email-${item?.id ?? "sheet"}`}>
            Votre e-mail{" "}
            <span className="font-normal text-ink-faint">(facultatif)</span>
          </label>
          <input
            id={`email-${item?.id ?? "sheet"}`}
            name="clientEmail"
            type="email"
            className="field"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending || !type}>
          {pending ? "Envoi…" : "Envoyer ma demande"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function placeholderFor(type: TicketType | ""): string {
  switch (type) {
    case "text_typo":
      return "Ex. « guingette » s'écrit « guinguette ».";
    case "text_information":
      return "Ex. l'adresse a changé, c'est désormais 1990 route d'Auch.";
    case "text_tone":
      return "Ex. un ton un peu plus chaleureux, moins commercial.";
    case "hashtags":
      return "Ex. ce sont les mêmes hashtags que d’habitude qu’il nous faut.";
    case "photo_replace":
      return "Ex. la photo est trop sombre, utiliser plutôt celle de la terrasse.";
    case "photo_retouch":
      return "Ex. recadrer pour que l'enseigne soit visible.";
    case "graphic_edit":
      return "Ex. le titre est trop petit, et le vert ne correspond pas à notre charte.";
    case "video_edit":
      return "Ex. couper le passage où l'on entend le micro à 00:12.";
    case "schedule_change":
      return "Ex. décaler la publication du mardi au mercredi.";
    default:
      return "Décrivez précisément ce qui doit être modifié.";
  }
}

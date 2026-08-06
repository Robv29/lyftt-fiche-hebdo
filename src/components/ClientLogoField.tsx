"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ClientLogoField({
  id,
  initialUrl = null,
  required = false,
}: {
  id: string;
  initialUrl?: string | null;
  required?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  return (
    <section className="rounded-2xl border border-[#cfe0f4] bg-[#f5f9fd] p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[96px_1fr] sm:items-center">
        <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl border border-white bg-white shadow-sm">
          {preview ? (
            // L'aperçu peut être une URL locale blob ou une URL Supabase signée.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Aperçu du logo client" className="h-full w-full object-contain p-2" />
          ) : (
            <Icon name="photo" className="h-7 w-7 text-[#6f8dad]" />
          )}
        </div>

        <div className="min-w-0">
          <label className="label" htmlFor={id}>
            Logo du client {required ? <span className="text-state-changes">*</span> : null}
          </label>
          <p className="mb-3 text-xs leading-relaxed text-ink-faint">
            Il apparaîtra sur le dossier, la fiche hebdomadaire et le lien de validation envoyé au client.
          </p>
          <input
            id={id}
            name="logo"
            type="file"
            required={required}
            accept="image/png,image/jpeg,image/webp"
            className="block w-full cursor-pointer rounded-xl border border-line bg-white text-xs text-ink-soft file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-line file:bg-[#eaf3fc] file:px-4 file:py-3 file:text-xs file:font-semibold file:text-[#0b5e9f]"
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              setError(null);
              input.setCustomValidity("");
              if (!file) {
                setFileName(null);
                setPreview(initialUrl);
                return;
              }

              let message = "";
              if (!ACCEPTED_TYPES.includes(file.type)) message = "Choisissez un logo PNG, JPEG ou WEBP.";
              else if (file.size > MAX_BYTES) message = "Le logo doit peser moins de 3 Mo.";
              if (message) {
                input.setCustomValidity(message);
                setError(message);
                setFileName(null);
                setPreview(initialUrl);
                return;
              }

              if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
              objectUrlRef.current = URL.createObjectURL(file);
              setPreview(objectUrlRef.current);
              setFileName(file.name);
            }}
          />
          <p id={`${id}-help`} className="mt-2 text-[11px] text-ink-faint">
            PNG, JPEG ou WEBP · 3 Mo maximum · fond transparent recommandé.
          </p>
          {fileName && <p className="mt-1 truncate text-[11px] font-medium text-state-approved">Prêt à enregistrer : {fileName}</p>}
          {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-state-changes">{error}</p>}
        </div>
      </div>
    </section>
  );
}

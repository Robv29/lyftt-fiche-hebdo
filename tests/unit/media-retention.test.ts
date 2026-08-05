import { describe, expect, it } from "vitest";
import {
  decideMediaRetention,
  formatBytes,
  freedBytes,
  type MediaRetentionInput,
} from "@/lib/domain/media-retention";

const now = new Date("2026-08-05T10:00:00Z");

const base: MediaRetentionInput = {
  publishedAt: null,
  isCancelled: false,
  hasOpenTicket: false,
  purgedAt: null,
  previewPurgedAt: null,
  previewRetentionDays: 30,
};

describe("conservation des médias", () => {
  it("garde le fichier tant que la publication n'a pas eu lieu", () => {
    expect(decideMediaRetention(base, now)).toEqual({
      action: "keep",
      reason: "not_published",
    });
  });

  it("garde le fichier même validé, tant qu'il n'est pas publié", () => {
    // La validation client ne suffit pas : l'équipe doit encore poster.
    expect(decideMediaRetention({ ...base }, now).action).toBe("keep");
  });

  it("purge l'original une fois la publication faite", () => {
    expect(
      decideMediaRetention(
        { ...base, publishedAt: new Date("2026-08-04T18:00:00Z") },
        now,
      ),
    ).toEqual({ action: "purge_original", reason: "published" });
  });

  it("purge aussi l'original d'une publication annulée", () => {
    expect(
      decideMediaRetention({ ...base, isCancelled: true }, now).action,
    ).toBe("purge_original");
  });

  it("conserve l'original tant qu'une correction est en cours", () => {
    expect(
      decideMediaRetention(
        {
          ...base,
          publishedAt: new Date("2026-08-04T18:00:00Z"),
          hasOpenTicket: true,
        },
        now,
      ),
    ).toEqual({ action: "keep", reason: "still_needed" });
  });

  it("garde l'aperçu pendant la durée de rétention", () => {
    expect(
      decideMediaRetention(
        { ...base, purgedAt: new Date("2026-07-20T10:00:00Z") },
        now,
      ),
    ).toEqual({ action: "keep", reason: "already_purged" });
  });

  it("purge l'aperçu une fois la rétention écoulée", () => {
    expect(
      decideMediaRetention(
        { ...base, purgedAt: new Date("2026-06-20T10:00:00Z") },
        now,
      ),
    ).toEqual({ action: "purge_preview", reason: "retention_expired" });
  });

  it("respecte une rétention personnalisée par client", () => {
    const purgedAt = new Date("2026-08-01T10:00:00Z");

    expect(
      decideMediaRetention({ ...base, purgedAt, previewRetentionDays: 3 }, now).action,
    ).toBe("purge_preview");
    expect(
      decideMediaRetention({ ...base, purgedAt, previewRetentionDays: 30 }, now).action,
    ).toBe("keep");
  });

  it("ne repurge jamais ce qui est déjà purgé", () => {
    expect(
      decideMediaRetention(
        {
          ...base,
          purgedAt: new Date("2026-06-01T10:00:00Z"),
          previewPurgedAt: new Date("2026-07-01T10:00:00Z"),
        },
        now,
      ),
    ).toEqual({ action: "keep", reason: "already_purged" });
  });
});

describe("volume libéré", () => {
  it("compte la différence entre l'original et l'aperçu conservé", () => {
    expect(
      freedBytes([
        { byteSize: 40 * 1024 ** 2, previewByteSize: 30 * 1024 },
        { byteSize: 4 * 1024 ** 2, previewByteSize: 20 * 1024 },
      ]),
    ).toBe(40 * 1024 ** 2 - 30 * 1024 + 4 * 1024 ** 2 - 20 * 1024);
  });

  it("tolère les tailles inconnues", () => {
    expect(freedBytes([{ byteSize: null, previewByteSize: null }])).toBe(0);
  });

  it("formate les volumes lisiblement", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(30 * 1024)).toBe("30 Ko");
    expect(formatBytes(40 * 1024 ** 2)).toBe("40.0 Mo");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 Go");
  });
});

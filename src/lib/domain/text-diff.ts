/**
 * §12 — Affichage comparatif des corrections de texte.
 *
 * Diff mot à mot (plus lisible qu'un diff caractère par caractère sur des
 * légendes) pour montrer ce qui est supprimé, ajouté ou conservé — plutôt que
 * deux gros champs côte à côte.
 */

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffSegment {
  op: DiffOp;
  value: string;
}

/** Découpe en conservant les espaces et sauts de ligne comme jetons. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Plus longue sous-séquence commune. Les légendes font quelques centaines de
 * mots au maximum : la table O(n·m) est largement suffisante.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const table = lcsTable(a, b);

  const segments: DiffSegment[] = [];
  const push = (op: DiffOp, value: string) => {
    const last = segments[segments.length - 1];
    if (last && last.op === op) {
      last.value += value;
    } else {
      segments.push({ op, value });
    }
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("delete", a[i]);
      i++;
    } else {
      push("insert", b[j]);
      j++;
    }
  }
  while (i < a.length) push("delete", a[i++]);
  while (j < b.length) push("insert", b[j++]);

  return segments;
}

export interface DiffSummary {
  hasChanges: boolean;
  wordsAdded: number;
  wordsRemoved: number;
}

export function summarizeDiff(segments: DiffSegment[]): DiffSummary {
  const countWords = (op: DiffOp) =>
    segments
      .filter((s) => s.op === op)
      .reduce((total, s) => total + (s.value.trim() === "" ? 0 : s.value.trim().split(/\s+/).length), 0);

  const wordsAdded = countWords("insert");
  const wordsRemoved = countWords("delete");

  return { hasChanges: wordsAdded > 0 || wordsRemoved > 0, wordsAdded, wordsRemoved };
}

/** Extrait de contexte autour d'une portion de texte sélectionnée par le client. */
export function excerptAround(
  text: string,
  selection: string,
  radius = 60,
): string | null {
  const index = text.indexOf(selection);
  if (index === -1) return null;

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + selection.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

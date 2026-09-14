import type { HealthTone } from "@/lib/domain/health-score";

/**
 * Anneau de score, partagé par Indicateurs et le tableau de bord.
 *
 * Il vivait dans la page Indicateurs. L'accueil montre désormais le même
 * score : un second anneau dessiné à côté aurait fini par arrondir, borner ou
 * colorer autrement, et les deux écrans auraient affiché deux chiffres pour
 * une seule mesure.
 *
 * `null` s'écrit « — » et non « 0 % » : une période sans donnée n'est pas une
 * agence à zéro. `tone` colore l'arc selon le niveau ; sans lui, l'anneau garde
 * le bleu d'origine. `compact` le réduit à la hauteur d'un encart.
 */
export function ScoreRing({ value, label, light = false, compact = false, tone }: {
  value: number | null;
  label: string;
  light?: boolean;
  compact?: boolean;
  tone?: HealthTone;
}) {
  const safe = Math.round(Math.min(100, Math.max(0, value || 0)));
  const fill = light ? "#fff" : tone ? "var(--kpi-accent)" : "#1b87dd";
  const track = light ? "rgba(255,255,255,.16)" : "#e8eef5";
  const classes = ["insights-ring", light ? "light" : "", compact ? "compact" : "", tone ? `insights-tone-${tone}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={classes}
      style={{ background: `conic-gradient(${fill} 0 ${safe}%,${track} ${safe}% 100%)` }}
      role="img"
      aria-label={value === null ? `${label} : non mesuré` : `${label} : ${safe} %`}
    >
      <span>
        <strong>{value === null ? "—" : `${safe}%`}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

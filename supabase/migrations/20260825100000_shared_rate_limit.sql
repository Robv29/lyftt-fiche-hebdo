-- =============================================================================
-- LYFTT — Magasin de limitation de débit partagé
--
-- Correctif de la vulnérabilité H-03 (audit du 24 août 2026).
--
-- `MemoryRateLimitStore` conserve ses compteurs dans la mémoire du processus.
-- Sur Vercel, chaque fonction serverless est une instance distincte, recyclée
-- sans préavis : les compteurs sont donc cloisonnés par instance et remis à
-- zéro à froid. La limite annoncée de 30 ouvertures de lien par minute était
-- en réalité de 30 **par instance**, ce qui rend le balayage de tokens du
-- portail client praticable.
--
-- Le compteur est déplacé en base : partagé entre instances, il survit au
-- recyclage.
-- =============================================================================

create table if not exists public.rate_limit_buckets (
  key        text        primary key,
  count      integer     not null,
  reset_at   timestamptz not null
);

comment on table public.rate_limit_buckets is
  'Compteurs de limitation de débit du portail client (§19). Écrit uniquement '
  'par la clé service-role via consume_rate_limit().';

-- Aucune policy n'est créée : RLS active sans policy interdit tout accès à
-- `anon` comme à `authenticated`. Seule la clé service-role, qui contourne la
-- RLS, peut lire et écrire ces compteurs.
alter table public.rate_limit_buckets enable row level security;

create index if not exists rate_limit_buckets_reset_at_idx
  on public.rate_limit_buckets (reset_at);

/*
 * Consommation atomique d'un jeton.
 *
 * `insert … on conflict do update` s'exécute sous un verrou de ligne : deux
 * requêtes concurrentes ne peuvent pas lire puis écrire le même compteur en
 * s'écrasant l'une l'autre — c'est précisément ce que l'implémentation mémoire
 * ne pouvait pas garantir entre instances.
 *
 * Le compteur est plafonné à `p_limit + 1` : un appel refusé ne prolonge pas
 * la punition, comme dans `MemoryRateLimitStore`. Le plafond est bien à
 * `limite + 1` et non à `limite` — sans ce cran, « pile à la limite » et
 * « au-delà » deviennent indistinguables et plus rien n'est jamais refusé.
 */
create or replace function public.consume_rate_limit(
  p_key       text,
  p_limit     integer,
  p_window_ms bigint
)
returns table (
  allowed             boolean,
  remaining           integer,
  reset_at            timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window   interval := make_interval(secs => p_window_ms / 1000.0);
  v_count    integer;
  v_reset_at timestamptz;
begin
  -- Purge opportuniste : évite une table qui ne fait que croître, sans imposer
  -- une tâche planifiée dédiée. Un appel sur deux cents en moyenne.
  if random() < 0.005 then
    delete from public.rate_limit_buckets where reset_at < now() - interval '1 hour';
  end if;

  insert into public.rate_limit_buckets as b (key, count, reset_at)
  values (p_key, 1, now() + v_window)
  on conflict (key) do update
    set count = case
                  when b.reset_at <= now()   then 1
                  when b.count > p_limit     then b.count
                  else b.count + 1
                end,
        reset_at = case
                     when b.reset_at <= now() then now() + v_window
                     else b.reset_at
                   end
  returning b.count, b.reset_at into v_count, v_reset_at;

  allowed             := v_count <= p_limit;
  remaining           := greatest(p_limit - v_count, 0);
  reset_at            := v_reset_at;
  retry_after_seconds := case
                           when v_count <= p_limit then 0
                           else greatest(ceil(extract(epoch from (v_reset_at - now())))::integer, 1)
                         end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, bigint) from public, anon, authenticated;

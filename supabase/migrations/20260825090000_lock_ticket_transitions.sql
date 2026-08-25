-- =============================================================================
-- LYFTT — Verrouillage des transitions contractuelles d'un ticket
--
-- Correctif de la vulnérabilité H-01 (audit du 24 août 2026).
--
-- La policy `client_tickets_update` s'appuie sur `can_access_ticket(id)`, en
-- `using` comme en `with check`. Or cette fonction renvoie vrai dès que
-- l'utilisateur a accès au client **ou qu'il est affecté au ticket** : aucune
-- restriction de colonne, aucune restriction de transition d'état.
--
-- Conséquence : un contributeur affecté à un ticket — un graphiste, un monteur —
-- pouvait, par appel direct à l'API REST avec son propre jeton :
--   * passer le ticket en `approved_by_client` sans validation réelle du client,
--     alors que ce statut est la trace de la validation contractuelle et qu'il
--     conditionne `recompute_sheet_status()` ;
--   * en sortir, et effacer ainsi une validation acquise ;
--   * déplacer le ticket vers un autre client via `client_id`.
--
-- Le commentaire de `20260803090200_rls.sql:168` annonçait l'intention inverse
-- (« la création et la clôture restent à l'encadrement éditorial ») : elle
-- n'était pas traduite dans la policy.
-- =============================================================================

/*
 * Même mécanique que `profiles_no_self_promotion` (migration
 * 20260824190000) : `auth.uid()` est nul lorsque la requête vient de la clé
 * service-role. Or **toutes** les écritures applicatives du statut d'un ticket
 * passent par `createSupabaseAdminClient()` — la validation client
 * (`src/app/client-review/[token]/actions.ts:150,231`) comme les transitions
 * internes (`src/lib/internal/actions.ts`). Ce trigger ne ferme donc que le
 * vecteur « appel REST direct au nom d'un utilisateur authentifié », sans
 * toucher au moindre parcours de l'application.
 */
create or replace function client_tickets_block_contractual_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;   -- service-role : encadré côté serveur par requireRole()
  end if;

  if new.client_id is distinct from old.client_id then
    raise exception
      'Le client d''un ticket ne peut pas être modifié.'
      using errcode = '42501';
  end if;

  -- Entrer dans `approved_by_client` comme en sortir engage la preuve de
  -- validation : les deux sens sont réservés au portail client.
  if new.status is distinct from old.status
     and 'approved_by_client' in (new.status::text, old.status::text) then
    raise exception
      'La validation client d''un ticket ne peut être posée ou retirée que par le client lui-même.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists client_tickets_no_contractual_forgery on public.client_tickets;

create trigger client_tickets_no_contractual_forgery
  before update on public.client_tickets
  for each row
  execute function client_tickets_block_contractual_changes();

-- Rôle « commercial » : consultation seule des clients et de la carte.
--
-- Isolé dans sa propre migration parce qu'une valeur ajoutée à une énumération
-- ne peut pas être utilisée dans la transaction qui l'ajoute. Les politiques
-- qui s'y réfèrent arrivent donc dans la migration suivante.

alter type app_role add value if not exists 'commercial';

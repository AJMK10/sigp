-- Journal d'audit en ajout seul : aucune modification ni suppression, même par un administrateur de la base applicative.
CREATE OR REPLACE FUNCTION audit_log_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est en ajout seul (opération % refusée)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_readonly();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_readonly();
--> statement-breakpoint
-- Biens sortis : jamais supprimés physiquement (le code n'est jamais réattribué).
CREATE OR REPLACE FUNCTION assets_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'un bien ne se supprime pas : il sort du patrimoine par une pièce de sortie';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER assets_no_delete BEFORE DELETE ON assets FOR EACH ROW EXECUTE FUNCTION assets_no_delete();

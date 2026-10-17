-- Review records are an audit trail: decisions, confirmations, notes and
-- contestant responses are append-only.
CREATE OR REPLACE FUNCTION review_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_decision_append_only BEFORE UPDATE OR DELETE ON review_decision FOR EACH ROW EXECUTE FUNCTION review_append_only();
--> statement-breakpoint
CREATE TRIGGER decision_confirmation_append_only BEFORE UPDATE OR DELETE ON decision_confirmation FOR EACH ROW EXECUTE FUNCTION review_append_only();
--> statement-breakpoint
CREATE TRIGGER review_note_append_only BEFORE UPDATE OR DELETE ON review_note FOR EACH ROW EXECUTE FUNCTION review_append_only();
--> statement-breakpoint
CREATE TRIGGER contestant_response_append_only BEFORE UPDATE OR DELETE ON contestant_response FOR EACH ROW EXECUTE FUNCTION review_append_only();
--> statement-breakpoint
-- Two-person rule, enforced by the database as well as the service: only a
-- confirmed_violation decision can be confirmed, and never by its own author.
CREATE OR REPLACE FUNCTION decision_confirmation_guard() RETURNS trigger AS $$
DECLARE
  d record;
BEGIN
  SELECT reviewer_id, outcome INTO d FROM review_decision WHERE id = NEW.decision_id;
  IF d.outcome <> 'confirmed_violation' THEN
    RAISE EXCEPTION 'only confirmed_violation decisions require confirmation';
  END IF;
  IF d.reviewer_id = NEW.admin_id THEN
    RAISE EXCEPTION 'a decision cannot be confirmed by its own author';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER decision_confirmation_two_person BEFORE INSERT ON decision_confirmation FOR EACH ROW EXECUTE FUNCTION decision_confirmation_guard();

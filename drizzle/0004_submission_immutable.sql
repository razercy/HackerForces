-- Submitted programs are evidence (for verdicts and for integrity review), so
-- the submitted columns can never change after insert, and rows can never be
-- deleted by the application. Only judging-result columns may be updated.
CREATE OR REPLACE FUNCTION submission_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'submissions are immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.contest_id IS DISTINCT FROM OLD.contest_id
     OR NEW.problem_id IS DISTINCT FROM OLD.problem_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.language IS DISTINCT FROM OLD.language
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'submissions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER submission_immutable
  BEFORE UPDATE OR DELETE ON submission
  FOR EACH ROW EXECUTE FUNCTION submission_guard();

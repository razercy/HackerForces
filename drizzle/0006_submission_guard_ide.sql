-- The editor-session link is part of the submitted record, so it is immutable too.
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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.ide_session_id IS DISTINCT FROM OLD.ide_session_id
     OR NEW.ide_seq IS DISTINCT FROM OLD.ide_seq THEN
    RAISE EXCEPTION 'submissions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Acknowledgements are evidence of informed consent: never rewritten.
CREATE OR REPLACE FUNCTION telemetry_ack_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'telemetry acknowledgements are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER telemetry_ack_append_only
  BEFORE UPDATE ON telemetry_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION telemetry_ack_guard();

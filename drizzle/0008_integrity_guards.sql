-- Integrity records are evidence: versions, features and assessments are
-- append-only. (Row deletion is still possible through ON DELETE CASCADE when
-- a parent is removed, so only UPDATE is blocked here.)
CREATE OR REPLACE FUNCTION integrity_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER user_template_version_append_only BEFORE UPDATE ON user_template_version
  FOR EACH ROW EXECUTE FUNCTION integrity_append_only();
--> statement-breakpoint
CREATE TRIGGER feature_vector_append_only BEFORE UPDATE ON feature_vector
  FOR EACH ROW EXECUTE FUNCTION integrity_append_only();
--> statement-breakpoint
CREATE TRIGGER anomaly_assessment_append_only BEFORE UPDATE ON anomaly_assessment
  FOR EACH ROW EXECUTE FUNCTION integrity_append_only();
--> statement-breakpoint
-- Templates and snippets may only be archived/retired, once; nothing else changes,
-- so "which templates were in effect at time T" stays answerable.
CREATE OR REPLACE FUNCTION archive_once_guard() RETURNS trigger AS $$
DECLARE
  col text := TG_ARGV[0];
  old_val timestamptz;
  new_val timestamptz;
BEGIN
  EXECUTE format('SELECT ($1).%I, ($2).%I', col, col) INTO old_val, new_val USING OLD, NEW;
  IF old_val IS NOT NULL OR new_val IS NULL
     OR (to_jsonb(NEW) - col) IS DISTINCT FROM (to_jsonb(OLD) - col) THEN
    RAISE EXCEPTION '% rows can only be archived once', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER user_template_archive_once BEFORE UPDATE ON user_template
  FOR EACH ROW EXECUTE FUNCTION archive_once_guard('archived_at');
--> statement-breakpoint
CREATE TRIGGER approved_snippet_retire_once BEFORE UPDATE ON approved_snippet
  FOR EACH ROW EXECUTE FUNCTION archive_once_guard('retired_at');

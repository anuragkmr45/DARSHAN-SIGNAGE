CREATE SCHEMA darshan_d3_control AUTHORIZATION darshan;
REVOKE ALL ON SCHEMA darshan_d3_control FROM PUBLIC;
CREATE TABLE darshan_d3_control.operation_backup_bindings (
 operation_id uuid CONSTRAINT operation_backup_bindings_pkey PRIMARY KEY,
 site_id text NOT NULL,
 repository_id uuid NOT NULL,
 backup_run_id uuid NOT NULL CONSTRAINT operation_backup_bindings_run_key UNIQUE,
 binding jsonb NOT NULL,
 binding_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT operation_backup_bindings_object CHECK (jsonb_typeof(binding) = 'object'),
 CONSTRAINT operation_backup_bindings_digest CHECK (binding_sha256 ~ '^[a-f0-9]{64}$'),
 CONSTRAINT operation_backup_bindings_bound CHECK (octet_length(binding::text) <= 16384)
);
REVOKE ALL ON darshan_d3_control.operation_backup_bindings FROM PUBLIC;
CREATE FUNCTION darshan_d3_control.reject_binding_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $d3$BEGIN RAISE EXCEPTION 'D3 operation backup bindings are immutable' USING ERRCODE='55000'; RETURN NULL; END;$d3$;
REVOKE ALL ON FUNCTION darshan_d3_control.reject_binding_mutation() FROM PUBLIC;
CREATE TRIGGER operation_binding_rows BEFORE UPDATE OR DELETE ON darshan_d3_control.operation_backup_bindings FOR EACH ROW EXECUTE FUNCTION darshan_d3_control.reject_binding_mutation();
CREATE TRIGGER operation_binding_truncate BEFORE TRUNCATE ON darshan_d3_control.operation_backup_bindings FOR EACH STATEMENT EXECUTE FUNCTION darshan_d3_control.reject_binding_mutation();

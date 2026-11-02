CREATE TABLE IF NOT EXISTS user_additional_departments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_additional_departments_user_id_idx
  ON user_additional_departments (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_additional_departments_department_id_idx
  ON user_additional_departments (department_id);

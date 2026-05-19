-- =========================================
-- MODULO TURNI SETTIMANALI PV
-- =========================================
-- Note architetturale:
-- Il progetto attuale usa autenticazione custom via cookie e API Next server-side.
-- Le API continuano a validare ruolo/PV lato server e interrogano Supabase con service role.
-- Le policy RLS sotto sono predisposte per un eventuale futuro ponte Supabase Auth/JWT
-- con claim app_role/role e pv_id; senza quei claim, anon/authenticated restano chiusi.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================
-- Helper updated_at
-- =========================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================
-- Helper RLS per eventuale JWT applicativo futuro
-- =========================================

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role', ''));
$$;

CREATE OR REPLACE FUNCTION public.current_app_pv_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v text;
BEGIN
  v := nullif(auth.jwt() ->> 'pv_id', '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() IN ('admin', 'amministrativo', 'utente_amministrativo', 'superadmin');
$$;

CREATE OR REPLACE FUNCTION public.is_app_pv(target_pv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() = 'punto_vendita'
     AND public.current_app_pv_id() IS NOT NULL
     AND public.current_app_pv_id() = target_pv_id;
$$;

-- =========================================
-- Dipendenti PV
-- =========================================

CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_id uuid NOT NULL REFERENCES public.pvs(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employees_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT employees_name_length CHECK (length(trim(name)) <= 120),
  CONSTRAINT employees_id_pv_unique UNIQUE (id, pv_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_pv_active_name
ON public.employees (pv_id, active, name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_employees_pv_active_name
ON public.employees (pv_id, lower(trim(name)))
WHERE active = true;

DROP TRIGGER IF EXISTS trg_employees_set_updated_at ON public.employees;
CREATE TRIGGER trg_employees_set_updated_at
BEFORE UPDATE ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Turni settimanali
-- =========================================

CREATE TABLE IF NOT EXISTS public.work_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_id uuid NOT NULL REFERENCES public.pvs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  shift_date date NOT NULL,
  start_time time NULL,
  end_time time NULL,
  status text NOT NULL,
  note text NULL,
  created_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT work_shifts_employee_pv_fk
    FOREIGN KEY (employee_id, pv_id)
    REFERENCES public.employees(id, pv_id)
    ON DELETE CASCADE,

  CONSTRAINT work_shifts_status_check
    CHECK (status IN ('work', 'rest', 'change')),

  CONSTRAINT work_shifts_time_rules_check CHECK (
    (
      status = 'rest'
      AND start_time IS NULL
      AND end_time IS NULL
    )
    OR
    (
      status IN ('work', 'change')
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
    )
  ),

  CONSTRAINT work_shifts_note_length CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT work_shifts_one_per_employee_day UNIQUE (pv_id, employee_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_work_shifts_pv_date
ON public.work_shifts (pv_id, shift_date);

CREATE INDEX IF NOT EXISTS idx_work_shifts_employee_date
ON public.work_shifts (employee_id, shift_date);

CREATE INDEX IF NOT EXISTS idx_work_shifts_status
ON public.work_shifts (status);

DROP TRIGGER IF EXISTS trg_work_shifts_set_updated_at ON public.work_shifts;
CREATE TRIGGER trg_work_shifts_set_updated_at
BEFORE UPDATE ON public.work_shifts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- RLS
-- =========================================

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employees_select_admin_or_own_pv ON public.employees;
CREATE POLICY employees_select_admin_or_own_pv
ON public.employees
FOR SELECT
TO authenticated
USING (
  public.is_app_admin()
  OR public.is_app_pv(pv_id)
);

DROP POLICY IF EXISTS employees_insert_admin_or_own_pv ON public.employees;
CREATE POLICY employees_insert_admin_or_own_pv
ON public.employees
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_app_admin()
  OR public.is_app_pv(pv_id)
);

DROP POLICY IF EXISTS employees_update_admin_or_own_pv ON public.employees;
CREATE POLICY employees_update_admin_or_own_pv
ON public.employees
FOR UPDATE
TO authenticated
USING (
  public.is_app_admin()
  OR public.is_app_pv(pv_id)
)
WITH CHECK (
  public.is_app_admin()
  OR public.is_app_pv(pv_id)
);

DROP POLICY IF EXISTS work_shifts_select_admin_or_own_pv ON public.work_shifts;
CREATE POLICY work_shifts_select_admin_or_own_pv
ON public.work_shifts
FOR SELECT
TO authenticated
USING (
  public.is_app_admin()
  OR public.is_app_pv(pv_id)
);

DROP POLICY IF EXISTS work_shifts_insert_own_pv ON public.work_shifts;
CREATE POLICY work_shifts_insert_own_pv
ON public.work_shifts
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_app_pv(pv_id)
);

DROP POLICY IF EXISTS work_shifts_update_own_pv ON public.work_shifts;
CREATE POLICY work_shifts_update_own_pv
ON public.work_shifts
FOR UPDATE
TO authenticated
USING (
  public.is_app_pv(pv_id)
)
WITH CHECK (
  public.is_app_pv(pv_id)
);

-- Nessuna policy DELETE: la prima versione non elimina turni dal client.
-- Eventuale rollback manuale:
-- DROP TABLE IF EXISTS public.work_shifts;
-- DROP TABLE IF EXISTS public.employees;
-- DROP FUNCTION IF EXISTS public.is_app_pv(uuid);
-- DROP FUNCTION IF EXISTS public.is_app_admin();
-- DROP FUNCTION IF EXISTS public.current_app_pv_id();
-- DROP FUNCTION IF EXISTS public.current_app_role();

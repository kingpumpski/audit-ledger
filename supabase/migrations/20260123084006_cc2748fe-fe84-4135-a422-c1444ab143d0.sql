-- Fix security issues

-- 1. Enable RLS on permissions and role_permissions tables
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- 2. Create RLS policies for permissions table
CREATE POLICY "Authenticated users can view permissions"
ON public.permissions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage permissions"
ON public.permissions
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- 3. Create RLS policies for role_permissions table  
CREATE POLICY "Authenticated users can view role permissions"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage role permissions"
ON public.role_permissions
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- 4. Replace the SECURITY DEFINER view with a regular view + RLS
DROP VIEW IF EXISTS public.users_with_roles;

-- Create a function instead that respects RLS
CREATE OR REPLACE FUNCTION public.get_users_with_roles()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  phone text,
  avatar_url text,
  job_title text,
  department text,
  is_active boolean,
  created_at timestamptz,
  roles app_role[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.avatar_url,
    p.job_title,
    p.department,
    p.is_active,
    p.created_at,
    COALESCE(
      (SELECT array_agg(ur.role ORDER BY ur.granted_at) 
       FROM public.user_roles ur 
       WHERE ur.user_id = p.id),
      ARRAY[]::app_role[]
    ) as roles
  FROM public.profiles p
$$;

-- 5. Add admin policy to view all profiles for role management
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- 6. Add admin policy to manage user_roles more completely
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin') OR user_id = auth.uid());

-- 7. Allow first user to claim admin without existing role
CREATE POLICY "First user can claim admin"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (NOT EXISTS (SELECT 1 FROM public.user_roles));
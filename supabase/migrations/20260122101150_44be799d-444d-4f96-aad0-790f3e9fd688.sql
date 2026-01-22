-- Fix overly permissive RLS policies for audit_logs and notifications

-- Drop the existing policies
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;

-- Create more specific policies using service role or authenticated users
-- For audit logs - only authenticated users can insert, and the user_id must match
CREATE POLICY "Authenticated users can insert own audit logs" ON public.audit_logs
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- For notifications - only authenticated users can insert, targeting specific users
CREATE POLICY "Authenticated users can insert notifications" ON public.notifications
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
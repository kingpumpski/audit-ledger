-- Ensure every newly created business is ready for location-aware inventory.
-- The original store-location rollout backfilled existing businesses only; new
-- businesses created afterward otherwise had no active default location.
BEGIN;

CREATE OR REPLACE FUNCTION app_private.provision_default_store_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $provision_default_store_location$
BEGIN
  INSERT INTO public.store_locations (
    business_id, code, name, location_type, timezone,
    is_default, is_active, created_by
  )
  VALUES (
    NEW.id,
    'MAIN',
    COALESCE(NULLIF(pg_catalog.btrim(NEW.name), ''), 'Main Store'),
    'store',
    COALESCE(NULLIF(pg_catalog.btrim(NEW.timezone), ''), 'Africa/Accra'),
    true,
    true,
    NEW.created_by
  )
  ON CONFLICT (business_id, code) DO NOTHING;

  RETURN NEW;
END;
$provision_default_store_location$;

REVOKE ALL ON FUNCTION app_private.provision_default_store_location()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER businesses_provision_default_store_location
  AFTER INSERT ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION app_private.provision_default_store_location();

COMMIT;

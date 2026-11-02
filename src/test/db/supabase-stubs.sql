-- Minimal stand-ins for the Supabase platform objects our migrations reference, so the real
-- migration files can run against a disposable PostgreSQL (PGlite) in tests. Not used in production.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

-- Supabase grants table privileges broadly by default and relies on RLS. Mirror that worst case so
-- tests prove that row-level security, not missing grants, is what blocks cross-user access.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
-- Same contract as Supabase: the user id comes from the request's JWT `sub` claim.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, public boolean NOT NULL DEFAULT false);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
-- Supabase semantics: folder segments of an object path, without the file name.
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
-- The bucket is created by Lovable Cloud outside the migrations.
INSERT INTO storage.buckets (id) VALUES ('proof-photos');

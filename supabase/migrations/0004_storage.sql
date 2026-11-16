-- 0004_storage.sql
-- Storage bucket 'media' and access policies

INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false)
ON CONFLICT (id) DO NOTHING;

-- Insert allowed for authenticated only when the first path folder = auth.uid()::text
CREATE POLICY "media_insert_owner_only" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Select allowed for any authenticated
CREATE POLICY "media_select_authenticated" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'media'
);

-- seed.sql
-- Demo data for Ega Osas Transport and Logistics (All demo names prefixed with DEMO)

-- Locations
INSERT INTO locations (id, name, state, lat, lng, geofence_radius_m, is_active)
VALUES
  ('11111111-1111-4111-a111-111111111111', 'DEMO Lagos Branch', 'Lagos', 6.5244, 3.3792, 500, true),
  ('22222222-2222-4222-a222-222222222222', 'DEMO Akure Branch', 'Ondo', 7.2571, 5.2058, 500, true),
  ('33333333-3333-4333-a333-333333333333', 'DEMO Asaba Branch', 'Delta', 6.1984, 6.7329, 500, true),
  ('44444444-4444-4444-a444-444444444444', 'DEMO Benin Branch', 'Edo', 6.3350, 5.6037, 500, true)
ON CONFLICT (name, state) DO NOTHING;

-- Vehicles
INSERT INTO vehicles (id, plate, model, is_active)
VALUES
  ('55555555-5555-4555-a555-555555555555', 'DEMO-LAG-101XA', 'Toyota HiAce Bus', true),
  ('66666666-6666-4666-a666-666666666666', 'DEMO-AKR-202XB', 'Mercedes Sprinter Bus', true)
ON CONFLICT (plate) DO NOTHING;

-- Settings
INSERT INTO settings (key, value)
VALUES
  ('company_info', '{"name": "Ega Osas Transport and Logistics", "prefix": "EO", "contact": "+2348000000000"}'::jsonb),
  ('app_config', '{"version": "1.0.0", "offline_first": true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Seed MyGate connection + test lock device for TDS Koramangala A (property 60765)
-- Live credentials confirmed via API testing on 2026-04-25.
-- mygate_property_id stored as "partnerId:mygatePropertyId" (colon-separated).

INSERT INTO mygate_connection (id, property_id, mygate_property_id, api_key, admin_phone, api_endpoint, is_active, created_at, updated_at)
VALUES (
  'mgconn-tds-ka-001',
  '60765',
  '69bcdc9f5c1076018cdced61:69c4ec5f5d8e633ad3a2d761',
  '592I7UbZK52ZDoc8',
  '9611907799',
  'https://knoxapi.mygate.com/partner-access',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- room_number must match the RoomName value that eZee returns on check-in
INSERT INTO mygate_devices (id, property_id, mygate_room_id, room_number, lock_serial, lock_type, is_active, created_at)
VALUES (
  'mgdev-tds-ka-101',
  '60765',
  '69c4ec6e5d8e633ad3a2d762',
  '101',
  'SN1141001310926',
  'MYGATE',
  true,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

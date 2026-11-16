# Decisions Log

| Area | What was unspecified | What was chosen |
|------|----------------------|-----------------|
| Config | Waybill prefix | WAYBILL_PREFIX = "EO" in /src/lib/config.ts and Supabase SQL |
| Auth | Phone sign-in without SMS gateway | Used synthetic email `${digits}@internal.egaosas.com` with PIN password for Supabase GoTrue authentication |
| RPC | reserve_waybills return format | Returned `jsonb` object with keys `from_no` and `to_no` for direct JSON parsing in client |
| Copy | Additional UI strings not verbatim in prompt | Defined short plain English strings in `/src/lib/copy.ts` |
| Local DB | SQLite database name | Used `ega_osas.db` for the local offline SQLite database |

# Transit

Transit is an offline-first Expo and React Native app for managing branch-to-branch shipments and transport trips. Managers register shipments, prepare trips, and monitor delivery operations. Drivers scan packages onto their assigned trip, record trip progress, and complete handovers. Supabase provides authentication, shared operational data, command processing, and media storage; SQLite keeps app data and pending work available on the device.

## Contents

- [Features](#features)
- [Technology](#technology)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Supabase setup](#supabase-setup)
- [Run the app](#run-the-app)
- [Roles and workflows](#roles-and-workflows)
- [Offline behavior and sync](#offline-behavior-and-sync)
- [Repository map](#repository-map)
- [Validation](#validation)
- [Configuration notes](#configuration-notes)
- [Troubleshooting](#troubleshooting)

## Features

- Phone-number and PIN authentication with manager and driver profiles.
- Shipment registration with sender and receiver details, route, package descriptions, photos, and printable/shareable labels.
- Trip planning with a driver, vehicle, origin, and destination.
- QR/barcode scanning to load packages and receive packages at a branch.
- Driver trip status, route map, elapsed time, and location tracking.
- Delivery collection recording with pickup-code or logged-call verification, collector details, an optional ID check, photo evidence, and signature capture.
- Local SQLite storage, a durable command outbox, retry/backoff, and queued media uploads for intermittent connectivity.
- Supabase row-level security, command RPCs, Realtime-assisted refresh, and private media storage.

## Technology

- Expo SDK 58, React Native 0.88, TypeScript, and Expo Router.
- Supabase Auth, Postgres, Realtime, Storage, and SQL migrations.
- Expo SQLite for the on-device database; Zustand for authentication and sync state.
- React Native Paper for shared interface components.
- Bun is the repository's package manager (`bun.lock` is committed).

## Requirements

- Node.js compatible with the project's Expo SDK, plus [Bun](https://bun.sh/).
- The [Supabase CLI](https://supabase.com/docs/guides/cli) for a local backend, or credentials for a configured Supabase project.
- For device testing, an iOS or Android device/emulator. Camera and location workflows need the corresponding device permissions.

## Quick start

1. Install JavaScript dependencies:

   ```sh
   bun install
   ```

2. Start or connect to a Supabase project by following [Supabase setup](#supabase-setup).

3. Create a root `.env` file containing the public client configuration:

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

   For a hosted project, use its project URL and publishable/anon key instead. These values are included in the client app; **never put a service-role key or other secret in an `EXPO_PUBLIC_` variable**. The root `.env` is ignored by Git.

4. Start Expo:

   ```sh
   bun run start
   ```

   Use the Expo terminal menu to open a simulator or connect a device. You can also run `bun run android`, `bun run ios`, or `bun run web`.

## Supabase setup

### Local development

Start the local Supabase services from the repository root:

```sh
supabase start
```

Apply the migrations and seed data:

```sh
supabase db reset
```

This creates the schema, row-level security policies, command functions, and private `media` bucket, then seeds demo branch locations, vehicles, and settings. The seed does not create user accounts. `supabase start` prints the local API URL and anon key; copy those into `.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

The app's current phone/PIN registration flow expects Supabase Auth to return a session immediately. Configure the local or hosted Auth project so the flow does not wait for an email or SMS confirmation that the user cannot complete in-app. A profile row is also required for role-aware screens and access policies.

To stop local Supabase services:

```sh
supabase stop
```

### Hosted project

Create a Supabase project, link the repository, and apply the checked-in migrations:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Set `.env` to that project's API URL and public anon/publishable key. Configure Auth for the app's phone/PIN flow, and ensure the migrations and seed data have been applied. Do not use a service-role key in the mobile app; reserve it for trusted administrative tooling.

### Demo accounts

The seed file creates demo locations and vehicles only. Create an account through the app's sign-up screen and choose the intended role. Signup accepts an optional location ID; managers should use the ID of their branch when branch-scoped operations are needed. Drivers need a manager-created trip assignment before the driver workflow has an active trip.

## Run the app

```sh
bun run start      # Expo development server
bun run android    # Open Android
bun run ios        # Open iOS
bun run web        # Open web
```

The app uses Expo Router file-based routing. Protected routes redirect to login when there is no authenticated user. After login, the first tab changes based on the profile role: managers see the operations overview and drivers see their trip.

## Roles and workflows

### Manager

- **Overview:** today's shipment/package counts, in-transit and delivered counts, current issues, trips on the road, and items ready for collection.
- **Shipments:** create a shipment with one or more packages, review shipment status/details, and generate labels.
- **Trips:** create and manage trips by assigning an active driver and vehicle to an origin/destination route.
- **Scan:** receive an arriving package at the branch and record its condition/evidence.

### Driver

- **My trip:** view the assigned trip, route, and loading progress; start a trip after loading has begun; record arrival.
- **Scan:** scan package labels onto the active loading trip. The server validates that the package route and trip match.
- **Collection:** verify pickup with a code or a previously logged successful call, capture collection details, photo, and signature, then record handover.

Both roles have a profile screen for account details and sign-out. The app's database policies enforce access to manager and driver data; UI visibility is not the security boundary.

## Offline behavior and sync

The local database is opened and initialized on demand (`ega_osas5.db`). User actions that change operational state are represented as commands in a local outbox. The sync service uploads pending media, submits commands in batches to the `apply_commands` RPC, pulls changed records, and retries transient failures with backoff. Network changes, app state, and Supabase Realtime events help trigger sync; a fallback interval also runs while sync listeners are active. Location pings are buffered locally and uploaded separately.

Offline availability is not unlimited: authentication requires a network connection, and data that has never been pulled to the device is unavailable offline. A queued action may be rejected by the server when it syncs if its role, trip, package state, or route is no longer valid. Check the in-app sync indicator and resolve rejected operations before assuming the server accepted them.

## Repository map

```text
src/
  app/                 Expo Router screens and route layouts
  data/                SQLite schema/access, outbox, media, location, sync
  features/             Auth, shipments, trips, scanning, and collection UI
  lib/                  Supabase client, validation, formatting, app constants
  store/                Zustand auth and sync state
  ui/                   Shared React Native components
  theme.ts, tokens.ts   Theme and design tokens
supabase/
  migrations/           Database schema, RLS, commands, and storage policies
  tests/                SQL scenario test
  seed.sql              Demo branch, vehicle, and settings data
scripts/
  create-user.ts        Administrative account/profile helper
```

Route files in `src/app` are intentionally thin; most screen behavior lives in `src/features`. `DECISIONS.md` records selected project conventions such as the `EO` waybill prefix and database naming.

## Validation

Run the configured lint command and the TypeScript compiler before submitting changes:

```sh
bun run lint
bunx tsc --noEmit
```

The package currently has no JavaScript unit-test script. The SQL scenario in `supabase/tests/scenario.sql` exercises a full shipment-to-trip flow and rejection cases against a migrated Supabase database.

## Configuration notes

- App client configuration is read from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `src/lib/supabase.ts`.
- `EXPO_PUBLIC_` values are bundled into the application and are public by design. Never place service credentials, passwords, or signing secrets there.
- Local database name, sync batch sizes, retry delays, waybill prefix, and location task name are in `src/lib/config.ts`.
- Database migrations are ordered SQL files in `supabase/migrations`; update the schema and the corresponding local SQLite schema/command handling when changing synchronized data.
- The private Supabase Storage bucket is named `media`; uploaded object paths are scoped to the authenticated user's ID.
- User roles are `manager` and `driver`. Branch assignment is stored as `profiles.location_id`.

## Troubleshooting

- **Missing Supabase environment variables:** confirm `.env` is at the repository root, uses the exact `EXPO_PUBLIC_` names, and restart Expo after changing it.
- **Signup succeeds but the app cannot enter the workflow:** check that Auth returns a session immediately and that the user's `profiles` row was created successfully.
- **Empty manager overview or no driver trip:** reset/apply the local database migrations and seed, sign in with the intended profile, and create the needed shipment or driver trip assignment.
- **Camera or location does not work:** grant the permission in the device settings and test on a physical device or a configured emulator. Location tracking can be limited by simulator behavior and OS background-permission settings.
- **Pending changes do not appear on another device:** confirm network access, inspect the sync indicator, and review the development console for `[Sync]` errors or server-side command rejection reasons.

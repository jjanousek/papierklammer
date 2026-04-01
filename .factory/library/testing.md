## Test data cleanup ordering: `control_plane_events`

- The `control_plane_events.companyId` foreign key references `companies.id`.
- In embedded-Postgres server tests that perform manual cleanup, delete from `control_plane_events` before deleting from `companies`.
- Practical pattern in `afterEach` blocks:
  1. `delete(controlPlaneEvents)`
  2. delete remaining child tables
  3. `delete(companies)`

Without this ordering, cleanup can fail on FK constraints when tests remove companies directly.

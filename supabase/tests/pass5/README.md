# Pass 5 security-fix verification

Reproducible checks for the Pass 5 findings in
[`docs/security-test-plan.md`](../../../docs/security-test-plan.md). Both scripts run entirely
inside a transaction that is rolled back, so they leave no rows behind and are safe to re-run.

**Local instance only.** They create fixture users in `auth.users`; never point them at the
linked production project.

```sh
supabase db reset          # applies all migrations from scratch
docker exec -i supabase_db_<project-ref> psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < supabase/tests/pass5/verify.sql
docker exec -i supabase_db_<project-ref> psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < supabase/tests/pass5/regress-teardown.sql
```

Each script prints `PASS …` notices and exits 0; any failure raises and exits 3.

## `verify.sql` — the fixes do what they claim

- **P5-1** `log_auth_event` is executable by `service_role` only — not `anon`, not
  `authenticated`.
- **P5-2** all 13 `_module_check` triggers exist; `module_enabled()` is true on trial, false on a
  paid plan with the flag absent, true once set; a direct `INSERT` into `matters` is refused with
  `42501` and succeeds after enabling the module; a missing licence row fails **open**.
- **P5-7** a pending invite still returns its details; a spent one returns `valid=false` with
  every other column `NULL`.
- **P5-10** no chamber-wide `SELECT` policy remains on `ai_conversations`/`ai_messages`/
  `ai_drafts`, while `ai_documents` deliberately keeps one.

## `regress-teardown.sql` — the fixes break nothing

The module trigger is `BEFORE INSERT` only, specifically to stay clear of two teardown paths this
repo has already been bitten by (see `20260825130000` and `20260821120000`). This proves the
claim rather than asserting it, for a chamber that has dropped every module:

- **R1** deleting a matter still works, exercising `ON DELETE SET NULL` onto `hearings`,
  `invoices` and `time_entries` — tables whose modules are not purchased.
- **R2/R3** `delete_my_account()` still completes and leaves zero rows, exercising the cascade
  through all 13 gated tables _after_ `licenses` has already been deleted.

## Why these exist

Two real bugs in the Pass 5 fixes were caught here that reading the SQL did not surface:

1. `service_role` was never on `log_auth_event`'s ACL (the original grant named only
   `authenticated, anon`), so revoking without adding an explicit `GRANT` would have broken auth
   logging entirely.
2. `module_enabled()` returned `NULL` for a paid plan with the flag absent — `false OR NULL` is
   `NULL`, which the outer `COALESCE(..., true)` then turned into `true`, making the gate a no-op
   for every paid plan.

Both are the exact cases these scripts now assert.

-- Praxis managed-state schema (PRAXIS_STATE_BACKEND=postgres).
--
-- One compacted JSONB document per wallet (owner address). Money values are
-- stored as tagged-bigint strings inside the JSONB document, never as floats.
-- The application also creates this table lazily and idempotently on first use,
-- so running this file is optional; it exists for managed migration tooling and
-- to document the schema.

CREATE TABLE IF NOT EXISTS praxis_provider_state (
  owner_key  text PRIMARY KEY,
  version    integer NOT NULL,
  state      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

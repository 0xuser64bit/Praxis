-- Praxis managed-state schema (PRAXIS_STATE_BACKEND=postgres).
--
-- One compacted JSONB document per wallet (owner address). Money values are
-- stored as tagged-bigint strings inside the JSONB document, never as floats.
-- The application also creates this table lazily and idempotently on first use,
-- so running this file is optional; it exists for managed migration tooling and
-- to document the schema.
--
-- `rev` is the optimistic-concurrency token. Every write is a compare-and-swap
-- against the revision the writer read, so two instances serving the same
-- wallet cannot silently overwrite each other — and a proposal can be claimed
-- before it is executed on-chain, which is what makes signing exactly-once.

CREATE TABLE IF NOT EXISTS praxis_provider_state (
  owner_key  text PRIMARY KEY,
  version    integer NOT NULL,
  state      jsonb NOT NULL,
  rev        bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Additive for databases created before optimistic concurrency landed.
ALTER TABLE praxis_provider_state
  ADD COLUMN IF NOT EXISTS rev bigint NOT NULL DEFAULT 0;

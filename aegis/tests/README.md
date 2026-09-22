# Aegis tests

The enforcement gate is implemented as Rust LiteSVM integration tests at
`aegis/programs/aegis/tests/enforcement.rs` so Cargo can discover them for the
`aegis` program crate. It covers T1–T9: cap boundaries, day rollover, signer
checks, revoke, allow-list behavior, admin invariants, SPL, Token-2022, and
vault invariants.

Run from the repo root:

```sh
bun run aegis:test
```

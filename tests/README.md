# Aegis tests

The M1 enforcement gate is implemented as Rust LiteSVM integration tests at
`programs/aegis/tests/enforcement.rs` so Cargo can discover them for the
`aegis` program crate.

Run from the repo root:

```sh
NO_DNA=1 anchor build
NO_DNA=1 cargo test --test enforcement -- --nocapture
```

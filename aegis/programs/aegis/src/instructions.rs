// Glob re-exports bring each instruction's `#[derive(Accounts)]` context struct
// AND the client/CPI account modules that `#[program]` generates against. The
// only collision is each module's `handler` fn (always reached via its module
// path in lib.rs, never the bare name), so we silence that one lint.
#![allow(ambiguous_glob_reexports)]

pub mod agent_transfer;
pub mod agent_transfer_spl;
pub mod configure_token;
pub mod fund_vault;
pub mod initialize_policy;
pub mod revoke_agent;
pub mod rotate_agent;
pub mod update_policy;
pub mod withdraw_vault;

pub use agent_transfer::*;
pub use agent_transfer_spl::*;
pub use configure_token::*;
pub use fund_vault::*;
pub use initialize_policy::*;
pub use revoke_agent::*;
pub use rotate_agent::*;
pub use update_policy::*;
pub use withdraw_vault::*;

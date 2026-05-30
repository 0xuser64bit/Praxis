//! Aegis enforcement gate — the five §5 test scenarios plus admin invariants.
//!
//! These are simultaneously the correctness gate and the demo. We use LiteSVM
//! (in-process SVM) so we can WARP THE CLOCK deterministically — a plain
//! validator cannot test day-rollover/expiry without real sleeps.
//!
//! Run with output:  cargo test --test enforcement -- --nocapture
//!
//! All cases run inside one `#[test]` so we can print a single pass/fail table
//! and report the exact assertion (the on-chain Custom error code) that fired.

use {
    aegis::{error::AegisError, state::PolicyAccount},
    anchor_lang::prelude::Pubkey,
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    litesvm::{types::TransactionResult, LiteSVM},
    solana_account::Account as SolanaAccount,
    solana_clock::Clock,
    solana_instruction::error::InstructionError,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
};

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
fn sol(n: u64) -> u64 {
    n * LAMPORTS_PER_SOL
}

/// SPL Token program (classic), loaded by LiteSVM's default programs.
fn spl_token_id() -> Pubkey {
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        .parse()
        .unwrap()
}

/// Demo token base units (6 decimals, USDC-style): `tok(1)` == 1_000_000.
fn tok(n: u64) -> u64 {
    n * 1_000_000
}

/// Build a classic 165-byte SPL token account's data (mint, owner, amount,
/// state=Initialized); all other COption fields are None/zero.
fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // AccountState::Initialized
    d
}

/// Anchor offsets user error codes by 6000. The on-chain `Custom(code)` for an
/// `AegisError` variant is therefore `6000 + variant_index`.
const ANCHOR_ERROR_OFFSET: u32 = 6000;
fn ecode(e: AegisError) -> u32 {
    ANCHOR_ERROR_OFFSET + e as u32
}

// --------------------------------------------------------------------------
// Result assertions (return Err(String) instead of panicking, so the gate can
// finish the table and report which assertion fired).
// --------------------------------------------------------------------------

fn rejected_code(r: &TransactionResult) -> Result<u32, String> {
    match r {
        Ok(_) => Err("expected a rejection but the transaction SUCCEEDED".to_string()),
        Err(meta) => match &meta.err {
            TransactionError::InstructionError(_, InstructionError::Custom(c)) => Ok(*c),
            other => Err(format!("expected a Custom program error, got {other:?}")),
        },
    }
}

fn expect_ok(r: &TransactionResult, ctx: &str) -> Result<(), String> {
    match r {
        Ok(_) => Ok(()),
        Err(meta) => Err(format!("{ctx}: expected SUCCESS, got {:?}", meta.err)),
    }
}

fn expect_reject(
    r: &TransactionResult,
    want: u32,
    want_name: &str,
    ctx: &str,
) -> Result<(), String> {
    let got = rejected_code(r).map_err(|e| format!("{ctx}: {e}"))?;
    if got == want {
        Ok(())
    } else {
        Err(format!(
            "{ctx}: expected reject Custom({want}) [{want_name}], got Custom({got})"
        ))
    }
}

// --------------------------------------------------------------------------
// Test harness
// --------------------------------------------------------------------------

struct Ctx {
    svm: LiteSVM,
    owner: Keypair,
    agent: Keypair,
    policy: Pubkey,
    vault: Pubkey,
    action_log: Pubkey,
}

fn new_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/aegis.so");
    svm.add_program(aegis::ID, bytes).unwrap();
    svm
}

impl Ctx {
    /// Build a fresh environment: fund owner + agent, initialize a policy with
    /// the given envelope, and fund the vault.
    fn setup(
        max_per_tx: u64,
        daily_limit: u64,
        allowed_recipients: Vec<Pubkey>,
        expiry_ts: i64,
        t0: i64,
        vault_funding: u64,
    ) -> Ctx {
        let mut svm = new_svm();
        let owner = Keypair::new();
        let agent = Keypair::new();
        svm.airdrop(&owner.pubkey(), sol(1_000)).unwrap();
        svm.airdrop(&agent.pubkey(), sol(10)).unwrap();

        let policy =
            Pubkey::find_program_address(&[b"policy", owner.pubkey().as_ref()], &aegis::ID).0;
        let vault = Pubkey::find_program_address(&[b"vault", policy.as_ref()], &aegis::ID).0;
        let action_log =
            Pubkey::find_program_address(&[b"action_log", policy.as_ref()], &aegis::ID).0;

        let mut ctx = Ctx {
            svm,
            owner,
            agent,
            policy,
            vault,
            action_log,
        };
        ctx.set_time(t0);

        // initialize_policy (owner)
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::InitializePolicy {
                agent_authority: ctx.agent.pubkey(),
                max_per_tx,
                daily_limit,
                allowed_programs: vec![],
                allowed_recipients,
                allowed_mints: vec![],
                expiry_ts,
            }
            .data(),
            aegis::accounts::InitializePolicy {
                owner: ctx.owner.pubkey(),
                policy: ctx.policy,
                action_log: ctx.action_log,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        );
        let owner = ctx.owner.insecure_clone();
        expect_ok(&ctx.send(ix, &[&owner]), "setup.initialize_policy").unwrap();

        // fund_vault (owner)
        ctx.fund(vault_funding);
        ctx
    }

    fn set_time(&mut self, t: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = t;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    /// Fresh blockhash per send so otherwise-identical txs get distinct
    /// signatures (LiteSVM dedupes by signature).
    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let payer = signers[0].pubkey();
        let msg = Message::new_with_blockhash(&[ix], Some(&payer), &self.svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        self.svm.send_transaction(tx)
    }

    fn fund(&mut self, amount: u64) {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::FundVault { amount }.data(),
            aegis::accounts::FundVault {
                owner: self.owner.pubkey(),
                policy: self.policy,
                vault: self.vault,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        );
        let owner = self.owner.insecure_clone();
        expect_ok(&self.send(ix, &[&owner]), "fund_vault").unwrap();
    }

    fn agent_transfer(
        &mut self,
        amount: u64,
        recipient: Pubkey,
        signer: &Keypair,
    ) -> TransactionResult {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::AgentTransfer { amount }.data(),
            aegis::accounts::AgentTransfer {
                agent_authority: signer.pubkey(),
                policy: self.policy,
                vault: self.vault,
                recipient,
                action_log: self.action_log,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, &[signer])
    }

    fn withdraw(&mut self, amount: u64, signer: &Keypair) -> TransactionResult {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::WithdrawVault { amount }.data(),
            aegis::accounts::WithdrawVault {
                owner: signer.pubkey(),
                policy: self.policy,
                vault: self.vault,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, &[signer])
    }

    fn revoke(&mut self) -> TransactionResult {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::RevokeAgent {}.data(),
            aegis::accounts::RevokeAgent {
                owner: self.owner.pubkey(),
                policy: self.policy,
            }
            .to_account_metas(None),
        );
        let owner = self.owner.insecure_clone();
        self.send(ix, &[&owner])
    }

    fn rotate(&mut self, new_agent_authority: Pubkey) -> TransactionResult {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::RotateAgent {
                new_agent_authority,
            }
            .data(),
            aegis::accounts::RotateAgent {
                owner: self.owner.pubkey(),
                policy: self.policy,
            }
            .to_account_metas(None),
        );
        let owner = self.owner.insecure_clone();
        self.send(ix, &[&owner])
    }

    fn update_policy(
        &mut self,
        max_per_tx: u64,
        daily_limit: u64,
        expiry_ts: i64,
    ) -> TransactionResult {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::UpdatePolicy {
                max_per_tx,
                daily_limit,
                allowed_programs: vec![],
                allowed_recipients: vec![],
                allowed_mints: vec![],
                expiry_ts,
                paused: false,
            }
            .data(),
            aegis::accounts::UpdatePolicy {
                owner: self.owner.pubkey(),
                policy: self.policy,
            }
            .to_account_metas(None),
        );
        let owner = self.owner.insecure_clone();
        self.send(ix, &[&owner])
    }

    /// Place a ready-made SPL token account (owned by the SPL Token program)
    /// directly into the SVM, so the agent_transfer_spl CPI has real accounts.
    fn set_token_account(&mut self, addr: Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
        let acct = SolanaAccount {
            lamports: sol(1) / 100, // comfortably rent-exempt for 165 bytes
            data: token_account_data(mint, owner, amount),
            owner: spl_token_id(),
            executable: false,
            rent_epoch: 0,
        };
        self.svm.set_account(addr, acct).unwrap();
    }

    fn configure_token(
        &mut self,
        token_mint: Pubkey,
        token_max_per_tx: u64,
        token_daily_limit: u64,
    ) -> TransactionResult {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::ConfigureToken {
                token_mint,
                token_max_per_tx,
                token_daily_limit,
            }
            .data(),
            aegis::accounts::ConfigureToken {
                owner: self.owner.pubkey(),
                policy: self.policy,
            }
            .to_account_metas(None),
        );
        let owner = self.owner.insecure_clone();
        self.send(ix, &[&owner])
    }

    fn agent_transfer_spl(
        &mut self,
        amount: u64,
        vault_token_account: Pubkey,
        recipient_token_account: Pubkey,
        signer: &Keypair,
    ) -> TransactionResult {
        let ix = Instruction::new_with_bytes(
            aegis::ID,
            &aegis::instruction::AgentTransferSpl { amount }.data(),
            aegis::accounts::AgentTransferSpl {
                agent_authority: signer.pubkey(),
                policy: self.policy,
                vault: self.vault,
                vault_token_account,
                recipient_token_account,
                action_log: self.action_log,
                token_program: spl_token_id(),
            }
            .to_account_metas(None),
        );
        self.send(ix, &[signer])
    }

    fn policy_state(&self) -> PolicyAccount {
        let acct = self
            .svm
            .get_account(&self.policy)
            .expect("policy account exists");
        PolicyAccount::try_deserialize(&mut acct.data.as_slice()).expect("deserialize policy")
    }

    fn vault_lamports(&self) -> u64 {
        self.svm
            .get_account(&self.vault)
            .map(|a| a.lamports)
            .unwrap_or(0)
    }
}

// --------------------------------------------------------------------------
// T1 — Cap boundary: per-tx {max-1 ok, max ok, max+1 reject};
//                    daily {limit-1 ok, exact ok, over reject}.
// --------------------------------------------------------------------------
fn t1_cap_boundary() -> Result<String, String> {
    let far = 10_000_000_000i64;
    let to = Keypair::new().pubkey();

    // --- per-tx boundary (daily set huge so it never binds) ---
    let mut a = Ctx::setup(sol(2), sol(1_000), vec![], far, 1_000, sol(10));
    let agent = a.agent.insecure_clone();
    expect_ok(&a.agent_transfer(sol(2) - 1, to, &agent), "T1 per-tx max-1")?;
    expect_ok(&a.agent_transfer(sol(2), to, &agent), "T1 per-tx == max")?;
    expect_reject(
        &a.agent_transfer(sol(2) + 1, to, &agent),
        ecode(AegisError::ExceedsPerTxLimit),
        "ExceedsPerTxLimit",
        "T1 per-tx max+1",
    )?;

    // --- daily boundary (max_per_tx == daily so single txs can fill it) ---
    let mut b = Ctx::setup(sol(5), sol(5), vec![], far, 1_000, sol(10));
    let agent = b.agent.insecure_clone();
    expect_ok(
        &b.agent_transfer(sol(5) - 1, to, &agent),
        "T1 daily limit-1",
    )?; // spent=5 SOL - 1 lamport
    expect_ok(&b.agent_transfer(1, to, &agent), "T1 daily == limit")?; // spent=5 SOL
    expect_reject(
        &b.agent_transfer(1, to, &agent), // 5 SOL + 1 lamport
        ecode(AegisError::ExceedsDailyLimit),
        "ExceedsDailyLimit",
        "T1 daily +1",
    )?;

    Ok(format!(
        "per-tx: max-1 ok, max ok, max+1→Custom({}) over_per_tx | daily: limit-1 ok, limit ok, +1→Custom({}) over_daily",
        ecode(AegisError::ExceedsPerTxLimit),
        ecode(AegisError::ExceedsDailyLimit),
    ))
}

// --------------------------------------------------------------------------
// T2 — Day rollover: spend to cap; advance <24h → reject; advance >=24h and
//      >24h → allowed again AND spent_today reset.
// --------------------------------------------------------------------------
fn t2_day_rollover() -> Result<String, String> {
    let t0 = 1_000_000i64;
    let expiry = t0 + 10 * 86_400;
    let to = Keypair::new().pubkey();
    let mut c = Ctx::setup(sol(5), sol(5), vec![], expiry, t0, sol(20));
    let agent = c.agent.insecure_clone();

    expect_ok(&c.agent_transfer(sol(5), to, &agent), "T2 spend to cap")?; // spent=5
    expect_reject(
        &c.agent_transfer(1, to, &agent),
        ecode(AegisError::ExceedsDailyLimit),
        "ExceedsDailyLimit",
        "T2 same-window over cap",
    )?;

    // advance <24h: still the same window → still rejected.
    c.set_time(t0 + 86_400 - 1);
    expect_reject(
        &c.agent_transfer(1, to, &agent),
        ecode(AegisError::ExceedsDailyLimit),
        "ExceedsDailyLimit",
        "T2 <24h still over cap",
    )?;

    // advance to EXACTLY the boundary (now == day_start + 86400): the spec uses
    // `>=`, so the window resets and the full cap is available again. (If the
    // program had used `>`, this exact-boundary case would still reject — this
    // is the off-by-one guard the spec flags.)
    let boundary = t0 + 86_400;
    c.set_time(boundary);
    expect_ok(
        &c.agent_transfer(sol(5), to, &agent),
        "T2 ==86400 boundary allowed",
    )?;

    let st = c.policy_state();
    if st.spent_today != sol(5) {
        return Err(format!(
            "T2 reset: expected spent_today==5 SOL after rollover, got {}",
            st.spent_today
        ));
    }
    if st.day_start_ts != boundary {
        return Err(format!(
            "T2 reset: expected day_start_ts=={boundary}, got {}",
            st.day_start_ts
        ));
    }

    // The prompt's gate calls out ">24h" explicitly. Use a fresh policy so
    // the exact-boundary spend above does not consume this window.
    let mut d = Ctx::setup(sol(5), sol(5), vec![], expiry, t0, sol(20));
    let agent = d.agent.insecure_clone();
    expect_ok(
        &d.agent_transfer(sol(5), to, &agent),
        "T2 >24h setup spend to cap",
    )?;
    d.set_time(t0 + 86_400 + 1);
    expect_ok(&d.agent_transfer(sol(5), to, &agent), "T2 >24h allowed")?;
    let st = d.policy_state();
    if st.spent_today != sol(5) {
        return Err(format!(
            "T2 >24h reset: expected spent_today==5 SOL after rollover, got {}",
            st.spent_today
        ));
    }
    if st.day_start_ts != t0 + 86_400 + 1 {
        return Err(format!(
            "T2 >24h reset: expected day_start_ts=={}, got {}",
            t0 + 86_400 + 1,
            st.day_start_ts
        ));
    }

    Ok(format!(
        "cap ok; +1→Custom({}) over_daily; t0+86399 (<24h)→Custom({}) over_daily; t0+86400 (exact >= boundary) ok; t0+86401 (>24h) ok + spent_today reset",
        ecode(AegisError::ExceedsDailyLimit),
        ecode(AegisError::ExceedsDailyLimit),
    ))
}

// --------------------------------------------------------------------------
// T3 — Signer: non-agent key calling agent_transfer → reject;
//      owner can withdraw_vault unconstrained (amount > per-tx cap) → pass.
// --------------------------------------------------------------------------
fn t3_signer() -> Result<String, String> {
    let far = 10_000_000_000i64;
    let to = Keypair::new().pubkey();
    let mut c = Ctx::setup(sol(2), sol(2), vec![], far, 1_000, sol(50));

    // An intruder (NOT agent_authority) signs agent_transfer → reject.
    let intruder = Keypair::new();
    c.svm.airdrop(&intruder.pubkey(), sol(10)).unwrap();
    expect_reject(
        &c.agent_transfer(sol(1), to, &intruder),
        ecode(AegisError::UnauthorizedAgent),
        "UnauthorizedAgent",
        "T3 intruder agent_transfer",
    )?;

    // Owner withdraws 10 SOL — five times the per-tx cap — UNCONSTRAINED.
    let before = c.vault_lamports();
    let owner = c.owner.insecure_clone();
    expect_ok(
        &c.withdraw(sol(10), &owner),
        "T3 owner withdraw unconstrained",
    )?;
    let after = c.vault_lamports();
    if before.saturating_sub(after) != sol(10) {
        return Err(format!(
            "T3 withdraw: expected vault to drop by 10 SOL, dropped by {}",
            before - after
        ));
    }

    Ok(format!(
        "intruder→Custom({}) unauthorized; owner withdraw 10 SOL (>2 SOL cap) ok, vault −10 SOL",
        ecode(AegisError::UnauthorizedAgent),
    ))
}

// --------------------------------------------------------------------------
// T4 — Revoke: after revoke_agent, the old agent key's next agent_transfer
//      fails (signer check, since agent_authority is zeroed).
// --------------------------------------------------------------------------
fn t4_revoke() -> Result<String, String> {
    let far = 10_000_000_000i64;
    let to = Keypair::new().pubkey();
    let mut c = Ctx::setup(sol(2), sol(10), vec![], far, 1_000, sol(10));
    let agent = c.agent.insecure_clone();

    // Sanity: agent works before revoke.
    expect_ok(
        &c.agent_transfer(sol(1), to, &agent),
        "T4 agent works pre-revoke",
    )?;

    // Owner revokes.
    let owner = c.owner.insecure_clone();
    expect_ok(&c.revoke(), "T4 revoke_agent")?;

    // Old agent key now fails.
    let _ = owner; // (owner already used)
    expect_reject(
        &c.agent_transfer(sol(1), to, &agent),
        ecode(AegisError::UnauthorizedAgent),
        "UnauthorizedAgent",
        "T4 old agent post-revoke",
    )?;

    Ok(format!(
        "agent ok pre-revoke; revoke; old key→Custom({}) unauthorized (authority zeroed + paused)",
        ecode(AegisError::UnauthorizedAgent),
    ))
}

// --------------------------------------------------------------------------
// T5 — Allow-list: recipient not in a non-empty allowed_recipients → reject;
//      an allowed recipient → pass.
// --------------------------------------------------------------------------
fn t5_allow_list() -> Result<String, String> {
    let far = 10_000_000_000i64;
    let allowed = Keypair::new().pubkey();
    let other = Keypair::new().pubkey();
    let mut c = Ctx::setup(sol(10), sol(10), vec![allowed], far, 1_000, sol(20));
    let agent = c.agent.insecure_clone();

    expect_ok(
        &c.agent_transfer(sol(1), allowed, &agent),
        "T5 allowed recipient",
    )?;
    expect_reject(
        &c.agent_transfer(sol(1), other, &agent),
        ecode(AegisError::RecipientNotAllowed),
        "RecipientNotAllowed",
        "T5 non-allowed recipient",
    )?;

    Ok(format!(
        "allowed recipient ok; non-allowed→Custom({}) recipient_not_allowed",
        ecode(AegisError::RecipientNotAllowed),
    ))
}

// --------------------------------------------------------------------------
// T6 — Admin invariants: owner cannot update the policy into zero limits or an
//      already-expired session, and rotate_agent cannot install the default key.
// --------------------------------------------------------------------------
fn t6_admin_invariants() -> Result<String, String> {
    let t0 = 1_000_000i64;
    let expiry = t0 + 10 * 86_400;
    let mut c = Ctx::setup(sol(2), sol(5), vec![], expiry, t0, sol(10));

    expect_reject(
        &c.update_policy(0, sol(5), expiry),
        ecode(AegisError::InvalidLimits),
        "InvalidLimits",
        "T6 zero max_per_tx",
    )?;
    expect_reject(
        &c.update_policy(sol(2), 0, expiry),
        ecode(AegisError::InvalidLimits),
        "InvalidLimits",
        "T6 zero daily_limit",
    )?;
    expect_reject(
        &c.update_policy(sol(2), sol(5), t0),
        ecode(AegisError::InvalidLimits),
        "InvalidLimits",
        "T6 expired policy update",
    )?;
    expect_reject(
        &c.rotate(Pubkey::default()),
        ecode(AegisError::InvalidAgentAuthority),
        "InvalidAgentAuthority",
        "T6 default rotate key",
    )?;

    Ok(format!(
        "zero limits / expired update→Custom({}) invalid_limits; default rotate key→Custom({}) invalid_agent_authority",
        ecode(AegisError::InvalidLimits),
        ecode(AegisError::InvalidAgentAuthority),
    ))
}

// --------------------------------------------------------------------------
// T7 — SPL token envelope: not-configured reject; on-chain mint allow-list
//      (wrong mint reject); recipient allow-list; token per-tx + daily caps in
//      token units; and the token counter is INDEPENDENT of the SOL counter
//      (different assets).
// --------------------------------------------------------------------------
fn t7_spl_token() -> Result<String, String> {
    let far = 10_000_000_000i64;
    // SOL envelope: 2 / 5 SOL. Vault funded so the SOL path still works later.
    let mut c = Ctx::setup(sol(2), sol(5), vec![], far, 1_000, sol(10));
    let agent = c.agent.insecure_clone();

    let mint = Pubkey::new_unique();
    let other_mint = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    let vault_ta = Pubkey::new_unique();
    let recipient_ta = Pubkey::new_unique();

    // The vault PDA is the token authority; make sure it exists as a system acct.
    let vault_pda = c.vault;
    c.svm.airdrop(&vault_pda, sol(1)).unwrap();

    // Vault holds 1000 tokens; recipient starts at 0.
    c.set_token_account(vault_ta, &mint, &vault_pda, tok(1000));
    c.set_token_account(recipient_ta, &mint, &recipient, 0);

    // (a) Not configured yet → SplNotConfigured.
    expect_reject(
        &c.agent_transfer_spl(tok(10), vault_ta, recipient_ta, &agent),
        ecode(AegisError::SplNotConfigured),
        "SplNotConfigured",
        "T7 not configured",
    )?;

    // Owner configures the token envelope: per-tx 100, daily 250 (token units).
    expect_ok(
        &c.configure_token(mint, tok(100), tok(250)),
        "T7 configure_token",
    )?;

    // (b) ON-CHAIN MINT ALLOW-LIST: a token account of a DIFFERENT mint → reject.
    let wrong_vault_ta = Pubkey::new_unique();
    let wrong_recipient_ta = Pubkey::new_unique();
    c.set_token_account(wrong_vault_ta, &other_mint, &vault_pda, tok(1000));
    c.set_token_account(wrong_recipient_ta, &other_mint, &recipient, 0);
    expect_reject(
        &c.agent_transfer_spl(tok(10), wrong_vault_ta, wrong_recipient_ta, &agent),
        ecode(AegisError::MintNotAllowed),
        "MintNotAllowed",
        "T7 wrong mint",
    )?;

    // (c) RECIPIENT ALLOW-LIST: token-account owner is the policy target.
    let allowed_recipient = Pubkey::new_unique();
    let blocked_recipient = Pubkey::new_unique();
    let mut r = Ctx::setup(sol(2), sol(5), vec![allowed_recipient], far, 1_000, sol(10));
    let r_agent = r.agent.insecure_clone();
    let r_vault = r.vault;
    r.svm.airdrop(&r_vault, sol(1)).unwrap();
    let r_vault_ta = Pubkey::new_unique();
    let allowed_recipient_ta = Pubkey::new_unique();
    let blocked_recipient_ta = Pubkey::new_unique();
    r.set_token_account(r_vault_ta, &mint, &r_vault, tok(1000));
    r.set_token_account(allowed_recipient_ta, &mint, &allowed_recipient, 0);
    r.set_token_account(blocked_recipient_ta, &mint, &blocked_recipient, 0);
    expect_ok(
        &r.configure_token(mint, tok(100), tok(250)),
        "T7 recipient configure_token",
    )?;
    expect_ok(
        &r.agent_transfer_spl(tok(1), r_vault_ta, allowed_recipient_ta, &r_agent),
        "T7 token allowed recipient",
    )?;
    expect_reject(
        &r.agent_transfer_spl(tok(1), r_vault_ta, blocked_recipient_ta, &r_agent),
        ecode(AegisError::RecipientNotAllowed),
        "RecipientNotAllowed",
        "T7 token non-allowed recipient",
    )?;

    // (d) token per-tx boundary: == max ok, max+1 reject.
    expect_ok(
        &c.agent_transfer_spl(tok(100), vault_ta, recipient_ta, &agent),
        "T7 token per-tx == max",
    )?; // token_spent = 100
    expect_reject(
        &c.agent_transfer_spl(tok(101), vault_ta, recipient_ta, &agent),
        ecode(AegisError::ExceedsPerTxLimit),
        "ExceedsPerTxLimit",
        "T7 token per-tx max+1",
    )?;

    // (e) token daily cap (separate counter): 100 ok (→200), 100 → 300 > 250 reject.
    expect_ok(
        &c.agent_transfer_spl(tok(100), vault_ta, recipient_ta, &agent),
        "T7 token daily within",
    )?; // token_spent = 200
    expect_reject(
        &c.agent_transfer_spl(tok(100), vault_ta, recipient_ta, &agent),
        ecode(AegisError::ExceedsDailyLimit),
        "ExceedsDailyLimit",
        "T7 token daily over",
    )?;

    // (f) INDEPENDENCE: token spend left the SOL counter at 0; a SOL transfer
    //     still works and does not touch the token counter.
    let st = c.policy_state();
    if st.spent_today != 0 {
        return Err(format!(
            "T7 independence: SOL spent_today should be 0, got {}",
            st.spent_today
        ));
    }
    if st.token_spent_today != tok(200) {
        return Err(format!(
            "T7 token_spent_today expected 200 tok, got {}",
            st.token_spent_today
        ));
    }
    let to = Pubkey::new_unique();
    expect_ok(
        &c.agent_transfer(sol(1), to, &agent),
        "T7 SOL transfer still works alongside token envelope",
    )?;
    let st2 = c.policy_state();
    if st2.spent_today != sol(1) {
        return Err(format!(
            "T7 SOL spent_today expected 1 SOL, got {}",
            st2.spent_today
        ));
    }
    if st2.token_spent_today != tok(200) {
        return Err(format!(
            "T7 token counter moved by a SOL transfer: {}",
            st2.token_spent_today
        ));
    }

    // Vault token account actually debited by the two successful transfers (200).
    Ok(format!(
        "not-configured→Custom({}); wrong mint→Custom({}) mint_not_allowed; non-allowed recipient→Custom({}); token per-tx {{100 ok, 101→Custom({})}}; token daily {{→200 ok, →300→Custom({})}}; SOL/token counters independent (SOL=1, token=200)",
        ecode(AegisError::SplNotConfigured),
        ecode(AegisError::MintNotAllowed),
        ecode(AegisError::RecipientNotAllowed),
        ecode(AegisError::ExceedsPerTxLimit),
        ecode(AegisError::ExceedsDailyLimit),
    ))
}

// --------------------------------------------------------------------------
// THE GATE
// --------------------------------------------------------------------------
#[test]
fn aegis_enforcement_gate() {
    let cases: Vec<(&str, &str, fn() -> Result<String, String>)> = vec![
        ("T1", "Cap boundary", t1_cap_boundary),
        ("T2", "Day rollover", t2_day_rollover),
        ("T3", "Signer / owner-withdraw", t3_signer),
        ("T4", "Revoke", t4_revoke),
        ("T5", "Allow-list", t5_allow_list),
        ("T6", "Admin invariants", t6_admin_invariants),
        ("T7", "SPL token envelope", t7_spl_token),
    ];

    let mut results: Vec<(&str, &str, bool, String)> = Vec::new();
    for (id, name, f) in cases {
        match f() {
            Ok(detail) => results.push((id, name, true, detail)),
            Err(detail) => results.push((id, name, false, detail)),
        }
    }

    println!("\n┌──── AEGIS ENFORCEMENT GATE ──────────────────────────────────────────────");
    for (id, name, passed, detail) in &results {
        println!(
            "│ {id}  {:<24} {}\n│        ↳ {}",
            name,
            if *passed { "PASS ✅" } else { "FAIL ❌" },
            detail
        );
    }
    println!("└──────────────────────────────────────────────────────────────────────────\n");

    let failed: Vec<&str> = results.iter().filter(|r| !r.2).map(|r| r.0).collect();
    assert!(failed.is_empty(), "enforcement gate FAILED for: {failed:?}");
}

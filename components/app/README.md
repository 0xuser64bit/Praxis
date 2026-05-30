# Praxis App Surface

Route: `/app`

Recommended mock walkthrough:

1. Type `send 0.5 sol to maya` and sign the allowed proposal.
2. Type `send 50 sol to maya` and show the Aegis daily-limit rejection.
3. Type `swap 100 usdc into $SAFEMOON` and show that swaps are policy-preview stubs.
4. Revoke the agent in Policy, then type another send.
5. Type `what's bonk doing this week` for read-only research.

API mode starts with Solana wallet sign-in, then loads the wallet-scoped policy
and workspace. It does not fall back to mock data. If the live backend is not
configured, the app renders an explicit API error state.

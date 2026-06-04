# Security policy

GrayBox × Cloak handles cryptographic key material and on-chain value flows.
Treat any weakness in the codebase as potentially high-impact even though we
are pre-audit and devnet-only at the moment.

## Reporting a vulnerability

**Please do not open a public GitHub issue for vulnerabilities.**

Instead, email the maintainers at **hello@siriuslabs.tech** with:

- a clear description of the issue
- reproduction steps and proof-of-concept if possible
- the commit hash or release tag you tested
- whether you have already disclosed this elsewhere

We will respond within 5 business days to acknowledge receipt and propose a
remediation timeline.

## Scope

In scope:
- The stealth-address scheme (`apps/api-gateway/src/stealth.ts`) and its
  cross-language parity with the Rust `stealth_core` crate
- The Cloak SDK integration (`apps/api-gateway/src/cloak.ts`)
- The MORA relay (`apps/api-gateway/src/mora-relay.ts`)
- The API gateway's authentication, authorization, and input validation
  (`apps/api-gateway/src/routes.ts`, `src/auth.ts`)

Out of scope (for now):
- Devnet-only test data, demo keypairs, or seeded credentials in fixtures
- Issues in Solana itself, Anchor framework, or third-party dependencies
  (please report to those projects directly)
- Denial-of-service against the public devnet RPC

## Known limitations

The following are explicitly known weaknesses in the current codebase. They do
not require disclosure but PRs that close them are welcome:

- The on-chain programs (MORA, GrayBox) are **not audited**. Do not move real
  value through them. Audit in progress: Adevar Labs.
- The AML oracle is a stub; signed attestations are not yet sourced from a real
  Chainalysis / TRM / Range integration.
- The relay keypair is loaded from `RELAY_KEYPAIR_JSON` env var. Production
  deployments should use a remote signer or HSM.
- The in-memory store has no persistence. Production deployments must set
  `DATABASE_URL` to a postgres instance.

## Cryptographic assumptions

The stealth-address derivation relies on:

- Ed25519 group (twisted Edwards curve), prime-order subgroup
- SHA-512 (used for shared-secret derivation and view-tag computation)
- Per-deposit randomness with sufficient entropy (64-byte `rSeed`)

The canonical test vector in `apps/api-gateway/tests/vector.test.ts` locks
the exact algorithm byte-for-exact against the Rust `stealth_core` crate.
Any algorithmic change must update both sides and the locked vector together.

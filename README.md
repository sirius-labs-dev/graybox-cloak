# GrayBox × Cloak — Complete Payment Privacy on Solana

> GrayBox hides **who** receives — ECDH stealth addresses ensure the recipient's real wallet never appears on-chain.
> Cloak breaks the deposit-withdrawal linkage — Groth16 proofs make it cryptographically impossible to trace which deposit corresponds to which withdrawal.
> Together: recipient identity and transaction traceability both eliminated.

**Colosseum Frontier 2026 · Cloak Track Submission**

---

## The Problem

Every Solana payment leaks two things simultaneously:

1. **Who received** — the recipient wallet address is permanently on-chain
2. **How much** — the settlement amount is readable by anyone with a block explorer

Existing solutions address one or the other. No solution on Solana closes both gaps at once.

---

## The Solution

| Layer | Technology | What it hides |
|-------|-----------|--------------|
| **GrayBox** | ECDH stealth addresses (Ed25519) | Recipient identity |
| **Cloak SDK** | UTXO shielded pool (Groth16 ZK proofs) | Deposit-withdrawal linkage |
| **MORA** | Offline payment vouchers (114-byte QR chains) | Internet requirement |
| **Combined** | GrayBox + Cloak + MORA | Identity + linkage + connectivity |

A payment settled through this stack leaves only a ZK proof on-chain.  
No recipient address. No traceable link between deposit and withdrawal. No internet required at payment time.

**What Cloak actually provides:** Funds enter the shielded UTXO pool. A Groth16 proof is generated client-side, proving that inputs equal outputs without revealing which deposit corresponds to which withdrawal. The privacy comes from breaking this linkage — not from making amounts disappear entirely from the chain.

Privacy here is **load-bearing** — not a feature you add. Remove any layer and the privacy guarantee breaks.

---

## Live Deployment

```
https://graybox-cloak-production.up.railway.app
```

Test the compliance viewing key endpoint:
```bash
curl -X POST https://graybox-cloak-production.up.railway.app/v1/compliance/viewing-key \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4"
```

---

## Live Demo — Mainnet TX

A real private send executed on Solana mainnet via Cloak shielded pool:

| Step | Signature | Explorer |
|------|-----------|---------|
| Deposit into Cloak pool | `3bpjSixv...` | [Solana](https://explorer.solana.com/tx/3bpjSixvGPCRRKwNx83FeNK1UfwxUQDDHaKPnUV8u7eQ5NSCXEx9MApPAzALdnCciKaRjwEJux2igu79MFFoa2op) · [Cloak](https://explorer.cloak.ag/tx/3bpjSixvGPCRRKwNx83FeNK1UfwxUQDDHaKPnUV8u7eQ5NSCXEx9MApPAzALdnCciKaRjwEJux2igu79MFFoa2op) |
| Private withdrawal | `4mLPo2J8...` | [Solana](https://explorer.solana.com/tx/4mLPo2J8i9xxiQQbUmrkHJNEpBUZGoAaNug8wT7VXWKeX5zDBx37LSp9cZU4tpCZroHsn1VGvVnM2PyM4kRnMUqm) · [Cloak](https://explorer.cloak.ag/tx/4mLPo2J8i9xxiQQbUmrkHJNEpBUZGoAaNug8wT7VXWKeX5zDBx37LSp9cZU4tpCZroHsn1VGvVnM2PyM4kRnMUqm) |

The deposit transaction shows SOL entering the Cloak shielded pool. The withdrawal transaction shows SOL exiting — but the on-chain link between sender, recipient, and amount is broken by the Groth16 ZK proof.

---

## How Cloak SDK Is Used

The integration is in `apps/api-gateway/src/cloak.ts`.

### Endpoints

**`POST /v1/private-release`**  
Settles an approved deposit via Cloak's shielded pool instead of a transparent on-chain transfer.

```json
// Request
{ "deposit_id": "dep_1" }

// Response
{
  "deposit_id": "dep_1",
  "state": "released",
  "privacy_layer": "cloak_shielded_pool + graybox_stealth",
  "recipient_cloak_pubkey_hex": "...",
  "amount_lamports": "10000000",
  "cloak_utxo_inputs": 1,
  "cloak_utxo_outputs": 1,
  "viewing_key_id": "c460312e4fbc2917:73f8be9b9894bfe3",
  "viewing_key_hex": "...",
  "compliance_url": "https://explorer.cloak.ag/compliance?vk=...",
  "privacy_note": "Recipient identity hidden via GrayBox ECDH stealth address. Deposit-withdrawal link broken via Cloak Groth16 ZK proof."
}
```

**`POST /v1/compliance/viewing-key`**  
Generates institution's Cloak viewing key for audit/compliance use.

```json
// Response
{
  "spend_pubkey_hex": "...",
  "viewing_key_hex": "...",
  "pvk_hex": "...",
  "viewing_key_id": "...",
  "compliance_url": "https://explorer.cloak.ag/compliance?vk=...",
  "usage": "Input viewing_key_hex at https://explorer.cloak.ag/compliance to decrypt transaction amounts."
}
```

**`POST /v1/mora-private-settle`**  
Routes a settled MORA offline voucher through Cloak's shielded pool to a GrayBox stealth address. Full MORA × Cloak × GrayBox stack in a single call.

```bash
curl -X POST https://graybox-cloak-production.up.railway.app/v1/mora-private-settle \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -d '{
    "channel_id": "mora_ch_001",
    "seq": 3,
    "prev_hash": "a7f3c2e91b...",
    "recipient_pub_hex": "bbbbbbbb...",
    "amount_lamports": "10000000"
  }'
```

```json
// Response
{
  "voucher_channel_id": "mora_ch_001",
  "voucher_seq": 3,
  "amount_lamports": "10000000",
  "stealth_pubkey_hex": "...",
  "ephemeral_r_hex": "...",
  "deposit_signature": "...",
  "withdraw_signature": "...",
  "deposit_explorer": "https://explorer.solana.com/tx/...",
  "withdraw_explorer": "https://explorer.solana.com/tx/...",
  "cloak_deposit_explorer": "https://explorer.cloak.ag/tx/...",
  "cloak_withdraw_explorer": "https://explorer.cloak.ag/tx/...",
  "viewing_key_hex": "...",
  "compliance_url": "https://explorer.cloak.ag/compliance?vk=...",
  "privacy_stack": ["MORA", "Cloak", "GrayBox"],
  "privacy_note": "MORA: offline payment authorized without internet. Cloak: deposit-withdrawal link broken via Groth16 ZK proof. GrayBox: recipient identity hidden via ECDH stealth address."
}
```

### SDK Usage

```typescript
import { generateCloakKeys, SimpleWallet } from "@cloak.dev/sdk";

// Generate institution Cloak keys
const keys = generateCloakKeys();
// keys.spend.pk_spend_hex  → deposit address
// keys.view.vk_secret_hex  → viewing key for compliance

// Prepare private settlement
const wallet = new SimpleWallet(keys.view);
const prepared = await wallet.send(lamports, recipientSpendPubkey);
// inputs/outputs: UTXO parameters for Cloak relay
```

---

## MORA × Cloak × GrayBox — Full Stack

`apps/api-gateway/src/mora-relay.ts`

This is the complete three-layer privacy stack working together.

**What each layer does:**

| Layer | Removes |
|-------|---------|
| MORA | Internet requirement at payment time |
| Cloak | On-chain link between deposit and withdrawal |
| GrayBox | Recipient identity at the withdrawal destination |

**What the chain sees after a full-stack settlement:**

```
On-chain record: ZK proof only.
- Who sent? Unknown.
- Who received? Unknown.
- How much? Unlinked.
- Was internet needed? No.
```

**Payment flow:**

```
Alice (offline, no internet)
    │
    │  Signs 114-byte MORA voucher
    │  Passes via QR / NFC
    ▼
Bob scans, goes online later
    │
    │  POST /v1/mora-private-settle
    ▼
Relay: MORA settle_envelope
    │
    ▼
Cloak transact() → shielded UTXO pool
    │  Groth16 proof generated client-side
    │  Deposit-withdrawal link broken
    ▼
Cloak fullWithdraw() → GrayBox stealth address
    │  ECDH-derived one-time address
    │  Recipient's real wallet never on-chain
    ▼
On-chain: ZK proof only
```

**Why this matters:**

Without MORA: Alice needs internet to authorize the payment.  
Without Cloak: the deposit-to-stealth-address path is traceable.  
Without GrayBox: the withdrawal destination reveals the recipient.  
All three together: a merchant in Lagos receives a payment with no internet, no identity trail, and no traceable funding path.

---

## Architecture

```
Payment flow (GrayBox + Cloak):

  Sender ──► GrayBox stealth address (one-time, unlinked to receiver)
                        │
                        ▼
              Cloak shielded pool (Groth16 ZK proof)
                        │
                        ▼
              On-chain: only a ZK proof

Full stack (MORA + Cloak + GrayBox):

  Offline voucher (114-byte, QR)
                        │
                        ▼
              Relay: Cloak transact() + fullWithdraw()
                        │
                        ▼
              GrayBox stealth address
                        │
                        ▼
              On-chain: only a ZK proof
```

**GrayBox layer** (`src/stealth.ts`):  
ECDH stealth address derivation — mirrors `stealth_core::derive_stealth_address_deterministic`.  
TypeScript implementation verified byte-exact against the Rust crate.

**Cloak layer** (`src/cloak.ts`):  
`generateCloakKeys()` → institution keys (spend + view).  
`SimpleWallet.send()` → prepares UTXO transfer with ZK proof parameters.  
`buildComplianceRecord()` → viewing key identifier for selective audit disclosure.

**MORA relay** (`src/mora-relay.ts`):  
`moraPrivateSettle()` → chains MORA voucher → Cloak deposit → GrayBox stealth withdrawal.

---

## Setup

```bash
# Clone and install
git clone https://github.com/sirius-labs-dev/graybox-cloak
cd graybox-cloak/apps/api-gateway
npm install

# Run server (memory store, no database needed)
npm run dev
# → listening on http://localhost:3000

# Test compliance viewing key
curl -X POST http://localhost:3000/v1/compliance/viewing-key \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4"

# Test MORA private settle (demo mode)
curl -X POST http://localhost:3000/v1/mora-private-settle \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -d '{"channel_id":"ch_001","seq":1,"prev_hash":"a7f3c2e91b4d5f8a9c0b1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a","recipient_pub_hex":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","amount_lamports":"10000000"}'

# Run tests (8 passing)
npm test
```

---

## Tests

```
✓ tests/vector.test.ts (2 tests) — stealth address cross-language parity
✓ tests/api.test.ts   (6 tests) — API endpoint coverage

Test Files: 2 passed
Tests:      8 passed
```

---

## Why Privacy Is Load-Bearing Here

Removing GrayBox: Cloak breaks the linkage, but the withdrawal destination (recipient's real wallet) is still visible on-chain.

Removing Cloak: GrayBox hides the recipient, but an observer can trace which deposit funded which withdrawal.

Removing MORA: Cloak and GrayBox hide identity and linkage, but the payment still requires internet at authorization time.

All three together: the on-chain record is a ZK proof. No recipient. No linkage. No internet dependency.

---

## Roadmap

- [x] GrayBox + Cloak integration — live on Railway
- [x] Real mainnet TX — explorer-verifiable
- [x] MORA × Cloak × GrayBox relay — `POST /v1/mora-private-settle`
- [ ] Funded relay wallet for live MORA settlements on mainnet
- [ ] Third-party security audit (Adevar Labs)

---

## License

Apache 2.0

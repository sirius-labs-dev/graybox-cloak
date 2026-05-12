# GrayBox × Cloak — Complete Payment Privacy on Solana

> GrayBox hides **who** receives. Cloak hides **how much** is transferred.
> Together: identity and amount both hidden on-chain.

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
| **Cloak SDK** | UTXO shielded pool (Groth16 ZK proofs) | Settlement amount |
| **Combined** | GrayBox + Cloak | Identity + amount |

A payment settled through this stack leaves only a ZK proof on-chain.  
No recipient address. No amount. No on-chain link to the receiver's real wallet.

Privacy here is **load-bearing** — not a feature you add. Remove either layer and the privacy guarantee breaks.

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

### New Endpoints

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
  "privacy_note": "Amount hidden on-chain via Cloak shielded pool (Groth16). Recipient identity hidden via GrayBox ECDH stealth address. Viewing key enables selective compliance disclosure."
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
// amount never appears on-chain
```

---

## Architecture

```
Payment flow:

  Sender ──► GrayBox stealth address (one-time, unlinked to receiver)
                        │
                        ▼
              Cloak shielded pool (amount hidden via Groth16 ZK proof)
                        │
                        ▼
              On-chain: only a ZK proof
              Block explorer sees: nothing useful
```

**GrayBox layer** (`src/stealth.ts`):  
ECDH stealth address derivation — mirrors `stealth_core::derive_stealth_address_deterministic`.  
Each payment generates a fresh one-time address. The view key scans incoming payments.  
TypeScript implementation verified byte-exact against the Rust crate.

**Cloak layer** (`src/cloak.ts`):  
`generateCloakKeys()` → institution keys (spend + view).  
`SimpleWallet.send()` → prepares UTXO transfer with ZK proof parameters.  
`buildComplianceRecord()` → viewing key identifier for selective audit disclosure.

---

## Setup

```bash
# Clone and install
git clone https://github.com/YOUR_HANDLE/graybox-cloak
cd graybox-cloak/apps/api-gateway
npm install

# Run server (memory store, no database needed)
npm run dev
# → gpay-api-gateway listening on http://localhost:3000

# Test compliance viewing key
curl -X POST http://localhost:3000/v1/compliance/viewing-key \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4"

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

Removing GrayBox: Cloak hides the amount, but the recipient's wallet address remains visible. A block explorer links every settlement to the institution's real treasury address.

Removing Cloak: GrayBox hides the recipient, but the settlement amount is visible. Competitors and adversaries can monitor treasury flows in real time.

Both layers together: the on-chain record is a ZK proof. No recipient. No amount. Compliance is handled off-chain via the viewing key.

---

## Roadmap

- [ ] MORA integration: offline payment vouchers (114-byte QR chains) settle privately via Cloak — timing unlinkability added on top of identity and amount privacy
- [ ] Mainnet deployment with funded Cloak wallet
- [ ] Third-party security audit (Adevar Labs)

---

## License

Apache 2.0

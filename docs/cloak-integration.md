# Cloak Integration Guide

Integrating [Cloak](https://cloak.ag) into the GrayBox × MORA privacy stack.

Cloak provides a shielded UTXO pool on Solana — deposits and withdrawals are
linked only by a Groth16 ZK proof, making the funding path cryptographically
untraceable. Combined with GrayBox stealth addresses and MORA offline
vouchers, every payment attribute is hidden:

| What is hidden | Layer |
|----------------|-------|
| Recipient identity | GrayBox (ECDH stealth address) |
| Deposit-withdrawal link | Cloak (Groth16 ZK proof) |
| Internet requirement | MORA (offline 84-byte voucher) |

---

## Prerequisites

```bash
npm install @cloak.dev/sdk @solana/web3.js @noble/curves @noble/hashes
```

Supported assets: **SOL**, **USDC**, **USDT**  
Network: **Solana mainnet** (Cloak) · **devnet** (MORA + GrayBox programs)  
Cloak docs: [docs.cloak.ag](https://docs.cloak.ag)

---

## Path A — Cloak SDK (direct)

Use `@cloak.dev/sdk` when you control the signing keypair and want direct
access to the shielded pool without going through the GrayBox API gateway.

### 1. Generate institution keys

```typescript
import { generateCloakKeys } from "@cloak.dev/sdk";

const keys = generateCloakKeys();

// keys.spend.pk_spend_hex  — deposit address (share with payers)
// keys.view.vk_secret_hex  — viewing key    (keep private; use for compliance)
// keys.view.pvk_hex        — public viewing key

console.log("Deposit address:", keys.spend.pk_spend_hex);
console.log("Viewing key:", keys.view.vk_secret_hex);
```

> In production, derive keys deterministically from your institution's seed
> phrase so they survive restarts.

### 2. Shield (deposit into pool)

```typescript
import {
  generateUtxoKeypair,
  createUtxo,
  createZeroUtxo,
  getNkFromUtxoPrivateKey,
  transact,
  NATIVE_SOL_MINT,
  CLOAK_PROGRAM_ID,
} from "@cloak.dev/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const depositorKeypair = Keypair.fromSecretKey(/* your funded keypair */);
const amountLamports = BigInt(10_000_000); // 0.01 SOL

const utxoKp = await generateUtxoKeypair();
const outputUtxo = await createUtxo(amountLamports, utxoKp, NATIVE_SOL_MINT);
const nk = getNkFromUtxoPrivateKey(utxoKp.privateKey);

const deposit = await transact(
  {
    inputUtxos: [await createZeroUtxo()],
    outputUtxos: [outputUtxo],
    externalAmount: amountLamports,
    depositor: depositorKeypair.publicKey,
  },
  {
    connection,
    programId: CLOAK_PROGRAM_ID,
    depositorKeypair,
    chainNoteViewingKeyNk: nk,
    enforceViewingKeyRegistration: false,
  },
);

console.log("Deposit TX:", deposit.signature);
// https://explorer.cloak.ag/tx/<signature>
```

### 3. Withdraw to recipient

```typescript
import { fullWithdraw } from "@cloak.dev/sdk";
import { PublicKey } from "@solana/web3.js";

const recipientPubkey = new PublicKey("recipient-wallet-address");

const withdrawal = await fullWithdraw(
  [deposit.outputUtxos[0]],
  recipientPubkey,
  {
    connection,
    programId: CLOAK_PROGRAM_ID,
    depositorKeypair,
    walletPublicKey: depositorKeypair.publicKey,
    chainNoteViewingKeyNk: nk,
    cachedMerkleTree: deposit.merkleTree,
    enforceViewingKeyRegistration: false,
  },
);

console.log("Withdraw TX:", withdrawal.signature);
```

### 4. Compliance viewing key

The viewing key lets auditors decrypt transaction amounts without exposing
the private key or revealing the funding path.

```typescript
// Store viewing key for compliance
const viewingKey = keys.view.vk_secret_hex;

// Auditor decrypts at:
// https://explorer.cloak.ag/compliance?vk=<viewingKey>
```

---

## Path B — GrayBox API Gateway (REST)

Use the API gateway when you want a hosted integration — no local key
management or proof generation required. The gateway handles Cloak SDK
calls server-side and returns explorer-verifiable results.

**Base URL:** `https://graybox-cloak-production.up.railway.app`  
**Auth header:** `x-api-key: <your-api-key>`  
**Demo key (devnet):** `g-p_demo_h6kj9d8s7g6f5d4`

### Endpoint overview

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/v1/receiving-address` | Derive a one-time GrayBox stealth address |
| `POST` | `/v1/private-release` | Settle via Cloak shielded pool |
| `POST` | `/v1/mora-private-settle` | MORA + Cloak + GrayBox in one call |
| `POST` | `/v1/compliance/viewing-key` | Generate institution viewing key |

### Generate a receiving address

```bash
curl -X POST https://graybox-cloak-production.up.railway.app/v1/receiving-address \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -d '{
    "customer_id": "cust_001",
    "amount_hint": "10000000",
    "mint": "So11111111111111111111111111111111111111112",
    "expire_seconds": 3600,
    "refund_addr_hex": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

Response:
```json
{
  "deposit_id": "dep_abc123",
  "stealth_pubkey_hex": "...",
  "ephemeral_r_hex": "...",
  "view_tag": 42,
  "expires_at": 1234567890
}
```

The `stealth_pubkey_hex` is a one-time address — the recipient's real wallet
never appears on-chain.

### Private release (Cloak settlement)

```bash
curl -X POST https://graybox-cloak-production.up.railway.app/v1/private-release \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -d '{ "deposit_id": "dep_abc123" }'
```

Response includes `cloak_utxo_inputs`, `cloak_utxo_outputs`, and a
`compliance_url` for selective audit disclosure.

### MORA × Cloak × GrayBox (full stack)

```bash
curl -X POST https://graybox-cloak-production.up.railway.app/v1/mora-private-settle \
  -H "Content-Type: application/json" \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -d '{
    "channel_id": "mora_ch_001",
    "seq": 1,
    "prev_hash": "a7f3c2e91b4d5f8a9c0b1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a",
    "recipient_pub_hex": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "amount_lamports": "10000000"
  }'
```

Response:
```json
{
  "deposit_signature": "...",
  "withdraw_signature": "...",
  "deposit_explorer": "https://explorer.solana.com/tx/...",
  "cloak_deposit_explorer": "https://explorer.cloak.ag/tx/...",
  "cloak_withdraw_explorer": "https://explorer.cloak.ag/tx/...",
  "viewing_key_hex": "...",
  "compliance_url": "https://explorer.cloak.ag/compliance?vk=...",
  "privacy_stack": ["MORA", "Cloak", "GrayBox"]
}
```

---

## Payment flow (full stack)

```
Alice (offline, no internet)
    │
    │  Signs 84-byte MORA voucher
    │  Passes via QR / NFC
    ▼
Bob scans, goes online later
    │
    │  POST /v1/mora-private-settle
    ▼
Relay: Cloak transact() → shielded UTXO pool
    │  Groth16 proof generated client-side (~3s)
    │  Deposit-withdrawal link broken
    ▼
Cloak fullWithdraw() → GrayBox stealth address
    │  Ed25519 ECDH one-time address
    │  Recipient's real wallet never on-chain
    ▼
On-chain record: ZK proof only
```

---

## Error handling

| Error | Cause | Fix |
|-------|-------|-----|
| `No UTXOs available` | Relay wallet not funded | Fund relay keypair on mainnet |
| `Invalid api key` | Wrong or missing `x-api-key` | Check header value |
| `deposit not found` | Wrong `deposit_id` | Use the ID from `/v1/receiving-address` |

---

## Run the examples

Working TypeScript examples are in [`examples/`](../examples/):

| File | What it shows |
|------|--------------|
| [`1-cloak-sdk-basic.ts`](../examples/1-cloak-sdk-basic.ts) | Cloak SDK: keys, deposit, withdraw |
| [`2-graybox-cloak.ts`](../examples/2-graybox-cloak.ts) | GrayBox stealth + Cloak shielded pool |
| [`3-mora-cloak-graybox-fullstack.ts`](../examples/3-mora-cloak-graybox-fullstack.ts) | Full MORA × Cloak × GrayBox stack |

```bash
cd apps/api-gateway
npm install
npx tsx ../../examples/1-cloak-sdk-basic.ts
```

---

## Resources

- [Cloak](https://cloak.ag) — private financial infrastructure on Solana
- [Cloak Docs](https://docs.cloak.ag) — SDK reference
- [Cloak Explorer](https://explorer.cloak.ag) — verify shielded transactions
- [GrayBox × Cloak Demo](https://sirius-labs-dev.github.io/graybox-cloak-demo/)
- [Live API](https://graybox-cloak-production.up.railway.app)

### Protocol deep-dives

- [MORA Protocol](mora-protocol.md) — on-chain instructions, voucher format, relay integration
- [GrayBox Protocol](graybox-protocol.md) — stealth address derivation, recipient scanning, claim flow



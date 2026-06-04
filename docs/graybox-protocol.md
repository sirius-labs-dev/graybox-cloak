# GrayBox Protocol

GrayBox hides the recipient of a Solana payment. Instead of sending to
a real wallet address, the sender derives a one-time *stealth address*
from the recipient's public keys. The recipient's real wallet never
appears on-chain.

**Program (devnet):** `75HuPfb2n7SD7KtcQnVpCW5SVN3RP9gZ9vTXP4D4ha6C`  
**Source:** [`apps/api-gateway/src/stealth.ts`](../apps/api-gateway/src/stealth.ts)  
**Rust mirror:** `stealth_core::derive_stealth_address_deterministic`

---

## Key Concepts

**Spend key (`spendPub` / `spendPriv`)** — controls spending from stealth
addresses. Never shared.

**View key (`viewPub` / `viewPriv`)** — allows scanning incoming payments
without spending. Can be shared with auditors.

**Ephemeral key (`r`)** — random scalar generated fresh per payment by the
sender. Enables the ECDH exchange.

**Stealth address** — one-time destination derived per payment. Unlinked
to `spendPub` by any on-chain observer.

**View tag** — 1-byte hint allowing the recipient to skip most addresses
during scanning without performing full ECDH.

---

## Derivation Algorithm

```
Input:
  spendPub   — 32-byte Ed25519 public key of recipient
  viewPub    — 32-byte Ed25519 public key of recipient
  rSeed      — 64 random bytes (sender generates fresh per payment)
  nonce      — u64 (default 0)

Constants (domain separation):
  DOMAIN_SHARED   = "g-pay/stealth/shared/v1"
  DOMAIN_OFFSET   = "g-pay/stealth/offset/v1"
  DOMAIN_VIEW_TAG = "g-pay/stealth/view-tag/v1"

Algorithm:
  1. r          = sha512_wide_reduce(rSeed) mod L      // ephemeral scalar
  2. R          = r × G                                // ephemeral pubkey (sent to chain)
  3. sharedPt   = r × viewPub                          // ECDH shared point
  4. shared     = SHA-512(DOMAIN_SHARED || sharedPt)[0:32]
  5. offset     = sha512_wide_reduce(DOMAIN_OFFSET || shared || nonce_le8) mod L
  6. stealthPub = spendPub + offset × G                // one-time address
  7. viewTag    = SHA-512(DOMAIN_VIEW_TAG || shared)[0] // 1-byte hint

Output:
  stealthPubkey — 32 bytes — send funds here
  ephemeralR    — 32 bytes — publish on-chain alongside the payment
  viewTag       — 1 byte   — allows fast recipient scan
```

`sha512_wide_reduce` reduces a 64-byte SHA-512 output to a scalar mod L
(the Ed25519 curve order), preventing bias.

---

## Sender Side

```typescript
import { deriveStealthAddress } from "./stealth.js";

// Recipient publishes spendPub and viewPub (e.g., via their GrayBox identity)
const { stealthPubkey, ephemeralR, viewTag } = deriveStealthAddress(
  recipientSpendPub,  // Uint8Array (32 bytes)
  recipientViewPub,   // Uint8Array (32 bytes)
  0n,                 // nonce (optional)
);

// Send SOL to: new PublicKey(stealthPubkey)
// Publish alongside the TX: ephemeralR, viewTag
```

Each call to `deriveStealthAddress` generates a fresh random `rSeed` —
every payment gets a unique stealth address.

For a reproducible address (e.g., testing), use the deterministic variant:

```typescript
import { deriveStealthAddressDeterministic } from "./stealth.js";

const rSeed = new Uint8Array(64);  // provide your own 64 random bytes
const addr = deriveStealthAddressDeterministic(spendPub, viewPub, rSeed, 0n);
```

---

## Key Generation

GrayBox uses its **own key format** — raw 32-byte scalars reduced mod L.
These are NOT standard Solana wallet keypairs.

```typescript
import { ed25519 } from "@noble/curves/ed25519";
const L = ed25519.CURVE.n;

// Convert 32 raw bytes → scalar (little-endian bigint mod L)
function bytesToScalar(privBytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = privBytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(privBytes[i]!);
  return n % L;
}

// Generate a fresh GrayBox keypair
const spendPrivBytes = crypto.getRandomValues(new Uint8Array(32));
const viewPrivBytes  = crypto.getRandomValues(new Uint8Array(32));

const spendPrivScalar = bytesToScalar(spendPrivBytes);
const viewPrivScalar  = bytesToScalar(viewPrivBytes);

// Derive public keys (publish these so senders can derive stealth addresses)
const spendPub = ed25519.ExtendedPoint.BASE.multiply(spendPrivScalar).toRawBytes();
const viewPub  = ed25519.ExtendedPoint.BASE.multiply(viewPrivScalar).toRawBytes();
```

Store `spendPrivBytes` and `viewPrivBytes` securely. Register `spendPub`
and `viewPub` with the API gateway (see [API Gateway](#api-gateway) below).

---

## Recipient Side — Scanning for Incoming Payments

The recipient watches on-chain transactions and checks each one using
their view key. The spend key is only needed to claim funds.

```typescript
import { ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha512";

const enc = new TextEncoder();
const DOMAIN_SHARED   = enc.encode("g-pay/stealth/shared/v1");
const DOMAIN_OFFSET   = enc.encode("g-pay/stealth/offset/v1");
const DOMAIN_VIEW_TAG = enc.encode("g-pay/stealth/view-tag/v1");
const L = ed25519.CURVE.n;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function scalarFromBytesWide(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
  return n % L;
}

/**
 * For each transaction output, check if it belongs to this recipient.
 *
 * @param ephemeralR  32-byte R published alongside the payment
 * @param viewTag     1-byte hint published alongside the payment
 * @param txDestination  32-byte destination pubkey of the output
 * @param viewPriv    recipient view private key (64-byte seed or 32-byte scalar)
 * @param spendPub    recipient spend public key
 * @param nonce       must match what sender used (default 0n)
 */
function isMine(
  ephemeralR: Uint8Array,
  viewTag: number,
  txDestination: Uint8Array,
  viewPrivScalar: bigint,
  spendPub: Uint8Array,
  nonce = 0n,
): boolean {
  // 1. Recompute shared secret using view private key
  const Rpoint = ed25519.ExtendedPoint.fromHex(ephemeralR);
  const sharedPoint = Rpoint.multiply(viewPrivScalar);
  const shared = sha512(concat(DOMAIN_SHARED, sharedPoint.toRawBytes())).slice(0, 32);

  // 2. Fast check: view tag must match (skips 255/256 addresses cheaply)
  const expectedTag = sha512(concat(DOMAIN_VIEW_TAG, shared))[0];
  if (expectedTag !== viewTag) return false;

  // 3. Full check: reconstruct expected stealth pubkey
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, nonce, true);
  const offsetScalar = scalarFromBytesWide(
    sha512(concat(DOMAIN_OFFSET, shared, nonceBytes))
  );
  const offsetPoint = ed25519.ExtendedPoint.BASE.multiply(offsetScalar);
  const spendPoint  = ed25519.ExtendedPoint.fromHex(spendPub);
  const expectedStealth = spendPoint.add(offsetPoint).toRawBytes();

  return Buffer.from(expectedStealth).equals(Buffer.from(txDestination));
}
```

**Scanning flow:**

```
For each on-chain transaction:
  extract: ephemeralR, viewTag, destinationPubkey

  if isMine(ephemeralR, viewTag, destinationPubkey, viewPrivScalar, spendPub):
    → payment is mine
    → store (ephemeralR, nonce) to reconstruct spending key later
```

View tag reduces full ECDH scan work by ~256×. Most addresses are rejected
in the first check (`expectedTag !== viewTag`).

---

## Claiming (Spending from Stealth Address)

To spend from a stealth address, the recipient reconstructs the one-time
private key using their spend private key:

```typescript
/**
 * Reconstruct the stealth private key for a confirmed incoming payment.
 * Only call this when ready to spend — requires spendPriv.
 */
function deriveStealthPrivKey(
  ephemeralR: Uint8Array,
  viewPrivScalar: bigint,
  spendPrivScalar: bigint,
  nonce = 0n,
): bigint {
  const Rpoint = ed25519.ExtendedPoint.fromHex(ephemeralR);
  const sharedPoint = Rpoint.multiply(viewPrivScalar);
  const shared = sha512(concat(DOMAIN_SHARED, sharedPoint.toRawBytes())).slice(0, 32);

  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, nonce, true);
  const offsetScalar = scalarFromBytesWide(
    sha512(concat(DOMAIN_OFFSET, shared, nonceBytes))
  );

  // stealthPriv = spendPriv + offset  (mod L)
  return (spendPrivScalar + offsetScalar) % L;
}
```

Use `stealthPrivKey` to sign transactions from the stealth address.

---

## Compliance — Selective Disclosure

The view key (`viewPriv`) can be shared with auditors to allow them to
scan and verify incoming payments without access to `spendPriv`.

Auditors can:
- Confirm which stealth addresses belong to the institution
- Verify payment amounts

Auditors cannot:
- Spend from stealth addresses
- Link stealth addresses to other institutions

Combined with Cloak's viewing key, a full audit trail is available:

| What auditor can see | Mechanism |
|----------------------|-----------|
| Recipient identity | GrayBox view key scan |
| Payment amount | Cloak compliance viewing key at `explorer.cloak.ag/compliance` |
| Funding source | Not visible (broken by Cloak ZK proof) |

---

## Cross-Language Parity

The TypeScript implementation is verified byte-exact against the Rust
`stealth_core` crate via a canonical test vector:

```
spendPriv : 0102...1f00
viewPriv  : a0a1...be00
rSeed     : 2122...5f60
nonce     : 7

Expected output:
  stealthPub : 20fa85036bcc5661f62af10c241ee8243e2543735e7e869c58df13b02f3c26c3
  ephemeralR : 21c24081dfbed643c24ca431092386e1cb0830937d5b4f4cc0d6f366586338b0
  viewTag    : 0xbf
```

Test: [`apps/api-gateway/tests/vector.test.ts`](../apps/api-gateway/tests/vector.test.ts)

---

## API Gateway

The API gateway abstracts GrayBox key management and stealth derivation
behind a REST interface. Institutions register their `spendPub` / `viewPub`
once; the gateway handles all stealth derivation and scanning server-side.

**Base URL:** `https://graybox-cloak-production.up.railway.app`  
**Auth:** `x-api-key: <your-key>` header on every request  
**Demo key:** `g-p_demo_h6kj9d8s7g6f5d4` (devnet, read-only demo institution)

### Running locally

```bash
git clone https://github.com/sirius-labs-dev/graybox-cloak
cd graybox-cloak/apps/api-gateway
cp .env.example .env        # fill in your values
npm install
npm run dev                 # → http://localhost:3000
```

See [`apps/api-gateway/.env.example`](../apps/api-gateway/.env.example)
for all required environment variables.

### Institution setup

An institution has:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (e.g. `"cloak_team"`) |
| `apiKey` | Secret used in `x-api-key` header |
| `spendPub` | 32-byte GrayBox spend public key |
| `viewPub` | 32-byte GrayBox view public key |
| `releaseAuthority` | Pubkey authorised to trigger on-chain release |
| `webhookUrl` | Optional — notified on deposit state changes |

In **memory mode** (no `DATABASE_URL`), seed the demo institution via
`bootstrapInstitutions` in `src/index.ts`. In **postgres mode**, insert
directly into the `institutions` table.

### Step 1 — Generate a stealth receiving address

```bash
curl -X POST https://graybox-cloak-production.up.railway.app/v1/receiving-address \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "cust_001",
    "amount_hint": "10000000",
    "mint": "So11111111111111111111111111111111111111112",
    "expire_seconds": 3600,
    "refund_addr_hex": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

```json
{
  "deposit_id": "dep_abc123",
  "stealth_pubkey_hex": "...",
  "ephemeral_r_hex": "...",
  "view_tag": 42,
  "expires_at": 1234567890
}
```

Direct the sender to pay `stealth_pubkey_hex`. Publish `ephemeral_r_hex`
and `view_tag` on-chain alongside the transaction so the recipient can scan.

### Step 2 — Indexer notifies gateway of on-chain match

When your indexer detects SOL arriving at `stealth_pubkey_hex`, call the
internal endpoint to update deposit state:

```bash
curl -X POST http://localhost:3000/v1/internal/deposit-detected \
  -H "x-internal-secret: dev-internal-secret-rotate" \
  -H "Content-Type: application/json" \
  -d '{
    "slice_id": 1,
    "deposit_pubkey": "<on-chain-address>",
    "stealth_pubkey": "<stealth_pubkey_hex from step 1>",
    "amount": 10000000,
    "state": "approved"
  }'
```

### Step 3 — Settle via Cloak → GrayBox

Once approved, trigger private settlement (Cloak shielded pool → stealth
address):

```bash
curl -X POST http://localhost:3000/v1/private-release \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -H "Content-Type: application/json" \
  -d '{ "deposit_id": "dep_abc123" }'
```

### Deposit state machine

```
pending → approved → released
       ↘ rejected → refunded
       ↘ expired  → refunded
```

| State | Meaning |
|-------|---------|
| `pending` | Stealth address generated, waiting for on-chain deposit |
| `approved` | Indexer confirmed on-chain match, AML cleared |
| `rejected` | AML rejected — refund available |
| `released` | Settled via Cloak → stealth address |
| `expired` | TTL elapsed — refund available |
| `refunded` | Lamports returned to `refund_addr` |

### Poll payment status

```bash
curl https://graybox-cloak-production.up.railway.app/v1/payment-status/dep_abc123 \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4"
```

### MORA + Cloak + GrayBox in one call

```bash
curl -X POST https://graybox-cloak-production.up.railway.app/v1/mora-private-settle \
  -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
  -H "Content-Type: application/json" \
  -d '{
    "channel_id": "mora_ch_001",
    "seq": 1,
    "prev_hash": "a7f3c2e91b4d5f8a9c0b1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a",
    "recipient_pub_hex": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "amount_lamports": "10000000"
  }'
```

See [`docs/cloak-integration.md`](cloak-integration.md) for the full
Cloak SDK walkthrough and payment flow.


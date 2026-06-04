# MORA Protocol

MORA is an offline payment escrow on Solana. It lets a payer authorize
payments without an internet connection at the moment of payment. Settlement
happens later, by anyone who scans the voucher.

**Program (devnet):** `9fcXHD3pHDKLX79JuVgCEKQiqYkvVqFtpoAEVjBq4aJ8`  
**Source:** [`programs/mora/src/lib.rs`](https://github.com/nzengi/mora/blob/main/programs/mora/src/lib.rs)  
**CLI:** [`cli/mora.ts`](https://github.com/nzengi/mora/blob/main/cli/mora.ts)

---

## How it works

```
Alice (online once)          Alice (offline)             Bob (online later)
        │                          │                              │
  create_escrow              mora voucher                   mora settle
  Locks SOL into PDA         Signs 84-byte msg              Submits to chain
  No internet needed         No internet needed             Pays Bob from PDA
  after this step            at payment time
```

Alice locks SOL into an on-chain escrow PDA once — this requires internet.
After that, she can authorize payments offline by signing vouchers.
Bob (or any relay) submits the voucher to the chain to claim the payment.

---

## On-Chain Instructions

### 1. `create_escrow`

Opens a new escrow PDA and transfers SOL into it.

**Accounts:**

| Account | Role |
|---------|------|
| `authority` | Signer — payer, owns the escrow |
| `escrow` | PDA — holds SOL |
| `system_program` | — |

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `seed` | `u64` | Unique seed for PDA derivation |
| `amount` | `u64` | Lamports to lock |
| `expires_at` | `i64` | Unix timestamp — escrow becomes closeable after this |

**PDA derivation:**
```
seeds = ["escrow", authority, seed_as_le_8_bytes]
program = 9fcXHD3pHDKLX79JuVgCEKQiqYkvVqFtpoAEVjBq4aJ8
```

**CLI:**
```bash
mora create --amount 1.0 --expires-in 86400
# Output: { "escrow": "<PDA>", "seed": "...", "tx": "..." }
```

---

### 2. `settle`

Pays a recipient from the escrow PDA using a signed voucher.

This instruction **must be the second instruction in the transaction**.
The first must be a native Ed25519 verify instruction carrying the
voucher signature. The program reads the previous instruction from the
sysvar and verifies the signature before transferring lamports.

**Accounts:**

| Account | Role |
|---------|------|
| `submitter` | Signer — pays transaction fees (can be anyone) |
| `escrow` | PDA — source of funds |
| `payee` | Recipient — bound by the voucher message |
| `receipt` | PDA — created to prevent replay |
| `ix_sysvar` | `SYSVAR_INSTRUCTIONS_PUBKEY` |
| `system_program` | — |

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `nonce` | `u64` | Must match the nonce in the voucher |
| `amount` | `u64` | Must match the amount in the voucher |

**Receipt PDA (replay protection):**
```
seeds = ["receipt", escrow_pubkey, nonce_as_le_8_bytes]
```

Each `(escrow, nonce)` pair can only be settled once — the receipt PDA
creation fails if it already exists.

---

### 3. `close_escrow`

Returns remaining SOL to the authority after the escrow expires.

```
Constraint: Clock::unix_timestamp >= escrow.expires_at
```

---

## Voucher Format

The voucher is an 84-byte message signed with Ed25519 by `escrow.authority`.

```
Offset  Len  Field
------  ---  -----
0       4    Domain tag: b"MORA"
4       32   Escrow PDA pubkey
36      8    Nonce (u64, little-endian)
44      32   Payee pubkey
76      8    Amount in lamports (u64, little-endian)
```

The full blob passed over QR / NFC is:

```
voucher_blob (148 bytes) = voucher_message (84 bytes) || ed25519_signature (64 bytes)
```

Base64-encode this blob for QR display.

**Build the message (TypeScript):**
```typescript
function buildVoucherMessage(
  escrow: PublicKey,
  nonce: BN,
  payee: PublicKey,
  amount: BN,
): Buffer {
  return Buffer.concat([
    Buffer.from("MORA"),          // 4 bytes
    escrow.toBuffer(),            // 32 bytes
    nonce.toArrayLike(Buffer, "le", 8),  // 8 bytes
    payee.toBuffer(),             // 32 bytes
    amount.toArrayLike(Buffer, "le", 8), // 8 bytes
  ]); // total: 84 bytes
}
```

**Sign offline (no network call):**
```typescript
import nacl from "tweetnacl";

const message = buildVoucherMessage(escrow, nonce, payee, amount);
const signature = nacl.sign.detached(message, walletKeypair.secretKey);
const blob = Buffer.concat([message, Buffer.from(signature)]).toString("base64");
```

**CLI (offline — no RPC call):**
```bash
mora voucher   --escrow <escrow-pda>   --nonce 1   --to <payee-pubkey>   --amount 0.05   --qr
# Prints JSON + QR code. No network required.
```

---

## Settlement Transaction

Settlement requires two instructions in a single transaction:

```
Instruction 0: Ed25519Program.createInstructionWithPublicKey(
  publicKey: escrow.authority,
  message:   voucher_message (84 bytes),
  signature: ed25519_signature (64 bytes),
)

Instruction 1: mora.settle(
  nonce:  <nonce from voucher>,
  amount: <amount from voucher>,
  accounts: { submitter, escrow, payee, receipt, ix_sysvar, system_program }
)
```

The `settle` instruction reads instruction 0 from `SYSVAR_INSTRUCTIONS_PUBKEY`
and verifies that:
- The signer matches `escrow.authority`
- The message matches `build_voucher_msg(escrow, nonce, payee, amount)`

**CLI:**
```bash
mora settle --voucher <base64-blob>
# Output: { "tx": "...", "receipt": "<PDA>", ... }
```

---

## Relay Integration

A relay watches for settled MORA vouchers and routes the payment through
Cloak → GrayBox. The relay is the `submitter` in the settle transaction.

**Integration point (`mora-relay.ts`):**

```typescript
// 1. Parse incoming voucher blob
const blob = Buffer.from(voucherB64, "base64");
const message   = blob.subarray(0, 84);
const signature = blob.subarray(84);

const escrow = new PublicKey(message.subarray(4, 36));
const nonce  = new BN(message.subarray(36, 44), "le");
const payee  = new PublicKey(message.subarray(44, 76));
const amount = new BN(message.subarray(76, 84), "le");

// 2. Submit Ed25519 + settle in one TX
const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
  publicKey: escrowAuthority.toBytes(),
  message,
  signature,
});
const settleIx = await program.methods
  .settle(nonce, amount)
  .accounts({ submitter, escrow, payee, receipt, ixSysvar, systemProgram })
  .instruction();

const sig = await provider.sendAndConfirm(
  new Transaction().add(ed25519Ix).add(settleIx)
);

// 3. Route settled SOL through Cloak → GrayBox stealth address
// See: docs/cloak-integration.md — POST /v1/mora-private-settle
```

---

## Error Reference

| Code | Name | Condition |
|------|------|-----------|
| `ZeroAmount` | Amount must be > 0 | `amount == 0` |
| `InvalidExpiry` | `expires_at` must be in the future | `expires_at <= now` |
| `Expired` | Escrow expired | `now >= escrow.expires_at` |
| `NotExpired` | Escrow not yet expired | `now < escrow.expires_at` on `close_escrow` |
| `InsufficientFunds` | Not enough remaining balance | `amount > escrow.amount - escrow.spent` |
| `SelfPayment` | Payee equals authority | `payee == escrow.authority` |
| `Ed25519IxMissing` | Ed25519 ix not at index `current - 1` | Missing verify ix |
| `WrongVerifyProgram` | Preceding ix is not Ed25519 program | Wrong program |
| `SignerMismatch` | Ed25519 signer ≠ `escrow.authority` | Wrong key |
| `MsgMismatch` | Voucher message does not match | Tampered voucher |

---

## Cloak + GrayBox Integration

After MORA settlement, the relay forwards the payment through the full
privacy stack:

```
MORA settle (devnet) → relay receives SOL
    ↓
Cloak transact()     → deposit into shielded UTXO pool (mainnet)
    ↓
Cloak fullWithdraw() → withdraw to GrayBox stealth address
    ↓
On-chain: ZK proof only
```

See [`docs/cloak-integration.md`](cloak-integration.md) for the full API
and SDK walkthrough.

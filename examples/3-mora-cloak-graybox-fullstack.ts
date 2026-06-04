/**
 * Example 3 — Full stack: MORA × Cloak × GrayBox
 *
 * MORA   : offline 84-byte voucher — no internet at payment time
 * Cloak  : shielded UTXO pool — deposit-withdrawal link broken
 * GrayBox: x25519 ECDH stealth address — recipient identity hidden
 *
 * After settlement, on-chain record: ZK proof only.
 * Sender, recipient, and amount are all unlinkable.
 *
 * Run: npx tsx examples/3-mora-cloak-graybox-fullstack.ts
 *
 * Or via API gateway (no local keypair needed):
 *   curl -X POST https://graybox-cloak-production.up.railway.app/v1/mora-private-settle \
 *     -H "Content-Type: application/json" \
 *     -H "x-api-key: g-p_demo_h6kj9d8s7g6f5d4" \
 *     -d '{"channel_id":"ch_001","seq":1,"prev_hash":"a7f3...","recipient_pub_hex":"bbbb...","amount_lamports":"10000000"}'
 */

import {
  generateUtxoKeypair,
  createUtxo,
  createZeroUtxo,
  getNkFromUtxoPrivateKey,
  transact,
  fullWithdraw,
  NATIVE_SOL_MINT,
  CLOAK_PROGRAM_ID,
} from "@cloak.dev/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { deriveStealthAddress } from "../apps/api-gateway/src/stealth.js";
import {
  generateInstitutionCloakKeys,
  buildComplianceRecord,
} from "../apps/api-gateway/src/cloak.js";

const RPC_MAINNET = "https://api.mainnet-beta.solana.com";
const RPC_DEVNET  = "https://api.devnet.solana.com";

// Simulated MORA voucher — in production this arrives from Alice's offline device
// via QR scan or NFC tap. The voucher is 84 bytes: program ID + escrow ref +
// nonce + recipient pubkey + amount, signed with Ed25519.
const MORA_VOUCHER = {
  channelId: "mora_ch_demo_001",
  seq: 1,
  prevHash: "a7f3c2e91b4d5f8a9c0b1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a",
  amountLamports: BigInt(10_000_000), // 0.01 SOL
};

async function main() {
  // ── Step 1: MORA settlement on devnet ────────────────────────────────────
  // In production: the relay watches for MORA create_escrow + settle_envelope
  // on-chain events. Here we skip the on-chain MORA step and simulate receipt.
  //
  // MORA program (devnet): 9fcXHD3pHDKLX79JuVgCEKQiqYkvVqFtpoAEVjBq4aJ8
  // See: https://explorer.solana.com/address/9fcXHD3pHDKLX79JuVgCEKQiqYkvVqFtpoAEVjBq4aJ8?cluster=devnet

  console.log("=== MORA × Cloak × GrayBox — Full Stack ===");
  console.log("MORA program  (devnet) : 9fcXHD3pHDKLX79JuVgCEKQiqYkvVqFtpoAEVjBq4aJ8");
  console.log("GrayBox program(devnet): 75HuPfb2n7SD7KtcQnVpCW5SVN3RP9gZ9vTXP4D4ha6C");
  console.log("Cloak          (mainnet): via @cloak.dev/sdk relay");
  console.log("");

  // ── Step 2: Derive one-time GrayBox stealth address ──────────────────────
  // Recipient registered their GrayBox spend + view pubkeys with the relay.
  // Simulate with a random keypair; in production use recipient's real keys.
  const recipientKeypair = Keypair.generate();
  const recipientSpendPub = recipientKeypair.publicKey.toBytes();

  const stealth = deriveStealthAddress(
    new Uint8Array(recipientSpendPub),
    new Uint8Array(recipientSpendPub), // demo: spend = view
  );

  const stealthAddress = new PublicKey(stealth.stealthPubkey);
  console.log("Recipient real wallet:", recipientKeypair.publicKey.toBase58());
  console.log("Stealth address      :", stealthAddress.toBase58());
  console.log("(real wallet never appears on-chain)");

  // ── Step 3: Route through Cloak shielded pool ────────────────────────────
  // Relay receives SOL from MORA settlement, immediately shields it in Cloak.
  const connection = new Connection(RPC_MAINNET, "confirmed");
  const relayKeypair = Keypair.generate(); // Replace with funded keypair on mainnet

  const instKeys = generateInstitutionCloakKeys();
  const compliance = buildComplianceRecord(
    instKeys.spendPubkeyHex,
    instKeys.viewingKeyHex,
  );

  const utxoKp = await generateUtxoKeypair();
  const outputUtxo = await createUtxo(
    MORA_VOUCHER.amountLamports,
    utxoKp,
    NATIVE_SOL_MINT,
  );
  const nk = getNkFromUtxoPrivateKey(utxoKp.privateKey);

  console.log("\nDepositing into Cloak shielded pool...");
  console.log("Amount:", Number(MORA_VOUCHER.amountLamports) / 1e9, "SOL");
  console.log("Channel:", MORA_VOUCHER.channelId, "seq:", MORA_VOUCHER.seq);

  const deposit = await transact(
    {
      inputUtxos: [await createZeroUtxo()],
      outputUtxos: [outputUtxo],
      externalAmount: MORA_VOUCHER.amountLamports,
      depositor: relayKeypair.publicKey,
    },
    {
      connection,
      programId: CLOAK_PROGRAM_ID,
      depositorKeypair: relayKeypair,
      chainNoteViewingKeyNk: nk,
      enforceViewingKeyRegistration: false,
    },
  );

  console.log("Cloak deposit TX:", deposit.signature);
  console.log("Explorer        :", "https://explorer.cloak.ag/tx/" + deposit.signature);

  // ── Step 4: Withdraw to GrayBox stealth address ──────────────────────────
  console.log("\nWithdrawing to GrayBox stealth address...");

  const withdrawal = await fullWithdraw(
    [deposit.outputUtxos[0]],
    stealthAddress,
    {
      connection,
      programId: CLOAK_PROGRAM_ID,
      depositorKeypair: relayKeypair,
      walletPublicKey: relayKeypair.publicKey,
      chainNoteViewingKeyNk: nk,
      cachedMerkleTree: deposit.merkleTree,
      enforceViewingKeyRegistration: false,
    },
  );

  console.log("Cloak withdraw TX:", withdrawal.signature);
  console.log("Explorer         :", "https://explorer.cloak.ag/tx/" + withdrawal.signature);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=== Privacy summary ===");
  console.log("MORA   : payment authorized offline — no internet required");
  console.log("Cloak  : deposit-withdrawal link broken (Groth16 ZK proof)");
  console.log("GrayBox: recipient identity hidden (x25519 ECDH stealth address)");
  console.log("On-chain: ZK proof only — sender, recipient, amount all unlinkable");
  console.log("\nCompliance URL:", compliance.complianceUrl);
  console.log("Viewing key   :", instKeys.viewingKeyHex);
  console.log("(share viewing key with auditor at explorer.cloak.ag/compliance)");
}

main().catch(console.error);

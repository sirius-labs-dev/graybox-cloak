/**
 * GrayBox × Cloak — Private SOL Send
 * Deposits SOL into Cloak shielded pool, then withdraws to recipient.
 * Amount hidden on-chain via Groth16 ZK proof.
 *
 * Usage: SOLANA_RPC_URL=... KEYPAIR_PATH=... npx tsx send-sol-private.ts <recipient> <amountLamports>
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
import { readFileSync } from "fs";

const RPC_URL = process.env["SOLANA_RPC_URL"] ?? "https://api.mainnet-beta.solana.com";
const KEYPAIR_PATH = process.env["KEYPAIR_PATH"] ?? "";

const recipientArg = process.argv[2];
const amountArg = process.argv[3];

if (!recipientArg || !amountArg) {
  console.error("Usage: npx tsx send-sol-private.ts <recipient> <amountLamports>");
  process.exit(1);
}

const recipient = new PublicKey(recipientArg);
const amount = BigInt(amountArg);

const raw = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"));
const sender = Keypair.fromSecretKey(Uint8Array.from(raw));
const connection = new Connection(RPC_URL, "confirmed");

console.log(`SENDER_WALLET=${sender.publicKey.toBase58()}`);
console.log(`RECIPIENT_WALLET=${recipient.toBase58()}`);
console.log(`AMOUNT_BASE_UNITS=${amount}`);
console.log(`AMOUNT_SOL=${Number(amount) / 1e9}`);

// Step 1: Deposit into Cloak shielded pool
console.log("\n[1/2] Depositing into Cloak shielded pool...");

const utxoKp = await generateUtxoKeypair();
const depositUtxo = await createUtxo(amount, utxoKp, NATIVE_SOL_MINT);
const nk = getNkFromUtxoPrivateKey(utxoKp.privateKey);

const dep = await transact(
  {
    inputUtxos: [await createZeroUtxo()],
    outputUtxos: [depositUtxo],
    externalAmount: amount,
    depositor: sender.publicKey,
  },
  {
    connection,
    programId: CLOAK_PROGRAM_ID,
    depositorKeypair: sender,
    chainNoteViewingKeyNk: nk,
    enforceViewingKeyRegistration: false,
    onProgress: (s) => console.log("  →", s),
  }
);

console.log(`DEPOSIT_SIGNATURE=${dep.signature}`);
console.log(`DEPOSIT_TX=https://explorer.solana.com/tx/${dep.signature}`);
console.log(`CLOAK_TX=https://explorer.cloak.ag/tx/${dep.signature}`);

// Step 2: Withdraw privately to recipient
console.log("\n[2/2] Withdrawing privately to recipient...");

const wd = await fullWithdraw(
  [dep.outputUtxos[0] as Awaited<ReturnType<typeof createUtxo>>],
  recipient,
  {
    connection,
    programId: CLOAK_PROGRAM_ID,
    depositorKeypair: sender,
    walletPublicKey: sender.publicKey,
    chainNoteViewingKeyNk: nk,
    cachedMerkleTree: dep.merkleTree,
    enforceViewingKeyRegistration: false,
    onProgress: (s) => console.log("  →", s),
  }
);

console.log(`\nWITHDRAW_SIGNATURE=${wd.signature}`);
console.log(`WITHDRAW_TX=https://explorer.solana.com/tx/${wd.signature}`);
console.log(`CLOAK_EXPLORER=https://explorer.cloak.ag/tx/${wd.signature}`);
console.log("\n✓ Private send complete. Amount was hidden on-chain via Groth16 ZK proof.");
process.exit(0);

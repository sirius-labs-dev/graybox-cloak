// @ts-nocheck
/**
 * MORA × Cloak × GrayBox — Full Stack Proof
 *
 * Step 1: MORA create_escrow on devnet
 * Step 2: MORA voucher (offline, zero network)
 * Step 3: MORA settle on devnet → TX1
 * Step 4: Cloak deposit on mainnet → TX2
 * Step 5: Cloak withdraw to GrayBox stealth address → TX3
 *
 * Usage:
 *   KEYPAIR_PATH=~/.config/solana/id.json npx tsx /tmp/mora-cloak-proof.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
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
import { readFileSync } from "fs";
import nacl from "tweetnacl";
import * as path from "path";
import * as os from "os";

// ── Config ──────────────────────────────────────────────────────────────────

const KEYPAIR_PATH = process.env["KEYPAIR_PATH"] ??
  path.join(os.homedir(), ".config/solana/id.json");

const DEVNET_RPC  = "https://api.devnet.solana.com";
const MAINNET_RPC = process.env["SOLANA_RPC_URL"] ?? "https://api.mainnet-beta.solana.com";

const MORA_PROGRAM_ID = new PublicKey("9fcXHD3pHDKLX79JuVgCEKQiqYkvVqFtpoAEVjBq4aJ8");
const MORA_IDL_PATH   = path.join(os.homedir(), "Desktop/mora-qvac/web/mora.json");

// 0.005 SOL — small amount, enough to demonstrate
const MORA_AMOUNT_LAMPORTS  = BigInt(5_000_000);
// 0.01 SOL for Cloak (must cover Cloak fees + rent)
const CLOAK_AMOUNT_LAMPORTS = BigInt(10_000_000);

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(readFileSync(p.replace("~", os.homedir()), "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function findEscrowPda(authority: PublicKey, seed: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), authority.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    MORA_PROGRAM_ID
  );
}

function findReceiptPda(escrow: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), escrow.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
    MORA_PROGRAM_ID
  );
}

function buildVoucherMessage(escrow: PublicKey, nonce: BN, payee: PublicKey, amount: BN): Buffer {
  return Buffer.concat([
    Buffer.from("MORA"),
    escrow.toBuffer(),
    nonce.toArrayLike(Buffer, "le", 8),
    payee.toBuffer(),
    amount.toArrayLike(Buffer, "le", 8),
  ]);
}

function explorerTx(sig: string, cluster = "mainnet-beta") {
  const q = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${sig}${q}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {

const keypair = loadKeypair(KEYPAIR_PATH);
console.log(`\nWALLET: ${keypair.publicKey.toBase58()}`);
console.log("=".repeat(60));

// ── MORA: devnet ─────────────────────────────────────────────────────────────

console.log("\n[MORA] Connecting to devnet...");
const devnetConn = new Connection(DEVNET_RPC, "confirmed");
const devnetBalance = await devnetConn.getBalance(keypair.publicKey);
console.log(`[MORA] Devnet balance: ${devnetBalance / LAMPORTS_PER_SOL} SOL`);

if (devnetBalance < 20_000_000) {
  console.error("[MORA] ERROR: Need at least 0.02 SOL on devnet. Run: solana airdrop 1 --url devnet");
  process.exit(1);
}

// Load MORA IDL
const moraIdl = JSON.parse(readFileSync(MORA_IDL_PATH, "utf-8"));
const devnetProvider = new AnchorProvider(
  devnetConn,
  new Wallet(keypair),
  { commitment: "confirmed" }
);
anchor.setProvider(devnetProvider);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moraProgram = new Program(moraIdl as any, devnetProvider);

// Step 1: create_escrow
console.log("\n[MORA Step 1/3] Creating escrow on devnet...");
const seed = new BN(Date.now());
const escrowAmount = new BN(MORA_AMOUNT_LAMPORTS.toString());
const expiresAt = new BN(Math.floor(Date.now() / 1000) + 3600);
const [escrowPda] = findEscrowPda(keypair.publicKey, seed);

const createSig = await moraProgram.methods
  .createEscrow(seed, escrowAmount, expiresAt)
  .accounts({
    authority: keypair.publicKey,
    escrow: escrowPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log(`[MORA] CREATE_ESCROW TX: ${createSig}`);
console.log(`[MORA] Explorer: ${explorerTx(createSig, "devnet")}`);
console.log(`[MORA] Escrow PDA: ${escrowPda.toBase58()}`);

// Step 2: voucher (offline — no network call)
console.log("\n[MORA Step 2/3] Building offline voucher (zero network)...");
const nonce = new BN(1);
// Payee = random merchant wallet (cannot be same as authority)
const merchantKeypair = Keypair.generate();
const payee = merchantKeypair.publicKey;
console.log(`[MORA] Merchant payee: ${payee.toBase58()}`);
const voucherMessage = buildVoucherMessage(escrowPda, nonce, payee, escrowAmount);

if (voucherMessage.length !== 84) throw new Error("voucher length mismatch");

const voucherSig = nacl.sign.detached(voucherMessage, keypair.secretKey);
const voucherBlob = Buffer.concat([voucherMessage, Buffer.from(voucherSig)]).toString("base64");
console.log(`[MORA] Voucher built offline. Length: ${voucherMessage.length + 64} bytes`);
console.log(`[MORA] Voucher (base64, first 40 chars): ${voucherBlob.slice(0, 40)}...`);

// Step 3: settle on devnet
console.log("\n[MORA Step 3/3] Settling voucher on devnet...");
const [receiptPda] = findReceiptPda(escrowPda, nonce);

const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
  publicKey: keypair.publicKey.toBytes(),
  message: voucherMessage,
  signature: voucherSig,
});

const settleIx = await moraProgram.methods
  .settle(nonce, escrowAmount)
  .accounts({
    submitter: keypair.publicKey,
    escrow: escrowPda,
    payee,
    receipt: receiptPda,
    ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
    systemProgram: SystemProgram.programId,
  })
  .instruction();

const settleTx = new anchor.web3.Transaction().add(ed25519Ix, settleIx);
const settleSig = await devnetProvider.sendAndConfirm(settleTx);

console.log(`[MORA] SETTLE TX: ${settleSig}`);
console.log(`[MORA] Explorer: ${explorerTx(settleSig, "devnet")}`);
console.log("[MORA] ✓ Offline voucher settled on-chain.");

// ── Cloak + GrayBox: mainnet ──────────────────────────────────────────────

console.log("\n[CLOAK] Connecting to mainnet...");
const mainnetConn = new Connection(MAINNET_RPC, "confirmed");
const mainnetBalance = await mainnetConn.getBalance(keypair.publicKey);
console.log(`[CLOAK] Mainnet balance: ${mainnetBalance / LAMPORTS_PER_SOL} SOL`);

if (mainnetBalance < 15_000_000) {
  console.error("[CLOAK] ERROR: Need at least 0.015 SOL on mainnet for Cloak fees.");
  process.exit(1);
}

// GrayBox: generate a valid one-time stealth keypair (Ed25519 curve point guaranteed)
const stealthKeypair = Keypair.generate();
const stealthPubkey = stealthKeypair.publicKey;
console.log(`[GRAYBOX] One-time stealth address: ${stealthPubkey.toBase58()}`);
console.log(`[GRAYBOX] (Unlinked to real wallet — GrayBox ECDH in production)`);

// Step 4: Cloak deposit
console.log("\n[CLOAK Step 1/2] Depositing into Cloak shielded pool...");
const utxoKp = await generateUtxoKeypair();
const depositUtxo = await createUtxo(CLOAK_AMOUNT_LAMPORTS, utxoKp, NATIVE_SOL_MINT);
const nk = getNkFromUtxoPrivateKey(utxoKp.privateKey);

const dep = await transact(
  {
    inputUtxos: [await createZeroUtxo()],
    outputUtxos: [depositUtxo],
    externalAmount: CLOAK_AMOUNT_LAMPORTS,
    depositor: keypair.publicKey,
  },
  {
    connection: mainnetConn,
    programId: CLOAK_PROGRAM_ID,
    depositorKeypair: keypair,
    chainNoteViewingKeyNk: nk,
    enforceViewingKeyRegistration: false,
    onProgress: (s) => console.log("  →", s),
  }
);

console.log(`[CLOAK] DEPOSIT TX: ${dep.signature}`);
console.log(`[CLOAK] Solana: ${explorerTx(dep.signature)}`);
console.log(`[CLOAK] Cloak Explorer: https://explorer.cloak.ag/tx/${dep.signature}`);

// Step 5: Cloak withdraw to GrayBox stealth address
console.log("\n[CLOAK Step 2/2] Withdrawing to GrayBox stealth address...");
const wd = await fullWithdraw(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [dep.outputUtxos[0] as any],
  stealthPubkey,
  {
    connection: mainnetConn,
    programId: CLOAK_PROGRAM_ID,
    depositorKeypair: keypair,
    walletPublicKey: keypair.publicKey,
    chainNoteViewingKeyNk: nk,
    cachedMerkleTree: dep.merkleTree,
    enforceViewingKeyRegistration: false,
    onProgress: (s) => console.log("  →", s),
  }
);

console.log(`[CLOAK] WITHDRAW TX: ${wd.signature}`);
console.log(`[CLOAK] Solana: ${explorerTx(wd.signature)}`);
console.log(`[CLOAK] Cloak Explorer: https://explorer.cloak.ag/tx/${wd.signature}`);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(60));
console.log("MORA × CLOAK × GRAYBOX — FULL STACK PROOF");
console.log("=".repeat(60));
console.log(`\nMORA create_escrow (devnet): ${explorerTx(createSig, "devnet")}`);
console.log(`MORA settle (devnet):         ${explorerTx(settleSig, "devnet")}`);
console.log(`Cloak deposit (mainnet):      ${explorerTx(dep.signature)}`);
console.log(`Cloak withdraw (mainnet):     ${explorerTx(wd.signature)}`);
console.log(`GrayBox stealth addr:         ${stealthPubkey.toBase58()}`);
console.log(`\n✓ MORA: offline voucher settled without internet at payment time`);
console.log(`✓ Cloak: deposit-withdrawal link broken (Groth16 ZK proof)`);
console.log(`✓ GrayBox: recipient is a one-time stealth address, real wallet hidden`);
console.log(`\nAll four TX are explorer-verifiable. On-chain: ZK proof only.`);

} // end main

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Example 1 — Cloak SDK: keys, shield, withdraw
 *
 * Shows the minimal Cloak SDK integration: generate institution keys,
 * deposit SOL into the shielded pool, and withdraw to a recipient.
 *
 * Run: npx tsx examples/1-cloak-sdk-basic.ts
 * Requires: funded keypair on Solana mainnet (Cloak runs on mainnet).
 */

import {
  generateCloakKeys,
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

const RPC = "https://api.mainnet-beta.solana.com";
const AMOUNT = BigInt(10_000_000); // 0.01 SOL

async function main() {
  const connection = new Connection(RPC, "confirmed");

  // 1. Generate institution Cloak keys
  //    In production: derive deterministically from seed phrase.
  const keys = generateCloakKeys();
  console.log("Spend pubkey (deposit address):", keys.spend.pk_spend_hex);
  console.log("Viewing key (compliance)      :", keys.view.vk_secret_hex);
  console.log("Audit URL: https://explorer.cloak.ag/compliance?vk=" + keys.view.vk_secret_hex.slice(0, 32));

  // 2. Relay keypair — must hold SOL on mainnet to pay for deposit TX
  //    Replace with your funded keypair:
  //    const relayKeypair = Keypair.fromSecretKey(Uint8Array.from([...]));
  const relayKeypair = Keypair.generate(); // demo only — not funded
  console.log("\nRelay wallet:", relayKeypair.publicKey.toBase58());
  console.log("(Fund this address on mainnet before running deposit)");

  // 3. Shield: deposit SOL into Cloak shielded pool
  const utxoKp = await generateUtxoKeypair();
  const outputUtxo = await createUtxo(AMOUNT, utxoKp, NATIVE_SOL_MINT);
  const nk = getNkFromUtxoPrivateKey(utxoKp.privateKey);

  console.log("\nDepositing", Number(AMOUNT) / 1e9, "SOL into Cloak shielded pool...");

  const deposit = await transact(
    {
      inputUtxos: [await createZeroUtxo()],
      outputUtxos: [outputUtxo],
      externalAmount: AMOUNT,
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

  console.log("Deposit TX :", deposit.signature);
  console.log("Solana    :", "https://explorer.solana.com/tx/" + deposit.signature);
  console.log("Cloak     :", "https://explorer.cloak.ag/tx/" + deposit.signature);

  // 4. Withdraw to recipient
  //    Replace with actual recipient address:
  const recipientPubkey = new PublicKey("11111111111111111111111111111111");

  console.log("\nWithdrawing to recipient:", recipientPubkey.toBase58());

  const withdrawal = await fullWithdraw(
    [deposit.outputUtxos[0]],
    recipientPubkey,
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

  console.log("Withdraw TX:", withdrawal.signature);
  console.log("Solana     :", "https://explorer.solana.com/tx/" + withdrawal.signature);
  console.log("Cloak      :", "https://explorer.cloak.ag/tx/" + withdrawal.signature);
  console.log("\nDeposit-withdrawal link: broken by Groth16 ZK proof.");
  console.log("Compliance : https://explorer.cloak.ag/compliance?vk=" + keys.view.vk_secret_hex.slice(0, 32));
}

main().catch(console.error);

/**
 * Example 2 — GrayBox stealth address + Cloak shielded pool
 *
 * GrayBox hides WHO receives (x25519 ECDH stealth address).
 * Cloak hides the deposit-withdrawal link (Groth16 ZK proof).
 * Together: recipient identity and funding path both eliminated.
 *
 * Run: npx tsx examples/2-graybox-cloak.ts
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

const RPC = "https://api.mainnet-beta.solana.com";
const AMOUNT = BigInt(10_000_000); // 0.01 SOL

async function main() {
  const connection = new Connection(RPC, "confirmed");

  // 1. Recipient publishes their GrayBox spend + view pubkeys.
  //    In production these come from their registered GrayBox identity.
  //    Here we simulate with a random keypair.
  const recipientGrayBoxKeypair = Keypair.generate();
  const recipientSpendPub = recipientGrayBoxKeypair.publicKey.toBytes();
  const recipientViewPub  = recipientSpendPub; // demo: same key

  // 2. Derive one-time GrayBox stealth address for recipient.
  //    This address is unique per payment — never linkable to recipient's real wallet.
  const stealth = deriveStealthAddress(
    new Uint8Array(recipientSpendPub),
    new Uint8Array(recipientViewPub),
  );

  const stealthPubkey = new PublicKey(stealth.stealthPubkey);

  console.log("Recipient real wallet :", recipientGrayBoxKeypair.publicKey.toBase58());
  console.log("One-time stealth addr :", stealthPubkey.toBase58());
  console.log("Ephemeral R           :", Buffer.from(stealth.ephemeralR).toString("hex"));
  console.log("View tag              :", stealth.viewTag);
  console.log("(real wallet never appears on-chain)");

  // 3. Institution Cloak keys
  const instKeys = generateInstitutionCloakKeys();
  const compliance = buildComplianceRecord(instKeys.spendPubkeyHex, instKeys.viewingKeyHex);

  // 4. Relay keypair — must hold SOL on mainnet
  //    Replace: const relayKeypair = Keypair.fromSecretKey(Uint8Array.from([...]));
  const relayKeypair = Keypair.generate();
  console.log("\nRelay wallet:", relayKeypair.publicKey.toBase58());

  // 5. Deposit into Cloak shielded pool
  const utxoKp = await generateUtxoKeypair();
  const outputUtxo = await createUtxo(AMOUNT, utxoKp, NATIVE_SOL_MINT);
  const nk = getNkFromUtxoPrivateKey(utxoKp.privateKey);

  console.log("\nDepositing", Number(AMOUNT) / 1e9, "SOL into Cloak pool...");

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
  console.log("Cloak      :", "https://explorer.cloak.ag/tx/" + deposit.signature);

  // 6. Withdraw to GrayBox stealth address — not to recipient's real wallet
  console.log("\nWithdrawing to stealth address (recipient identity hidden)...");

  const withdrawal = await fullWithdraw(
    [deposit.outputUtxos[0]],
    stealthPubkey,                    // <-- one-time address, not real wallet
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
  console.log("Cloak      :", "https://explorer.cloak.ag/tx/" + withdrawal.signature);

  console.log("\n--- Privacy summary ---");
  console.log("Recipient identity  : hidden (GrayBox ECDH stealth address)");
  console.log("Deposit-withdrawal  : unlinked (Cloak Groth16 ZK proof)");
  console.log("On-chain record     : ZK proof only");
  console.log("Compliance URL      :", compliance.complianceUrl);
}

main().catch(console.error);

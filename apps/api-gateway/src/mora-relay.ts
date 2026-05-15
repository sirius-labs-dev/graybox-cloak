/**
 * MORA × Cloak × GrayBox — Private Settlement Relay
 *
 * Flow:
 *   MORA offline voucher settled on-chain
 *     → relay receives SOL
 *     → deposits into Cloak shielded pool (transact)
 *     → withdraws to recipient's GrayBox stealth address (fullWithdraw)
 *
 * What the chain sees: ZK proof only. No sender, no recipient, no amount.
 * What observers cannot see: who funded the payment, who received it.
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
import { deriveStealthAddress } from "./stealth.js";
import { generateInstitutionCloakKeys, buildComplianceRecord } from "./cloak.js";
import { bytesToHex } from "./routes.js";

export interface MoraVoucher {
  channelId: string;
  seq: number;
  prevHash: string;     // hex
  recipientPubHex: string;  // 32-byte recipient spend pubkey hex
  amountLamports: bigint;
  expiry: number;
}

export interface MoraPrivateSettleResult {
  voucher_channel_id: string;
  voucher_seq: number;
  amount_lamports: string;
  stealth_pubkey_hex: string;
  ephemeral_r_hex: string;
  deposit_signature: string;
  withdraw_signature: string;
  deposit_explorer: string;
  withdraw_explorer: string;
  cloak_deposit_explorer: string;
  cloak_withdraw_explorer: string;
  viewing_key_hex: string;
  compliance_url: string;
  privacy_stack: string[];
  privacy_note: string;
}

/**
 * Route a settled MORA voucher through Cloak → GrayBox stealth address.
 *
 * In production:
 *   - relayKeypair is the relay's funded wallet on-chain
 *   - The relay receives SOL from MORA's settle_envelope instruction
 *   - Then immediately routes it through Cloak to the recipient's stealth addr
 *
 * For demo/devnet: relayKeypair holds pre-funded SOL.
 */
export async function moraPrivateSettle(
  voucher: MoraVoucher,
  relayKeypair: Keypair,
  connection: Connection,
): Promise<MoraPrivateSettleResult> {
  // 1. Derive one-time GrayBox stealth address for recipient
  //    Recipient's spend pubkey comes from the MORA voucher.
  //    In production this is their registered GrayBox spend key.
  const recipientSpendPub = Buffer.from(voucher.recipientPubHex, "hex");
  const recipientViewPub = recipientSpendPub; // demo: same key; production: separate view key

  const stealth = deriveStealthAddress(
    new Uint8Array(recipientSpendPub),
    new Uint8Array(recipientViewPub),
  );

  const stealthPubkey = new PublicKey(stealth.stealthPubkey);

  // 2. Deposit into Cloak shielded pool
  const utxoKp = await generateUtxoKeypair();
  const depositUtxo = await createUtxo(
    voucher.amountLamports,
    utxoKp,
    NATIVE_SOL_MINT,
  );
  const nk = getNkFromUtxoPrivateKey(utxoKp.privateKey);

  const dep = await transact(
    {
      inputUtxos: [await createZeroUtxo()],
      outputUtxos: [depositUtxo],
      externalAmount: voucher.amountLamports,
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

  // 3. Withdraw to GrayBox stealth address — recipient identity hidden
  const wd = await fullWithdraw(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [dep.outputUtxos[0] as any],
    stealthPubkey,
    {
      connection,
      programId: CLOAK_PROGRAM_ID,
      depositorKeypair: relayKeypair,
      walletPublicKey: relayKeypair.publicKey,
      chainNoteViewingKeyNk: nk,
      cachedMerkleTree: dep.merkleTree,
      enforceViewingKeyRegistration: false,
    },
  );

  // 4. Build compliance record
  const instKeys = generateInstitutionCloakKeys();
  const compliance = buildComplianceRecord(
    instKeys.spendPubkeyHex,
    instKeys.viewingKeyHex,
  );

  return {
    voucher_channel_id: voucher.channelId,
    voucher_seq: voucher.seq,
    amount_lamports: voucher.amountLamports.toString(),
    stealth_pubkey_hex: bytesToHex(stealth.stealthPubkey),
    ephemeral_r_hex: bytesToHex(stealth.ephemeralR),
    deposit_signature: dep.signature,
    withdraw_signature: wd.signature,
    deposit_explorer: `https://explorer.solana.com/tx/${dep.signature}`,
    withdraw_explorer: `https://explorer.solana.com/tx/${wd.signature}`,
    cloak_deposit_explorer: `https://explorer.cloak.ag/tx/${dep.signature}`,
    cloak_withdraw_explorer: `https://explorer.cloak.ag/tx/${wd.signature}`,
    viewing_key_hex: instKeys.viewingKeyHex,
    compliance_url: compliance.complianceUrl,
    privacy_stack: ["MORA", "Cloak", "GrayBox"],
    privacy_note:
      "MORA: offline payment authorized without internet. " +
      "Cloak: deposit-withdrawal link broken via Groth16 ZK proof. " +
      "GrayBox: recipient identity hidden via ECDH stealth address. " +
      "On-chain record: ZK proof only. Sender, recipient, and amount unlinkable.",
  };
}

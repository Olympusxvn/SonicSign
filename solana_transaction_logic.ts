// lib/solana.ts
export async function sendSOL(
  senderPublicKey: PublicKey,
  recipientAddress: string,
  amountSOL: number,
  signTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const recipient = new PublicKey(recipientAddress);
  const lamports = amountSOL * LAMPORTS_PER_SOL;

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: senderPublicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = senderPublicKey;

  const signed = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(signature, "confirmed");

  return signature;
}

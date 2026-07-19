import { createHash } from 'node:crypto';

interface TransferIdentity {
  senderId: string;
  recipientId: string;
  amount: number;
}

interface SentTransferLedger {
  userId: string;
  counterpartyId: string | null;
  type: string;
  amount: number;
}

export function transferLedgerKeys(
  senderId: string,
  recipientId: string,
  requestKey: string,
) {
  const requestDigest = createHash('sha256').update(requestKey, 'utf8').digest('hex');
  return {
    sent: `transfer:sent:${senderId}:${requestKey}`,
    received: `transfer:received:${recipientId}:${senderId}:${requestDigest}`,
  };
}

export function matchesSentTransferReplay(
  ledger: SentTransferLedger,
  expected: TransferIdentity,
) {
  return (
    ledger.type === 'TRANSFER_SENT' &&
    ledger.userId === expected.senderId &&
    ledger.counterpartyId === expected.recipientId &&
    ledger.amount === -expected.amount
  );
}

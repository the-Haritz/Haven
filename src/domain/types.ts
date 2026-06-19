// Enums and interfaces representing our core data structures.
// Keeps things typed so we avoid bugs from mistyped strings.

// ─── Ledger ──────────────────────────────────────────────────────────

export enum LedgerType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
}

export enum LedgerStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// ─── On-Chain Transactions ───────────────────────────────────────────

export enum TransactionType {
  WITHDRAWAL = 'WITHDRAWAL',
  SWEEP = 'SWEEP',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  MINED = 'MINED',
  FAILED = 'FAILED',
}

// ─── API Request/Response Shapes ─────────────────────────────────────

export interface CreateUserRequest {
  email: string;
}

export interface WithdrawRequest {
  userId: string;
  amount: string; // Wei as string to avoid JS float precision issues
  toAddress: string;
}

export interface DepositWebhookPayload {
  event: {
    activity: Array<{
      toAddress: string;
      value: string;
      hash: string;
    }>;
  };
}

export interface BalanceResponse {
  userId: string;
  balance: string;
}

export interface WithdrawalResponse {
  status: string;
  message: string;
  txHash: string;
  explorerUrl: string;
}

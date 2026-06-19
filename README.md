# Haven: Crypto-to-Fiat MVP Backend

This repository contains the backend MVP for Haven, a crypto-to-fiat platform designed to manage user deposits, track internal balances, sweep funds to a hot wallet, and process external withdrawals.

Built with **Node.js, TypeScript, Express, Prisma (SQLite), and Viem**.

## Architecture & Core Flows

This system bridges the gap between off-chain database state and on-chain EVM realities.

### 1. Key Management (HD Wallets)
We do **not** store private keys in the database.
When a user is created, we use a single `MASTER_MNEMONIC` (seed phrase) and derive an address using an incrementing index (e.g., `m/44'/60'/0'/0/1`). We only store that public `derivationIndex` in SQLite. Private keys are derived temporarily in memory only when a transaction must be signed.

### 2. Deposit Tracking (Webhooks)
To avoid the intense compute required to poll every block or manage a custom RPC indexer, we use a **Webhook Architecture** (simulating an Alchemy Notify setup).
*   The infrastructure provider watches our derived addresses.
*   When a user deposits native ETH, the provider POSTs to `/webhooks/deposits`.
*   We verify the payload, perform an idempotency check against the `txHash` to prevent double-counting, and update the user's internal `Ledger`.

### 3. Internal Accounting
All financial amounts in the database are stored as **Strings**.
Standard database integers and JS Floats cannot safely handle 256-bit wei values (18 decimals). By storing strings, we can pull them into the Node.js runtime and use native `BigInt` for precise, lossless addition and subtraction when calculating user balances.

**Available Balance:** When calculating a user's balance, we subtract both `COMPLETED` and `PENDING` withdrawals. This prevents double-spend race conditions — funds are locked the moment a withdrawal intent is created, not when it's confirmed on-chain.

### 4. The Sweeper Worker
User funds cannot sit idle in scattered addresses. `src/workers/sweeper.ts` is a background worker that consolidates funds.
*   For the MVP, we strictly support **Native ETH**. This avoids the complex "gas funding" retry queues required to sweep ERC-20 tokens.
*   The sweeper checks the on-chain balance, dynamically calculates EIP-1559 gas costs (`21,000 * maxFeePerGas`), subtracts the gas from the balance, and sweeps the remainder to a central `HOT_WALLET_ADDRESS`.

### 5. Withdrawal Flow & Nonce Management
When a user withdraws (`POST /withdraw`), we use the Hot Wallet to send funds.
*   **State Locking:** We immediately create a `PENDING` withdrawal in the internal ledger *before* broadcasting. This locks the funds and prevents double-spend race conditions.
*   **Nonce Mutex:** We use an in-memory `Mutex` lock to process concurrent withdrawal requests sequentially. This ensures the Hot Wallet accurately increments its nonce, preventing dropped transactions.
*   **UX:** We return a `202 Accepted` status with the Block Explorer URL immediately after the tx hits the mempool, shifting the tracking burden to the explorer.

### 6. Error Handling & Logging
*   **Custom Error Hierarchy:** `AppError` base class with typed subclasses (`ValidationError`, `NotFoundError`, `InsufficientFundsError`, `BlockchainError`) — each carries its own HTTP status code.
*   **Structured Logging:** Winston with contextual metadata (userId, txHash, amounts). JSON format in production for log aggregators, colorized text in development.
*   **Input Validation:** Ethereum address validation via Viem's `isAddress()`, BigInt amount parsing, email format checks.

## Project Structure

```
src/
├── api/
│   ├── routes.ts          # Thin controller — validates input, delegates to services
│   └── middleware.ts       # Error handler, request logger, address validator
├── domain/
│   ├── types.ts            # Enums & interfaces — the shared language
│   └── errors.ts           # Custom error hierarchy (AppError, ValidationError, etc.)
├── infrastructure/
│   ├── config.ts           # Centralized env config — loads dotenv, validates at startup
│   ├── db.ts               # Prisma singleton client
│   ├── hotWallet.ts        # Hot wallet client for withdrawals
│   ├── logger.ts           # Winston structured logging
│   ├── mutex.ts            # Nonce-collision prevention lock
│   └── viem.ts             # Public client for read-only blockchain queries
├── usecases/
│   ├── LedgerService.ts    # Internal accounting (balance, deposits, withdrawals)
│   ├── WalletService.ts    # HD wallet derivation (BIP-39/BIP-44)
│   └── WithdrawalService.ts # Full withdrawal orchestration
├── workers/
│   └── sweeper.ts          # Fund consolidation worker
└── server.ts               # Express app entry point
```

## API Reference

| Method | Endpoint | Description | Status Codes |
|--------|----------|-------------|--------------|
| `GET` | `/api/health` | Health check | `200` |
| `POST` | `/api/users` | Create user + generate deposit wallet | `201`, `400` |
| `GET` | `/api/users/:id/balance` | Get user's available balance | `200`, `404` |
| `GET` | `/api/users/:id/transactions` | Get user's ledger history | `200`, `404` |
| `POST` | `/api/webhooks/deposits` | Receive deposit notifications | `200`, `500` |
| `POST` | `/api/withdraw` | Initiate withdrawal to external address | `202`, `400`, `404`, `502` |

## Setup & Execution

### Prerequisites
*   Node.js (v18+)
*   npm or yarn

### Installation
```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Copy environment variables
cp .env.example .env
```

### Running the Server
```bash
npm run dev
```

### Running the Sweeper
```bash
# In a separate terminal
npx ts-node src/workers/sweeper.ts
```

## How to Test (curl examples)

### 1. Create a User
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com"}'
```
**Response (201):**
```json
{
  "user": { "id": "uuid-here", "email": "alice@example.com" },
  "wallet": { "id": "uuid", "address": "0x...", "derivationIndex": 0 }
}
```

### 2. Simulate a Deposit (Webhook)
```bash
curl -X POST http://localhost:3000/api/webhooks/deposits \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "activity": [{
        "toAddress": "0x_USER_WALLET_ADDRESS_HERE",
        "value": "1000000000000000000",
        "hash": "0xabc123..."
      }]
    }
  }'
```

### 3. Check Balance
```bash
curl http://localhost:3000/api/users/USER_ID_HERE/balance
```
**Response (200):**
```json
{
  "userId": "uuid-here",
  "balance": "1000000000000000000"
}
```

### 4. View Transaction History
```bash
curl http://localhost:3000/api/users/USER_ID_HERE/transactions
```

### 5. Withdraw Funds
```bash
curl -X POST http://localhost:3000/api/withdraw \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID_HERE",
    "amount": "500000000000000000",
    "toAddress": "0xRecipientAddressHere"
  }'
```
**Response (202):**
```json
{
  "status": "PENDING",
  "message": "Withdrawal broadcasted to network",
  "txHash": "0x...",
  "explorerUrl": "https://sepolia.basescan.org/tx/0x..."
}
```

## Environment Variables

See [`.env.example`](.env.example) for all available configuration. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTER_MNEMONIC` | ✅ (production) | BIP-39 seed phrase for HD wallet derivation |
| `HOT_WALLET_PRIVATE_KEY` | ✅ (production) | Private key for the central withdrawal wallet |
| `HOT_WALLET_ADDRESS` | ✅ (production) | Public address of the hot wallet |
| `RPC_URL` | Recommended | Alchemy/Infura RPC endpoint (defaults to public Base Sepolia) |
| `DATABASE_URL` | ✅ | Prisma database connection string |
| `NODE_ENV` | Recommended | `development` or `production` |
| `LOG_LEVEL` | Optional | Winston log level (default: `info`) |

## Security Considerations

**What's implemented:**
- HD Wallet derivation — private keys never stored, derived in memory only when needed
- Input validation on all API endpoints (address format, amount parsing, email)
- State-locking to prevent double-spend on concurrent withdrawals
- Idempotency checks on deposit webhooks (prevent double-counting)
- Centralized config with production-mode enforcement (no insecure defaults allowed)
- Security headers via Helmet

**What a production system would add:**
- Webhook signature verification (Alchemy/QuickNode HMAC)
- JWT/API key authentication on all endpoints
- Rate limiting (`express-rate-limit`)
- IP allowlisting for webhook endpoints
- HSM (Hardware Security Module) for key management instead of env vars
- KMS-encrypted mnemonic storage (AWS KMS / GCP Cloud KMS)
- Database encryption at rest
- Audit logging for all financial operations

## Future Improvements

1. **ERC-20 Token Support** — Requires solving the gas-funding problem (EOAs need ETH to approve + transfer tokens). Would migrate to CREATE2 smart contract forwarders.
2. **Transaction Confirmation Worker** — Background worker that polls for tx receipts and updates `PENDING → MINED/FAILED` in the Transaction table.
3. **Reconciliation Service** — Periodically compares on-chain state with internal ledger to catch discrepancies.
4. **CREATE2 Factory** — Deterministic smart contract deposit addresses that auto-sweep on deployment.
5. **Distributed Nonce Management** — Replace the in-memory Mutex with Redis-based locking for multi-instance deployments.
6. **Account Abstraction (ERC-4337)** — Paymasters for gas-sponsored sweeps, removing the ETH dependency.
7. **Multi-Chain Support** — Abstract the chain config to support Base, BSC, Polygon, etc.

## Further Reading
Please review `archdecisions.md` for a deeper dive into the engineering trade-offs made during this MVP, including why Account Abstraction (ERC-4337) and Permit2 were bypassed for Friday delivery.

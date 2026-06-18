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

### 4. The Sweeper Worker
User funds cannot sit idle in scattered addresses. `src/workers/sweeper.ts` is a background worker that consolidates funds.
*   For the MVP, we strictly support **Native ETH**. This avoids the complex "gas funding" retry queues required to sweep ERC-20 tokens.
*   The sweeper checks the on-chain balance, dynamically calculates EIP-1559 gas costs (`21,000 * maxFeePerGas`), subtracts the gas from the balance, and sweeps the remainder to a central `HOT_WALLET_ADDRESS`.

### 5. Withdrawal Flow & Nonce Management
When a user withdraws (`POST /withdraw`), we use the Hot Wallet to send funds.
*   **State Locking:** We immediately create a `PENDING` withdrawal in the internal ledger *before* broadcasting. This locks the funds and prevents double-spend race conditions.
*   **Nonce Mutex:** We use an in-memory `Mutex` lock to process concurrent withdrawal requests sequentially. This ensures the Hot Wallet accurately increments its nonce, preventing dropped transactions.
*   **UX:** We return a `202 Accepted` status with the Block Explorer URL immediately after the tx hits the mempool, shifting the tracking burden to the explorer.

## Setup & Execution

### Prerequisites
*   Node.js (v18+)
*   npm or yarn

### Installation
```bash
npm install
# Generate Prisma Client
npx prisma generate
# Run database migrations
npx prisma migrate dev
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

## Further Reading
Please review `archdecisions.md` for a deeper dive into the engineering trade-offs made during this MVP, including why Account Abstraction (ERC-4337) and Permit2 were bypassed for Friday delivery.

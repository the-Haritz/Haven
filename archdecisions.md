# Architectural Decisions & Notes

This document keeps track of the "why" behind the code. When building an MVP over a few days, I have to make trade-offs. I'm documenting those here so that my thought process is clear.

## 1. Storing On-Chain Amounts (Wei/Gwei) in the Database
**Decision:** I am storing token amounts (`amount` fields) as `String` in the Prisma/SQLite schema, rather than integers.
**Why:** In Solidity, I'm used to `uint256`. JavaScript's native `Number` type is a double-precision float, meaning it loses precision past `2^53 - 1`. If I try to store 18-decimal token amounts (like standard ERC20s or ETH) as a JS Number, I will silently lose user funds due to rounding errors. 
While TypeScript has a native `bigint` type, standard relational databases (especially SQLite) don't natively support 256-bit integers. 
**The workaround:** The standard industry practice is to store these massive numbers as Strings in the database. When pulling them into the Node application, I immediately parse them into native JS `bigint`s to perform safe, precise math using Viem.

## 2. Key Management Strategy (HD Wallets)
**Decision:** I am not generating or storing individual private keys for user deposit addresses in the database. Instead, I use an HD Wallet (BIP39/BIP44) to derive Externally Owned Accounts (EOAs).
**Why:** Storing hot private keys in a database is a massive security risk. 
I inject a single highly-secure Master Seed phrase via an environment variable (`MASTER_MNEMONIC`). When a user needs a deposit address, I just increment an index (e.g., `1`, `2`, `3`) and derive the address on the fly (`m/44'/60'/0'/0/x`). 
**The benefit:** I only store the public `derivationIndex` in the database. If the DB is compromised, the attacker gets nothing. When I need to sweep funds, I derive the private key temporarily in memory, sign the transaction, and let the garbage collector sweep it away.

## 3. Alternative Considered: CREATE2 Smart Contract Forwarders
**Context:** In production environments (like Binance or Coinbase), centralized exchanges rarely use EOAs for deposit addresses. Instead, they use Smart Contract Forwarders deployed deterministically via the `CREATE2` opcode.
**How it works:** A factory contract calculates the user's deposit address using their User ID as the `salt`. The user deposits funds into this empty address. Later, a central relayer calls the factory to actually deploy the contract, which immediately sweeps the funds to a cold wallet in the constructor.
**Why I didn't use it for the MVP:** While `CREATE2` solves the "gas funding" problem (where you have to send ETH to an EOA just to pay the gas to sweep an ERC20), it introduces significant complexity. It requires writing, auditing, testing, and deploying custom Solidity contracts alongside the backend. 
**Decision:** For a rapid MVP, the HD Wallet EOA approach is pragmatic. It demonstrates strong key security, backend state management, and blockchain integration skills without the overhead of maintaining parallel smart contract infrastructure. A production roadmap would immediately prioritize the migration to a `CREATE2` architecture.

## 4. Database Choice: SQLite
**Decision:** Using SQLite via Prisma for the MVP.
**Why:** It drastically reduces the friction of getting the project running. No need to spin up Docker containers or configure Postgres locally. Prisma makes it trivial to swap the `provider` to PostgreSQL later if this moves to a real production environment.

## 5. Deposit Tracking Architecture (Webhooks over Custom Indexing)
**Context:** To detect incoming deposits, the system needs to monitor the blockchain. The naive approach is polling every new block and iterating through all transactions.
**Why I didn't use block polling or RPC Log Filtering:** Polling is highly inefficient and wastes RPC compute. While RPC Log Filtering (via WebSockets or `eth_getLogs`) is better, building a custom indexer for an MVP is a massive engineering overhead. It requires handling network re-orgs, connection drops, and state recovery to ensure exact-once processing.
**Decision:** For this MVP, I am utilizing a **Webhook Architecture** (simulating a provider like Alchemy Notify or QuickNode Webhooks). The system exposes a `POST /webhooks/deposits` endpoint. We register our generated user addresses with the infrastructure provider, and they send an HTTP POST payload directly to our backend when a transfer occurs.
**Benefit:** This approach delegates the complex infrastructure of blockchain node maintenance and event filtering to a specialized third party. It provides instant notifications, automatic retries on failure (if our server returns a 500), and allows us to focus entirely on business logic (updating the internal ledger). To ensure data integrity, the webhook endpoint implements an idempotency check against the `txHash` to prevent double-counting if the provider sends the same event twice.

## 6. Ledger Balance Calculation (In-Memory BigInt Math)
**Context:** I need to expose an endpoint (`GET /users/:id/balance`) for users to view their total internal balance.
**Decision:** Instead of asking SQLite to `SUM()` the `amount` column natively, I pull all `COMPLETED` ledger entries for the user and calculate the sum using JavaScript's native `BigInt` inside a loop.
**Why:** Because I store 256-bit wei/gwei amounts as strings (see Decision 1), standard SQLite `SUM` aggregates would treat them as floats or hit overflow limits, resulting in corrupt data. Pulling the strings into the Node runtime and doing explicit `BigInt` addition/subtraction guarantees mathematical safety. For an MVP, the number of ledger entries per user is small enough that pulling them into memory is negligible. In a high-scale environment with massive ledger history, we would introduce daily/weekly "balance snapshots" to avoid summing the entire history on every read.

## 7. Propagating Prisma Transactions
**Context:** When a user is created (`POST /users`), we create both a `User` record and a `Wallet` record. We want this to be atomic—if the wallet generation fails, the user shouldn't be created.
**Decision:** We wrap the operation in `prisma.$transaction`. We explicitly pass the injected `tx` (transaction client) from the API layer down into the `WalletService.createWalletForUser` method.
**Why:** Originally, `WalletService` was hardcoded to use the global `prisma` client. Calling a service that uses the global client from inside a `$transaction` block meant the service call was executing outside the bounds of the transaction. If the transaction aborted, the wallet might still be committed. Propagating `tx` ensures the entire flow shares the same database lock/session, preventing orphaned records.

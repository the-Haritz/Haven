# Architectural Decisions & Notes

This document keeps track of the "why" behind the code. When you're building an MVP over a few days, you make trade-offs. We want to document those here so that anyone reviewing the code (or us, coming back to it later) understands the thought process.

## 1. Storing On-Chain Amounts (Wei/Gwei) in the Database
**Decision:** We are storing token amounts (`amount` fields) as `String` in the Prisma/SQLite schema, rather than integers.
**Why:** In Solidity, you're used to `uint256`. JavaScript's native `Number` type is a double-precision float, meaning it loses precision past `2^53 - 1`. If you try to store 18-decimal token amounts (like standard ERC20s or ETH) as a JS Number, you will silently lose user funds due to rounding errors. 
While TypeScript has a native `bigint` type, standard relational databases (especially SQLite) don't natively support 256-bit integers. 
**The workaround:** The standard industry practice is to store these massive numbers as Strings in the database. When we pull them into our Node application, we immediately parse them into native JS `bigint`s to perform safe, precise math using Viem.

## 2. Key Management Strategy (HD Wallets)
**Decision:** We are not generating or storing individual private keys for user deposit addresses in the database. Instead, we use an HD Wallet (BIP39/BIP44) to derive Externally Owned Accounts (EOAs).
**Why:** Storing hot private keys in a database is a massive security risk. 
We inject a single highly-secure Master Seed phrase via an environment variable (`MASTER_MNEMONIC`). When a user needs a deposit address, we just increment an index (e.g., `1`, `2`, `3`) and derive the address on the fly (`m/44'/60'/0'/0/x`). 
**The benefit:** We only store the public `derivationIndex` in the database. If the DB is compromised, the attacker gets nothing. When we need to sweep funds, we derive the private key temporarily in memory, sign the transaction, and let the garbage collector sweep it away.

## 3. Alternative Considered: CREATE2 Smart Contract Forwarders
**Context:** In production environments (like Binance or Coinbase), centralized exchanges rarely use EOAs for deposit addresses. Instead, they use Smart Contract Forwarders deployed deterministically via the `CREATE2` opcode.
**How it works:** A factory contract calculates the user's deposit address using their User ID as the `salt`. The user deposits funds into this empty address. Later, a central relayer calls the factory to actually deploy the contract, which immediately sweeps the funds to a cold wallet in the constructor.
**Why we didn't use it for the MVP:** While `CREATE2` solves the "gas funding" problem (where you have to send ETH to an EOA just to pay the gas to sweep an ERC20), it introduces significant complexity. It requires writing, auditing, testing, and deploying custom Solidity contracts alongside the backend. 
**Decision:** For a rapid MVP, the HD Wallet EOA approach is pragmatic. It demonstrates strong key security, backend state management, and blockchain integration skills without the overhead of maintaining parallel smart contract infrastructure. A production roadmap would immediately prioritize the migration to a `CREATE2` architecture.

## 4. Database Choice: SQLite
**Decision:** Using SQLite via Prisma for the MVP.
**Why:** It drastically reduces the friction of getting the project running. No need to spin up Docker containers or configure Postgres locally. Prisma makes it trivial to swap the `provider` to PostgreSQL later if this moves to a real production environment.

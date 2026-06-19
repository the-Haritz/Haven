// Custom error classes for clean API responses.
// We tag errors with 'isOperational' to distinguish between expected issues
// (e.g. bad user inputs, insufficient balances) and unexpected database crashes/bugs.
// Operational errors are safe to return to clients, while unexpected errors get masked as 500s.

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // TS boilerplate needed when extending built-in Error prototypes
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// Bad input from user (missing fields, invalid format)
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

// E.g. user or wallet not found
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404);
  }
}

// Balance too low for payout
export class InsufficientFundsError extends AppError {
  constructor() {
    super('Insufficient balance for this withdrawal', 400);
  }
}

// Blockchain node or RPC gateway error (Bad Gateway makes sense here)
export class BlockchainError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}

// E.g. webhook replayed with a hash we already recorded
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

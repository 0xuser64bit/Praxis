export class PraxisConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisConfigError";
  }
}

export class PraxisAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisAuthError";
  }
}

export class PraxisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisInputError";
  }
}

export class PraxisNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisNotFoundError";
  }
}

export class PraxisRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisRateLimitError";
  }
}

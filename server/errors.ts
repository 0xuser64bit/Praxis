export class PraxisConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisConfigError";
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

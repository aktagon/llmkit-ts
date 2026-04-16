export class APIError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "ValidationError";
  }
}

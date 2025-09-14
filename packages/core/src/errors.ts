export class BoltError extends Error {
  constructor(readonly code: string, message: string, readonly cause?: unknown) {
  super(message);
  this.name = 'BoltError';
  }
}
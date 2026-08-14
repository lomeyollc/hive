/** Thrown by auth helpers when a request should be rejected with a specific
 * HTTP status; route handlers catch this and turn it into a JSON response. */
export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Application errors carry everything a problem+json body needs, so a controller
 * never has to know the HTTP shape and the filter never has to guess the status.
 *
 * RFC 9457: `type` is a stable, machine-readable identifier — a client branches on
 * it, never on the human `title` or `detail`.
 */
export const PROBLEM_BASE = 'https://miogames.example/problems';

export type ProblemExtensions = Record<string, unknown>;

export abstract class AppError extends Error {
  abstract readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly extensions: ProblemExtensions;

  protected constructor(args: { code: string; title: string; detail: string; extensions?: ProblemExtensions }) {
    super(args.detail);
    this.name = new.target.name;
    this.type = `${PROBLEM_BASE}/${args.code}`;
    this.title = args.title;
    this.detail = args.detail;
    this.extensions = args.extensions ?? {};
  }
}

/**
 * Another tenant's resource answers 404, never 403 (ADR-0006): a 403 confirms the
 * id exists, which is itself a leak. The detail says "visible to you" rather than
 * "does not exist", because we are deliberately not saying which it is.
 */
export class NotFoundError extends AppError {
  readonly status = 404;

  constructor(resource: string, id: string) {
    super({
      code: 'not-found',
      title: 'Not found',
      detail: `No ${resource} with id ${id} is visible to you.`,
    });
  }
}

export class ConflictError extends AppError {
  readonly status = 409;

  constructor(code: string, detail: string, extensions?: ProblemExtensions) {
    super({ code, title: 'Conflict', detail, extensions });
  }
}

export class UnprocessableError extends AppError {
  readonly status = 422;

  constructor(code: string, detail: string, extensions?: ProblemExtensions) {
    super({ code, title: 'Unprocessable', detail, extensions });
  }
}

export class BadRequestError extends AppError {
  readonly status = 400;

  constructor(code: string, detail: string, extensions?: ProblemExtensions) {
    super({ code, title: 'Bad request', detail, extensions });
  }
}

export class UnauthorizedError extends AppError {
  readonly status = 401;

  constructor(code: string, detail: string, extensions?: ProblemExtensions) {
    super({ code, title: 'Unauthorized', detail, extensions });
  }
}

export class TooManyRequestsError extends AppError {
  readonly status = 429;

  constructor(code: string, detail: string, extensions?: ProblemExtensions) {
    super({ code, title: 'Too many requests', detail, extensions });
  }
}

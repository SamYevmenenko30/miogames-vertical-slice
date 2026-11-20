import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { currentTraceId, silentLogger, type Logger } from '../observability/logger';
import { AppError, PROBLEM_BASE } from './errors';

/**
 * Every error leaves as RFC 9457 problem+json.
 *
 * The unexpected case is the one that matters: a 500 carries a generic title and
 * a trace id, and NOTHING else. No stack frame, no SQL, no host, no internal id —
 * the detail goes to the log, where the trace id finds it.
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger = silentLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const traceId = currentTraceId();
    const instance = request?.originalUrl ?? request?.url ?? '';

    if (exception instanceof AppError) {
      this.send(response, exception.status, {
        type: exception.type,
        title: exception.title,
        status: exception.status,
        detail: exception.detail,
        instance,
        traceId,
        ...exception.extensions,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const detail =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);
      this.send(response, status, {
        type: `${PROBLEM_BASE}/http-${status}`,
        title: exception.name.replace(/Exception$/, ''),
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        instance,
        traceId,
      });
      return;
    }

    this.logger.error(
      { traceId, err: exception instanceof Error ? exception.stack : String(exception), instance },
      'unhandled exception',
    );
    this.send(response, 500, {
      type: `${PROBLEM_BASE}/internal`,
      title: 'Unexpected error',
      status: 500,
      detail: 'The request could not be completed. Quote the trace id when reporting this.',
      instance,
      traceId,
    });
  }

  private send(response: Response, status: number, body: Record<string, unknown>): void {
    response.status(status).setHeader('content-type', 'application/problem+json');
    response.json(body);
  }
}

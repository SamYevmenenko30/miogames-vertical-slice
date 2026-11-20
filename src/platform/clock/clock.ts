/**
 * Time is injected, so a test can decide what "now" is. Nothing in a domain ring
 * calls Date.now() — an expiry rule you cannot place in time is a rule you cannot
 * test.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(instant: Date): void {
    this.current = new Date(instant.getTime());
  }
}

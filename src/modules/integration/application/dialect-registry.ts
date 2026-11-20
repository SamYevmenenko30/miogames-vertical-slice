import type { InboundDialect } from './ports';

/**
 * Operator code → dialect. An unknown code is a configuration error, raised at
 * resolution: falling back to "the first adapter" would translate one operator's
 * events with another's rules, which is the worst available outcome.
 */
export class DialectRegistry {
  private readonly byOperator = new Map<string, InboundDialect>();

  constructor(dialects: InboundDialect[]) {
    for (const dialect of dialects) {
      if (this.byOperator.has(dialect.operator)) {
        throw new Error(`two inbound dialects claim operator ${dialect.operator}`);
      }
      this.byOperator.set(dialect.operator, dialect);
    }
  }

  forOperator(operator: string): InboundDialect {
    const dialect = this.byOperator.get(operator);
    if (!dialect) {
      throw new Error(
        `no inbound dialect is registered for operator ${operator} — onboarding an operator means adding an adapter`,
      );
    }
    return dialect;
  }

  operators(): string[] {
    return [...this.byOperator.keys()];
  }
}

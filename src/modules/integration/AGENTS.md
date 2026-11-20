# integration

The casino integration layer: the only module that knows an operator dialect exists.

## Invariants this module enforces

- A dialect lives in exactly one adapter, and the operator's **name** appears nowhere outside
  this module, the mocks and tests. `__tests__/no-operator-leak.spec.ts` greps the tree for it,
  because this is the property that makes operator #10 a one-adapter change.
- `translateDeposit` never throws. A payload that cannot be read comes back as `invalid`; an
  event we understand and do not act on comes back as `unsupported`. Collapsing those two makes
  a broken deposit look like a withdrawal and disappear.
- An event with no operator event id is **invalid**, never given a synthesised one: a synthesised
  id makes two different deposits collide and swallows one of them (MIO-003 Q1).
- Money is integer minor units plus a currency. `Money.fromDecimalString` does integer arithmetic
  on the digit string; nothing here calls `parseFloat`.
- The operator's `occurred_at` is stored as their claim and decides nothing — a rule keyed on
  operator time is manipulable by operator clock skew (MIO-003 Q2).

## Traps

- `src/mocks/casino-platform` deliberately **duplicates** both dialects instead of importing
  these adapters. A mock that shares code with the translator under test cannot catch a
  translation bug. If you change a dialect, change the mock too — and the dialect tests will
  tell you, because they assert the exact shapes.
- Every outbound adapter must classify its failure as `retryable` or `terminal`. "Unknown" is not
  an option: the retry loop in `rewards` has to decide something, and defaulting to retry on a
  terminal failure burns the attempt budget against a request that can never succeed.

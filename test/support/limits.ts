// Test-only: a limit with the same unit and protection but another value, to drive the refusal
// paths at small sizes. Kept out of src so no unit of crankpath can forge a derived limit.
import type { DerivedLimit, LimitUnit } from "../../src/u1-graph-model/limits.js";

export function withValue<U extends LimitUnit>(limit: DerivedLimit<U>, value: number, basis: string): DerivedLimit<U> {
  return Object.freeze({ ...limit, value, basis });
}

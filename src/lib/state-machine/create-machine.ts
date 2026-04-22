/**
 * Minimal state-machine factory. Encodes valid state transitions as a
 * dictionary, then exposes `canTransition` / `transition` helpers so call
 * sites cannot jump between states arbitrarily.
 *
 * A machine is a plain object of `{ fromState: Array<toState> }`. Transitions
 * not listed throw on `transition()` and return `false` on `canTransition()`.
 */

export type StateMachineDefinition<S extends string> = Readonly<{
  [K in S]?: ReadonlyArray<S>;
}>;

export interface StateMachine<S extends string> {
  readonly states: ReadonlyArray<S>;
  canTransition(from: S, to: S): boolean;
  transition(from: S, to: S): S;
  allowedFrom(from: S): ReadonlyArray<S>;
}

export function createMachine<S extends string>(
  definition: StateMachineDefinition<S>,
): StateMachine<S> {
  const states = Object.keys(definition) as S[];

  const allowedFrom = (from: S): ReadonlyArray<S> =>
    definition[from] ?? [];

  const canTransition = (from: S, to: S): boolean =>
    allowedFrom(from).includes(to);

  const transition = (from: S, to: S): S => {
    if (!canTransition(from, to)) {
      throw new Error(
        `Invalid state transition: ${from} -> ${to} (allowed: ${allowedFrom(from).join(", ") || "none"})`,
      );
    }
    return to;
  };

  return { states, canTransition, transition, allowedFrom };
}

// Helper for the stage content contract tests (design 4.3). Test files only: it imports vitest. Each stage's
// content.test.ts calls registerContract once. Cases 1 to 4 of design 4.3 are registered here. Case 5 (copy keys
// in GARDEN_COPY) comes with task 4.
import { describe, expect, it } from 'vitest';
import type { ContentResult } from './stageTypes';

/** One broken copy of the shipped content. `path` is the field the validator must name. */
export interface ContractMutation {
  readonly name: string;
  readonly path: string;
  readonly mutate: (json: Record<string, unknown>) => void;
}

export interface ContractOptions<T> {
  readonly stage: string;
  readonly validate: (json: unknown) => ContentResult<T>;
  readonly load: (json: unknown) => T;
  readonly shipped: Record<string, unknown>;
  readonly mutations: readonly ContractMutation[];
  /** Case 4 of design 4.3, for a stage that has its rule. True when the rule reaches completed. */
  readonly rule?: (content: T) => boolean;
}

interface TargetShape {
  slots: Record<string, unknown>[];
  copy: unknown;
}

const targetOf = (json: Record<string, unknown>): TargetShape => json.target as TargetShape;

/** The mutations every one-target stage must reject (design 4.3, case 2). */
export function placeholderMutations(otherStage: string): ContractMutation[] {
  return [
    {
      name: 'a missing id',
      path: 'id',
      mutate: (json) => {
        delete json.id;
      },
    },
    {
      name: 'a wrong version',
      path: 'version',
      mutate: (json) => {
        json.version = 2;
      },
    },
    {
      name: 'the id of another stage',
      path: 'id',
      mutate: (json) => {
        json.id = otherStage;
      },
    },
    {
      name: 'a non-finite coordinate',
      path: 'target.slots[0].x',
      mutate: (json) => {
        targetOf(json).slots[0] = { ...targetOf(json).slots[0], x: Number.NaN };
      },
    },
    {
      name: 'too few slots',
      path: 'target.slots',
      mutate: (json) => {
        targetOf(json).slots = [];
      },
    },
    {
      name: 'a copy key of the wrong shape',
      path: 'target.copy',
      mutate: (json) => {
        targetOf(json).copy = 'no spaces here';
      },
    },
  ];
}

/** Registers the contract cases of design 4.3 for one stage. */
export function registerContract<T>(options: ContractOptions<T>): void {
  describe(`${options.stage} content contract (design 4.3)`, () => {
    it('case 1: the shipped JSON validates', () => {
      expect(options.validate(options.shipped).ok).toBe(true);
    });

    for (const mutation of options.mutations) {
      it(`case 2: ${mutation.name} is rejected at ${mutation.path}`, () => {
        const json = structuredClone(options.shipped);
        mutation.mutate(json);
        const result = options.validate(json);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.issues.map((issue) => issue.path)).toContain(mutation.path);
      });
    }

    it('case 3: load throws with the issue text for invalid input', () => {
      const first = options.mutations[0];
      expect(first).toBeDefined();
      if (first === undefined) return;
      const json = structuredClone(options.shipped);
      first.mutate(json);
      expect(() => options.load(json)).toThrow(first.path);
    });

    if (options.rule !== undefined) {
      const rule = options.rule;
      it('case 4: the stage rule runs from the content and reaches completed', () => {
        expect(rule(options.load(options.shipped))).toBe(true);
      });
    }
  });
}

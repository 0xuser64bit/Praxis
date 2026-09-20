import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { fireDueSchedulesForAllWallets } from "../scheduleRunner";
import { resetStateRepositoryForTests, type StateRepository } from "../../provider/stateRepository";

import { randomAddress } from "../../testing/fixtures";

/** Repository stub: the runner only needs enumeration to be interesting. */
class FakeRepository implements StateRepository {
  constructor(private readonly owners: string[]) {}
  seen: number | undefined;

  async load() {
    return undefined;
  }
  async save() {
    return 1;
  }
  async listOwnerKeys(limit: number): Promise<string[]> {
    this.seen = limit;
    return this.owners.slice(0, limit);
  }
}

let prevDir: string | undefined;

beforeAll(() => {
  prevDir = process.env.PRAXIS_STATE_DIR;
});

afterAll(() => {
  if (prevDir === undefined) delete process.env.PRAXIS_STATE_DIR;
  else process.env.PRAXIS_STATE_DIR = prevDir;
  resetStateRepositoryForTests();
});

beforeEach(() => {
  resetStateRepositoryForTests();
});

describe("fireDueSchedulesForAllWallets", () => {
  test("visits every wallet with stored state", async () => {
    const owners = [randomAddress(), randomAddress(), randomAddress()];
    resetStateRepositoryForTests(new FakeRepository(owners));

    const summary = await fireDueSchedulesForAllWallets(Date.now());
    // Each wallet loads an empty document, so none has a schedule due — the
    // point is that the job discovers wallets at all, with no session.
    expect(summary.wallets).toBe(3);
    expect(summary.proposals).toBe(0);
    expect(summary.failures).toBe(0);
  });

  test("skips owner keys that are not wallet addresses", async () => {
    // The `default` sentinel is used when no wallet is configured; it has no
    // policy to schedule against.
    resetStateRepositoryForTests(new FakeRepository(["default", "not-a-pubkey", randomAddress()]));
    const summary = await fireDueSchedulesForAllWallets(Date.now());
    expect(summary.wallets).toBe(1);
  });

  test("bounds the fan-out so one tick cannot run away", async () => {
    const repo = new FakeRepository(Array.from({ length: 50 }, () => randomAddress()));
    resetStateRepositoryForTests(repo);
    await fireDueSchedulesForAllWallets(Date.now(), 10);
    expect(repo.seen).toBe(10);
  });

  test("isolates a failing wallet instead of aborting the run", async () => {
    const owners = [randomAddress(), randomAddress()];
    const repo = new FakeRepository(owners);
    // One wallet's load throws (unreachable database, corrupt document, …).
    let calls = 0;
    repo.load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("state backend unavailable");
      return undefined;
    };
    resetStateRepositoryForTests(repo);

    const summary = await fireDueSchedulesForAllWallets(Date.now());
    expect(summary.failures).toBe(1);
    expect(summary.wallets).toBe(2); // the second wallet was still visited
  });
});

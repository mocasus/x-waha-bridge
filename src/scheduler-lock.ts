import { randomUUID } from "crypto";
import { config } from "./config";
import { redis } from "./queue";

const LOCK_KEY = "scheduler:poll-lock";
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const REFRESH_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

export type SchedulerLock = {
  token: string;
  refresh: () => Promise<boolean>;
  release: () => Promise<void>;
};

export async function acquireSchedulerLock(): Promise<SchedulerLock | null> {
  const token = randomUUID();
  const locked = await redis.set(LOCK_KEY, token, "PX", config.x.schedulerLockMs, "NX");

  if (locked !== "OK") {
    return null;
  }

  return {
    token,
    refresh: async () => {
      const result = await redis.eval(REFRESH_IF_OWNER_SCRIPT, 1, LOCK_KEY, token, String(config.x.schedulerLockMs));
      return Number(result) === 1;
    },
    release: async () => {
      await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, LOCK_KEY, token);
    }
  };
}

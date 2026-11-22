<?php

namespace App\Services;

use Closure;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;

// How many long relays (radio, a direct video: the ones that hold a PHP worker) an account has running at once, capped
// at config liteos.net.relays_at_once. Each running relay keeps a slot in the cache with the time it was last seen and
// refreshes it while it streams; a slot not seen for a minute is free again, so a worker that died never leaves a slot
// taken for good. Works with any cache store that has locks (database, redis, file, array).
class RelaySlots
{
    // a slot not refreshed for this long is free; relays refresh theirs every BEAT seconds
    const FRESH = 60;

    const BEAT = 30;

    /**
     * Takes a slot for the account, or returns null when all of them are in use.
     */
    public function take(int|string $user): ?string
    {
        $limit = max(1, (int) config('liteos.net.relays_at_once'));
        $id = bin2hex(random_bytes(8));

        try {
            return $this->update($user, function (array &$slots, int $now) use ($limit, $id) {
                if (count($slots) >= $limit) {
                    return null;
                }
                $slots[$id] = $now;

                return $id;
            });
        } catch (LockTimeoutException) {
            return null;
        }
    }

    public function beat(int|string $user, string $id): void
    {
        $this->quietly($user, function (array &$slots, int $now) use ($id) {
            $slots[$id] = $now;
        });
    }

    public function free(int|string $user, string $id): void
    {
        $this->quietly($user, function (array &$slots) use ($id) {
            unset($slots[$id]);
        });
    }

    /**
     * Slots in use, for tests and diagnostics.
     */
    public function inUse(int|string $user): int
    {
        return count($this->fresh(Cache::get($this->key($user), []), time()));
    }

    private function quietly(int|string $user, Closure $change): void
    {
        try {
            $this->update($user, $change);
        } catch (LockTimeoutException) {
            // a missed refresh or release only frees the slot a minute later
        }
    }

    /**
     * @param  Closure(array<string, int>&, int): mixed  $change
     */
    private function update(int|string $user, Closure $change): mixed
    {
        return Cache::lock($this->key($user).':lock', 5)->block(3, function () use ($user, $change) {
            $now = time();
            $slots = $this->fresh(Cache::get($this->key($user), []), $now);
            $result = $change($slots, $now);
            Cache::put($this->key($user), $slots, 3600);

            return $result;
        });
    }

    /**
     * @param  array<string, int>  $slots
     * @return array<string, int>
     */
    private function fresh(array $slots, int $now): array
    {
        return array_filter($slots, fn (int $seen) => $seen > $now - self::FRESH);
    }

    private function key(int|string $user): string
    {
        return 'relay-slots:'.$user;
    }
}

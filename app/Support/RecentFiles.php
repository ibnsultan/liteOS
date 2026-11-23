<?php

namespace App\Support;

use App\Models\RecentFile;
use App\Models\User;

// The files a user opened or saved most recently (the launcher's and Files' "Recent"). Opening or saving a file moves
// it to the top; the list keeps the newest 20 and shows the 12 that still exist. Hidden app data (/.browser...) never
// appears.
class RecentFiles
{
    const KEEP = 20;

    const SHOW = 12;

    public static function push(User $user, string $path): void
    {
        if (str_contains($path, '/.')) {
            return;
        }

        // a fresh row each time, so the newest is always the highest id (two files opened in the same second keep
        // their order, which opened_at alone can't tell)
        $hash = hash('sha256', $path);
        RecentFile::query()->where('user_id', $user->id)->where('path_hash', $hash)->delete();
        RecentFile::query()->create(['user_id' => $user->id, 'path' => $path, 'path_hash' => $hash, 'opened_at' => now()]);

        $keep = RecentFile::query()->where('user_id', $user->id)->orderByDesc('id')->limit(self::KEEP)->pluck('id');
        RecentFile::query()->where('user_id', $user->id)->whereNotIn('id', $keep)->delete();
    }

    /** Takes a file off the list (the file itself stays where it is). */
    public static function forget(User $user, string $path): void
    {
        RecentFile::query()->where('user_id', $user->id)->where('path_hash', hash('sha256', $path))->delete();
    }

    /**
     * The recent files that still exist, newest first, as drive entries, each with when it was last opened (`opened`,
     * Unix seconds).
     *
     * @return list<array<string, mixed>>
     */
    public static function list(User $user): array
    {
        $drive = new Drive($user);
        $entries = [];
        foreach (RecentFile::query()->where('user_id', $user->id)->orderByDesc('id')->get(['path', 'opened_at']) as $row) {
            $abs = $drive->abs($drive->clean($row->path));
            if (is_file($abs)) {
                $entries[] = $drive->entry($drive->clean($row->path), $abs) + ['opened' => $row->opened_at ? strtotime((string) $row->opened_at) : null];
            }
            if (count($entries) >= self::SHOW) {
                break;
            }
        }

        return $entries;
    }
}

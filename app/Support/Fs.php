<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\File;

// Moving, copying and deleting on disk, with an answer that can be checked: each call returns false when it didn't
// happen (no warning), so the caller changes its records only after the disk did. Tests make a call fail with
// failUsing(), since a real failure (a full disk, a locked file) can't be set up on every system.
class Fs
{
    /** @var (Closure(string, string): bool)|null given the operation and the path; true makes that call fail */
    private static ?Closure $fail = null;

    /**
     * @param  (Closure(string, string): bool)|null  $fail
     */
    public static function failUsing(?Closure $fail): void
    {
        self::$fail = $fail;
    }

    public static function rename(string $from, string $to): bool
    {
        return ! self::fails('rename', $from) && @rename($from, $to);
    }

    /**
     * Copies a file, or a folder with everything in it.
     */
    public static function copy(string $from, string $to): bool
    {
        if (self::fails('copy', $from)) {
            return false;
        }

        return is_dir($from) ? (bool) @File::copyDirectory($from, $to) : @copy($from, $to);
    }

    /**
     * Deletes a file, or a folder with everything in it. Something already gone counts as deleted.
     */
    public static function delete(string $path): bool
    {
        if (self::fails('delete', $path)) {
            return false;
        }
        if (is_dir($path)) {
            File::deleteDirectory($path);
        } elseif (file_exists($path)) {
            @unlink($path);
        }
        clearstatcache(true, $path);

        return ! file_exists($path);
    }

    private static function fails(string $operation, string $path): bool
    {
        return self::$fail !== null && (self::$fail)($operation, $path);
    }
}

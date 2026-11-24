<?php

namespace App\Support;

use App\Models\TrashItem;
use App\Models\User;
use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;

// What fills a drive, for System Monitor › Storage: the signed-in user's own drive by top folder, its largest files
// and its Trash (mine), and for administrators every account's drive split into Desktop, Documents, Downloads and the
// rest (everyone). Read straight from the drives disk; nothing is stored. Hidden folders (app data such as /.apps)
// count as "other" and their files are never listed.
class StorageReport
{
    /** How many of the largest files are listed. */
    private const LARGEST = 10;

    /**
     * @return array{used: int, quota: int, folders: list<array{name: string, path: string, bytes: int}>, other: int, trash: array{bytes: int, items: int}, largest: list<array{name: string, path: string, size: int, mtime: int}>}
     */
    public static function mine(User $user): array
    {
        $root = Drive::root($user->username);
        $folders = [];
        $other = 0;
        $largest = [];
        foreach (is_dir($root) ? new FilesystemIterator($root, FilesystemIterator::SKIP_DOTS) : [] as $item) {
            /** @var SplFileInfo $item */
            $name = $item->getFilename();
            $hidden = str_starts_with($name, '.');
            if ($item->isDir() && ! $item->isLink()) {
                $bytes = $hidden ? Drive::sizeOf($item->getPathname()) : self::walk($item->getPathname(), '/'.$name, $largest);
                if ($hidden) {
                    $other += $bytes;
                } else {
                    $folders[] = ['name' => $name, 'path' => '/'.$name, 'bytes' => $bytes];
                }
            } elseif ($item->isFile()) {
                $other += $item->getSize();
                if (! $hidden) {
                    self::keep($largest, $item, '/'.$name);
                }
            }
        }
        usort($folders, fn ($a, $b) => $b['bytes'] <=> $a['bytes'] ?: strcmp($a['name'], $b['name']));
        $trash = Drive::sizeOf(Trash::root($user->username));

        return [
            'used' => array_sum(array_column($folders, 'bytes')) + $other + $trash,
            'quota' => Drive::quotaBytes($user),
            'folders' => $folders,
            'other' => $other,
            'trash' => ['bytes' => $trash, 'items' => TrashItem::query()->where('user_id', $user->id)->count()],
            'largest' => array_values($largest),
        ];
    }

    /**
     * Every account but the guest (whose files are in its own browser): used and quota, split into Desktop, Documents,
     * Downloads and other (everything else, hidden app data and Trash included).
     *
     * @return list<array<string, mixed>>
     */
    public static function everyone(): array
    {
        return User::query()->orderBy('name')->get()->reject(fn (User $u) => $u->isGuest())->values()->map(function (User $u) {
            $root = Drive::root($u->username);
            $parts = ['desktop' => 0, 'documents' => 0, 'downloads' => 0, 'other' => 0];
            foreach (is_dir($root) ? new FilesystemIterator($root, FilesystemIterator::SKIP_DOTS) : [] as $item) {
                $bytes = $item->isDir() && ! $item->isLink() ? Drive::sizeOf($item->getPathname()) : ($item->isFile() ? $item->getSize() : 0);
                $key = strtolower($item->getFilename());
                $parts[isset($parts[$key]) && $key !== 'other' && $item->isDir() ? $key : 'other'] += $bytes;
            }
            $parts['other'] += Drive::sizeOf(Trash::root($u->username));

            return [
                'username' => $u->username,
                'name' => $u->name,
                'roleLabel' => $u->role->label(),
                'color' => $u->color,
                'used' => array_sum($parts),
                'quota' => Drive::quotaBytes($u),
                'parts' => $parts,
            ];
        })->all();
    }

    /**
     * Bytes in a folder; while walking it, keeps the largest files (none inside hidden folders).
     *
     * @param  array<string, array{name: string, path: string, size: int, mtime: int}>  $largest
     */
    private static function walk(string $abs, string $path, array &$largest): int
    {
        $bytes = 0;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($abs, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
        foreach ($it as $file) {
            /** @var SplFileInfo $file */
            if (! $file->isFile()) {
                continue;
            }
            $bytes += $file->getSize();
            $rel = str_replace(DIRECTORY_SEPARATOR, '/', substr($file->getPathname(), strlen($abs)));
            if (! str_contains($rel, '/.')) {
                self::keep($largest, $file, $path.$rel);
            }
        }

        return $bytes;
    }

    /** @param  array<string, array{name: string, path: string, size: int, mtime: int}>  $largest */
    private static function keep(array &$largest, SplFileInfo $file, string $path): void
    {
        $size = $file->getSize();
        if (count($largest) >= self::LARGEST && $size <= end($largest)['size']) {
            return;
        }
        $largest[$path] = ['name' => $file->getFilename(), 'path' => $path, 'size' => $size, 'mtime' => $file->getMTime()];
        uasort($largest, fn ($a, $b) => $b['size'] <=> $a['size']);
        $largest = array_slice($largest, 0, self::LARGEST, true);
    }
}

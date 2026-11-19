<?php

namespace App\Support;

use App\Models\TrashItem;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;

// A user's Trash. Deleting moves the item to .trash/<username>/<trash_id> on the drives disk (outside the drive, so it
// never shows in Files' folders) and records where it came from (App\Models\TrashItem). Restore puts it back in its
// folder, or at the top of the drive when that folder is gone, with " (2)" if the name was taken meanwhile. Items in
// the Trash still count towards the user's storage, as in the MVP.
class Trash
{
    public function __construct(private User $user, private Drive $drive) {}

    public static function for(User $user): self
    {
        return new self($user, new Drive($user));
    }

    /**
     * Where a user's trashed items are kept. Usernames can't start with a dot, so this never meets a drive.
     */
    public static function root(string $username): string
    {
        return Storage::disk('drives')->path('.trash'.DIRECTORY_SEPARATOR.$username);
    }

    /**
     * Moves items to the Trash; items that don't exist are skipped. Returns how many were moved.
     *
     * @param  list<mixed>  $paths
     */
    public function put(array $paths): int
    {
        File::ensureDirectoryExists(self::root($this->user->username), 0775);
        $moved = 0;
        foreach ($paths as $path) {
            $clean = $this->drive->clean((string) $path);
            if ($clean === '/') {
                continue;
            }
            $abs = $this->drive->abs($clean);
            if (! file_exists($abs)) {
                continue;
            }
            $id = bin2hex(random_bytes(6));
            $dest = $this->path($id);
            $isDir = is_dir($abs);
            $size = $isDir ? null : (int) filesize($abs);
            rename($abs, $dest);
            TrashItem::query()->create([
                'user_id' => $this->user->id,
                'trash_id' => $id,
                'name' => basename($clean),
                'original_path' => $clean,
                'kind' => $isDir ? 'dir' : 'file',
                'size' => $size,
                'deleted_at' => now(),
            ]);
            $moved++;
        }

        return $moved;
    }

    /**
     * What is in the Trash, most recently deleted first.
     *
     * @return list<array<string, mixed>>
     */
    public function list(): array
    {
        return $this->items()->orderByDesc('deleted_at')->orderByDesc('id')->get()->map(fn (TrashItem $item) => $item->toPublic())->all();
    }

    /**
     * Puts items back where they were deleted from. Returns how many were restored.
     *
     * @param  list<mixed>  $ids
     */
    public function restore(array $ids): int
    {
        $restored = 0;
        foreach ($this->items()->whereIn('trash_id', $this->validIds($ids))->get() as $item) {
            DB::transaction(function () use ($item) {
                $folder = Drive::parentOf($item->original_path);
                if (! is_dir($this->drive->abs($folder))) {
                    $folder = '/';
                }
                $source = $this->path($item->trash_id);
                if (file_exists($source)) {
                    rename($source, $this->drive->abs($this->drive->unique($folder, $item->name)));
                }
                $item->delete();
            });
            $restored++;
        }

        return $restored;
    }

    /**
     * Deletes items for good; no ids empties the whole Trash. Returns how many were deleted.
     *
     * @param  list<mixed>  $ids
     */
    public function purge(array $ids = []): int
    {
        $query = $this->items();
        if ($ids) {
            $query->whereIn('trash_id', $this->validIds($ids));
        }
        $deleted = 0;
        foreach ($query->get() as $item) {
            $path = $this->path($item->trash_id);
            is_dir($path) ? File::deleteDirectory($path) : File::delete($path);
            $item->delete();
            $deleted++;
        }

        return $deleted;
    }

    private function items(): Builder
    {
        return TrashItem::query()->where('user_id', $this->user->id);
    }

    private function path(string $id): string
    {
        return self::root($this->user->username).DIRECTORY_SEPARATOR.$id;
    }

    /**
     * @param  list<mixed>  $ids
     * @return list<string>
     */
    private function validIds(array $ids): array
    {
        return array_values(array_filter($ids, fn ($id) => is_string($id) && preg_match('/^[a-f0-9]{12}$/', $id)));
    }
}

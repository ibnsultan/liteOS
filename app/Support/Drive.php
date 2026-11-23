<?php

namespace App\Support;

use App\Models\User;
use FilesystemIterator;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

// A user's drive: real files and folders under the "drives" disk (storage/app/drives/<username>/), the MVP's
// data/users/<username>/files. Paths from the browser are always relative to the drive ("/Documents/a.ldoc") and are
// never trusted: clean() refuses "..", odd characters and names that are too long, and abs() makes sure the result
// (links included) is still inside the drive. Hidden folders (/.browser, /.player: app data) are left out of
// listings, search and Recent. Failures abort with an HTTP status and one plain sentence, the MVP's wording.
//
// Static helpers (root, ensureHome, usage, quotaBytes, archive) work by username; everything else is per user:
// (new Drive($user))->list('/Documents').
class Drive
{
    // the folders every new drive starts with
    const HOME_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'];

    private string $root;

    public function __construct(private User $user)
    {
        $this->root = self::root($user->username);
        // a drive that's gone while its owner is still signed in (storage wiped by a redeploy, or the folder removed
        // by hand) starts again with the standard folders, as at sign-in; a folder the user deleted stays deleted
        if (! is_dir($this->root)) {
            self::ensureHome($user->username);
        }
        File::ensureDirectoryExists($this->root, 0775);
    }

    // ------------------------------------------------------------ by username

    /**
     * The absolute path of a user's drive. Usernames are validated before they reach here (App\Support\Accounts), so
     * they can't step outside the disk.
     */
    public static function root(string $username): string
    {
        return Storage::disk('drives')->path($username);
    }

    /**
     * Creates the drive and its standard folders if they are missing. Safe to call on every sign-in.
     */
    public static function ensureHome(string $username): void
    {
        foreach (self::HOME_FOLDERS as $folder) {
            File::ensureDirectoryExists(self::root($username).DIRECTORY_SEPARATOR.$folder, 0775);
        }
    }

    /**
     * Bytes used by the user's files and their Trash, hidden app data included.
     */
    public static function usage(string $username): int
    {
        return self::sizeOf(self::root($username)) + self::sizeOf(Trash::root($username));
    }

    /**
     * How many bytes the user may store: their own quota, or the system default.
     */
    public static function quotaBytes(User $user): int
    {
        $default = $user->isLocal() ? 'defaultLocalQuotaMB' : 'defaultQuotaMB';

        return ($user->quota_mb ?? (int) SystemSettings::get($default)) * 1024 * 1024;
    }

    /**
     * Moves a deleted account's drive aside, to .deleted/<username>-<time> on the drives disk, so it can be recovered
     * by hand, like the MVP did. Nothing is erased. Usernames can't start with a dot, so this never meets a drive.
     */
    public static function archive(string $username): void
    {
        $root = self::root($username);
        if (! is_dir($root)) {
            return;
        }
        $dest = Storage::disk('drives')->path('.deleted');
        File::ensureDirectoryExists($dest, 0775);
        // left in place, the drive would go to the next account given this username
        abort_unless(
            Fs::rename($root, $dest.DIRECTORY_SEPARATOR.$username.'-'.gmdate('Ymd-His')),
            500,
            'Couldn’t move the account’s files aside, so the account wasn’t deleted.',
        );
    }

    /**
     * Bytes in a file, or in everything inside a folder.
     */
    public static function sizeOf(string $abs): int
    {
        if (is_file($abs)) {
            return (int) filesize($abs);
        }
        if (! is_dir($abs)) {
            return 0;
        }
        $bytes = 0;
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($abs, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isFile()) {
                $bytes += $file->getSize();
            }
        }

        return $bytes;
    }

    // ------------------------------------------------------------ paths

    /**
     * A browser path normalised to "/a/b/c": no empty or "." parts, and never "..".
     */
    public function clean(string $path): string
    {
        if (str_contains($path, "\0")) {
            abort(400, 'Invalid path.');
        }
        $parts = [];
        foreach (explode('/', str_replace('\\', '/', $path)) as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                abort(400, 'Invalid path.');
            }
            if (preg_match('/[<>:"|?*\x00-\x1F]/', $part) || strlen($part) > 200) {
                abort(400, 'File names can’t contain < > : " | ? * characters.');
            }
            $parts[] = $part;
        }

        return '/'.implode('/', $parts);
    }

    /**
     * The absolute path on disk for a clean drive path, checked to be inside the drive even through links.
     */
    public function abs(string $clean): string
    {
        $abs = $this->root.($clean === '/' ? '' : str_replace('/', DIRECTORY_SEPARATOR, $clean));
        $real = realpath($abs);
        if ($real !== false && ! self::inside($real, $this->root)) {
            abort(403, 'Invalid path.');
        }

        return $abs;
    }

    /**
     * A name for a new or renamed item: one path part, no separators.
     */
    public function name(string $name): string
    {
        $name = trim($name);
        if ($name === '' || $name === '.' || $name === '..' || str_contains($name, '/') || str_contains($name, '\\')) {
            abort(400, 'Enter a valid name.');
        }
        $this->clean($name); // character checks

        return $name;
    }

    /**
     * The parent folder of a clean path ("/" for top-level items).
     */
    public static function parentOf(string $clean): string
    {
        $parent = rtrim(str_replace('\\', '/', dirname($clean)), '/');

        return $parent === '' ? '/' : $parent;
    }

    /**
     * "name (2).ext" in a folder when "name.ext" is taken; returns the clean path to use.
     */
    public function unique(string $dir, string $name): string
    {
        $base = pathinfo($name, PATHINFO_FILENAME);
        $ext = pathinfo($name, PATHINFO_EXTENSION);
        $candidate = $name;
        for ($i = 2; file_exists($this->abs(rtrim($dir, '/').'/'.$candidate)); $i++) {
            $candidate = $base.' ('.$i.')'.($ext !== '' ? '.'.$ext : '');
        }

        return rtrim($dir, '/').'/'.$candidate;
    }

    // ------------------------------------------------------------ reading

    /**
     * An item as the apps see it (the MVP's keys).
     *
     * @return array{name: string, path: string, type: string, ext: string, size: int|null, mtime: int, count: int|null}
     */
    public function entry(string $clean, ?string $abs = null): array
    {
        $abs ??= $this->abs($clean);
        $isDir = is_dir($abs);
        $name = basename($clean);

        return [
            'name' => $name,
            'path' => $clean,
            'type' => $isDir ? 'dir' : 'file',
            'ext' => $isDir ? '' : strtolower(pathinfo($name, PATHINFO_EXTENSION)),
            'size' => $isDir ? null : (int) filesize($abs),
            'mtime' => (int) filemtime($abs),
            'count' => $isDir ? max(0, count(scandir($abs) ?: []) - 2) : null,
        ];
    }

    /**
     * A folder's items, folders first, then by name (natural order); hidden items left out.
     *
     * @return list<array<string, mixed>>
     */
    public function list(string $path): array
    {
        $clean = $this->clean($path);
        $abs = $this->abs($clean);
        if (! is_dir($abs)) {
            abort(404, 'Folder not found.');
        }

        $items = [];
        foreach (scandir($abs) ?: [] as $name) {
            if ($name === '.' || $name === '..' || str_starts_with($name, '.')) {
                continue;
            }
            $items[] = $this->entry(rtrim($clean, '/').'/'.$name, $abs.DIRECTORY_SEPARATOR.$name);
        }
        usort($items, fn (array $a, array $b) => $a['type'] !== $b['type'] ? ($a['type'] === 'dir' ? -1 : 1) : strnatcasecmp($a['name'], $b['name']));

        return $items;
    }

    /**
     * @return array<string, mixed>
     */
    public function stat(string $path): array
    {
        $clean = $this->clean($path);
        $abs = $this->abs($clean);
        if (! file_exists($abs)) {
            abort(404, 'Not found.');
        }

        return $this->entry($clean, $abs);
    }

    /**
     * A text file's content. $track adds it to Recent (apps reading their own data pass false).
     *
     * @return array{content: string, entry: array<string, mixed>}
     */
    public function read(string $path, bool $track = true): array
    {
        $clean = $this->clean($path);
        $abs = $this->abs($clean);
        if (! is_file($abs)) {
            abort(404, 'File not found.');
        }
        if (filesize($abs) > config('liteos.max_read_bytes')) {
            abort(413, 'This file is too large to open here.');
        }
        $content = (string) file_get_contents($abs);
        if (! mb_check_encoding($content, 'UTF-8')) {
            abort(415, 'This file can’t be opened as text.');
        }
        if ($track) {
            RecentFiles::push($this->user, $clean);
        }

        return ['content' => $content, 'entry' => $this->entry($clean, $abs)];
    }

    /**
     * Files and folders whose name contains $query (any case), newest first; $kind limits to a file-type group
     * (config liteos.kinds: image, video, audio, text). Hidden items are never found.
     *
     * @return list<array<string, mixed>>
     */
    public function search(string $query, string $kind = '', int $limit = 200): array
    {
        $query = mb_strtolower(trim($query));
        $extensions = $kind !== '' ? (config('liteos.kinds.'.$kind) ?? []) : null;
        $root = str_replace('\\', '/', $this->root);
        $found = [];

        $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($this->root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
        foreach ($items as $item) {
            $relative = substr(str_replace('\\', '/', $item->getPathname()), strlen($root));
            if (str_contains($relative, '/.')) {
                continue; // hidden files and anything inside hidden folders
            }
            if ($extensions !== null && (! $item->isFile() || ! in_array(strtolower($item->getExtension()), $extensions, true))) {
                continue;
            }
            if ($query !== '' && ! str_contains(mb_strtolower($item->getFilename()), $query)) {
                continue;
            }
            $found[] = $this->entry($relative, $item->getPathname());
            if (count($found) >= $limit) {
                break;
            }
        }
        usort($found, fn (array $a, array $b) => $b['mtime'] <=> $a['mtime']);

        return $found;
    }

    /**
     * The drive's own icon: an .ico at the top of the drive (autorun.ico or .drive.ico first, then any .ico, by
     * name), as its drive path, or null for the generic disk.
     */
    public function icon(): ?string
    {
        $icons = array_values(array_filter(scandir($this->root) ?: [], fn (string $name) => strtolower(pathinfo($name, PATHINFO_EXTENSION)) === 'ico' && is_file($this->root.DIRECTORY_SEPARATOR.$name)));
        if (! $icons) {
            return null;
        }
        usort($icons, function (string $a, string $b) {
            $rank = fn (string $name) => match (strtolower($name)) {
                'autorun.ico' => 0, '.drive.ico' => 1, default => 2
            };

            return [$rank($a), strtolower($a)] <=> [$rank($b), strtolower($b)];
        });

        return '/'.$icons[0];
    }

    // ------------------------------------------------------------ changing

    /**
     * Stops a change that would take the user over their storage quota.
     */
    public function checkQuota(int $incomingBytes): void
    {
        if ($incomingBytes > 0 && self::usage($this->user->username) + $incomingBytes > self::quotaBytes($this->user)) {
            abort(507, 'Not enough storage space. Empty the Trash or ask an administrator for more space.');
        }
    }

    /**
     * Creates or replaces a file. With $overwrite false an existing file is an error.
     *
     * @return array<string, mixed>
     */
    public function write(string $path, string $content, bool $overwrite = true): array
    {
        $clean = $this->clean($path);
        if ($clean === '/') {
            abort(400, 'Choose a file name.');
        }
        if (strlen($content) > config('liteos.max_write_bytes')) {
            abort(413, 'File is too large.');
        }
        $abs = $this->abs($clean);
        if (! is_dir(dirname($abs))) {
            abort(404, 'The folder doesn’t exist.');
        }
        if (is_dir($abs)) {
            abort(409, 'A folder with that name already exists.');
        }
        if (! $overwrite && file_exists($abs)) {
            abort(409, 'A file with that name already exists.');
        }
        $this->checkQuota(strlen($content) - (is_file($abs) ? (int) filesize($abs) : 0));
        if (file_put_contents($abs, $content, LOCK_EX) === false) {
            abort(500, 'Could not save the file.');
        }
        clearstatcache(true, $abs);
        RecentFiles::push($this->user, $clean);

        return $this->entry($clean, $abs);
    }

    /**
     * @return array<string, mixed>
     */
    public function mkdir(string $path): array
    {
        $clean = $this->clean($path);
        $abs = $this->abs($clean);
        if (file_exists($abs)) {
            abort(409, 'Something with that name already exists.');
        }
        if (! is_dir(dirname($abs))) {
            abort(404, 'The parent folder doesn’t exist.');
        }
        mkdir($abs, 0775);

        return $this->entry($clean, $abs);
    }

    /**
     * @return array<string, mixed>
     */
    public function rename(string $path, string $newName): array
    {
        $clean = $this->clean($path);
        if ($clean === '/') {
            abort(400, 'You can’t rename your drive.');
        }
        $newName = $this->name($newName);
        $abs = $this->abs($clean);
        if (! file_exists($abs)) {
            abort(404, 'Not found.');
        }
        $target = $this->clean(rtrim(self::parentOf($clean), '/').'/'.$newName);
        $targetAbs = $this->abs($target);
        // a change of letter case only ("notes" to "Notes") is allowed on case-insensitive disks
        if (file_exists($targetAbs) && strcasecmp($targetAbs, $abs) !== 0) {
            abort(409, 'Something with that name already exists.');
        }
        abort_unless(Fs::rename($abs, $targetAbs), 500, 'Couldn’t rename “'.basename($clean).'”.');

        return $this->entry($target, $targetAbs);
    }

    /**
     * Moves or copies items into a folder; a name that is taken there gets " (2)". Items that don't exist are skipped.
     *
     * @param  list<mixed>  $paths
     * @return list<array<string, mixed>>
     */
    public function transfer(array $paths, string $destination, bool $copy): array
    {
        $dest = $this->clean($destination);
        if (! is_dir($this->abs($dest))) {
            abort(404, 'Destination folder not found.');
        }

        $results = [];
        foreach ($paths as $path) {
            $source = $this->clean((string) $path);
            if ($source === '/') {
                continue;
            }
            $sourceAbs = $this->abs($source);
            if (! file_exists($sourceAbs)) {
                continue;
            }
            if (is_dir($sourceAbs) && ($dest === $source || str_starts_with($dest.'/', $source.'/'))) {
                abort(400, 'You can’t move a folder into itself.');
            }
            if (! $copy && self::parentOf($source) === $dest) {
                $results[] = $this->entry($source, $sourceAbs); // already there

                continue;
            }
            $target = $this->unique($dest, basename($source));
            $targetAbs = $this->abs($target);
            if ($copy) {
                $this->checkQuota(self::sizeOf($sourceAbs));
                if (! Fs::copy($sourceAbs, $targetAbs)) {
                    Fs::delete($targetAbs); // whatever was copied before it failed
                    abort(500, 'Couldn’t copy “'.basename($source).'”.');
                }
            } else {
                abort_unless(Fs::rename($sourceAbs, $targetAbs), 500, 'Couldn’t move “'.basename($source).'”.');
            }
            $results[] = $this->entry($target, $targetAbs);
        }

        return $results;
    }

    /**
     * Saves uploaded files into a folder; a name that is taken gets " (2)".
     *
     * @param  list<UploadedFile>  $files
     * @return list<array<string, mixed>>
     */
    public function upload(string $folder, array $files): array
    {
        $dir = $this->clean($folder);
        if (! is_dir($this->abs($dir))) {
            abort(404, 'Folder not found.');
        }
        if (! $files) {
            // nothing arrived: usually the request was bigger than post_max_size, so PHP dropped it
            abort(413, 'No files were received. They may be larger than the server allows ('.ini_get('post_max_size').' per upload).');
        }
        foreach ($files as $file) {
            if (in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                abort(413, '“'.$file->getClientOriginalName().'” is larger than the server allows ('.ini_get('upload_max_filesize').').');
            }
            if (! $file->isValid()) {
                abort(400, 'Upload failed for “'.$file->getClientOriginalName().'”.');
            }
        }
        $this->checkQuota((int) array_sum(array_map(fn (UploadedFile $file) => $file->getSize(), $files)));

        $saved = [];
        foreach ($files as $file) {
            $target = $this->unique($dir, $this->name(basename(str_replace('\\', '/', $file->getClientOriginalName()))));
            $targetAbs = $this->abs($target);
            $file->move(dirname($targetAbs), basename($targetAbs));
            $saved[] = $this->entry($target, $targetAbs);
        }

        return $saved;
    }

    private static function inside(string $path, string $root): bool
    {
        $norm = fn (string $p) => rtrim(str_replace('\\', '/', $p), '/');
        $realRoot = realpath($root);
        if ($realRoot === false) {
            return false;
        }

        return $norm($path) === $norm($realRoot) || str_starts_with($norm($path).'/', $norm($realRoot).'/');
    }
}

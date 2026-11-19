<?php

namespace App\Services;

use App\Models\User;
use App\Support\Drive;

// Browser › Downloads: saves a web file into the user's drive (lib/net.php's net_fetch_to_drive). The file is written
// to a temporary file first and capped at the user's free space (and a hard limit), then moved into the folder under
// a free name.
class WebFetcher
{
    const MAX_BYTES = 512 * 1024 * 1024;

    // extensions for files whose name has none, by content type
    const EXTENSIONS = [
        'text/html' => 'html', 'application/pdf' => 'pdf', 'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/gif' => 'gif',
        'image/webp' => 'webp', 'image/svg+xml' => 'svg', 'text/plain' => 'txt', 'application/zip' => 'zip',
        'application/json' => 'json', 'audio/mpeg' => 'mp3', 'video/mp4' => 'mp4', 'text/csv' => 'csv',
        'video/webm' => 'webm', 'audio/webm' => 'weba', 'video/ogg' => 'ogv', 'audio/ogg' => 'ogg', 'audio/wav' => 'wav',
        'audio/x-wav' => 'wav', 'audio/flac' => 'flac', 'audio/aac' => 'aac', 'audio/mp4' => 'm4a', 'video/quicktime' => 'mov',
        'video/x-matroska' => 'mkv', 'image/avif' => 'avif', 'image/bmp' => 'bmp', 'image/x-icon' => 'ico',
        'application/x-7z-compressed' => '7z', 'application/gzip' => 'gz', 'application/x-tar' => 'tar',
        'application/epub+zip' => 'epub', 'application/msword' => 'doc', 'application/rtf' => 'rtf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
    ];

    public function __construct(private WebClient $web) {}

    /**
     * Saves the file into $folder under a free name, or as $name when given (the user picked it in the save dialog,
     * which already asked before replacing a file).
     *
     * @return array<string, mixed> the new file's entry
     */
    public function download(User $user, string $url, string $folder, string $name = ''): array
    {
        $drive = new Drive($user);
        $dir = $drive->clean($folder);
        abort_unless(is_dir($drive->abs($dir)), 404, 'Folder not found.');
        $free = Drive::quotaBytes($user) - Drive::usage($user->username);
        abort_if($free <= 0, 507, 'There’s no free storage space for downloads. Empty the Trash or ask an administrator for more space.');
        $limit = min(self::MAX_BYTES, $free);

        @set_time_limit(320);
        $web = $this->web->open($url, ['User-Agent' => 'Mozilla/5.0 (LiteOS Browser download)'], ['connect' => 15, 'total' => 300]);
        if ($web->status >= 400) {
            $web->close();
            abort_if(FrameChecker::challenged($web->headers), 502, (parse_url($web->url, PHP_URL_HOST) ?: 'The website').' only lets a web browser that passes its security check download this file, so it can’t be saved to your drive.');
            abort(502, 'The website answered with an error ('.$web->status.').');
        }

        $tmp = tempnam(sys_get_temp_dir(), 'losdl');
        try {
            $out = fopen($tmp, 'wb');
            $received = 0;
            foreach ($web->chunks() as $chunk) {
                $received += strlen($chunk);
                if ($received > $limit) {
                    fclose($out);
                    abort(507, 'That file is larger than your free storage ('.round($limit / 1048576).' MB).');
                }
                fwrite($out, $chunk);
            }
            fclose($out);

            $target = $name !== ''
                ? $drive->clean($dir.'/'.$drive->name($name))
                : $drive->unique($dir, $drive->name(self::filename($web->url, $web->header('Content-Disposition'), $web->header('Content-Type'))));
            abort_if(is_dir($drive->abs($target)), 409, 'A folder with that name is already there.');
            $abs = $drive->abs($target);
            if (! @rename($tmp, $abs)) {
                copy($tmp, $abs);
            }

            return $drive->entry($target, $abs);
        } finally {
            if (is_file($tmp)) {
                @unlink($tmp);
            }
        }
    }

    /**
     * The name to save under: the server's suggestion, else the address's last part, plus an extension if it has none.
     */
    public static function filename(string $url, string $disposition, string $type): string
    {
        $name = '';
        if (preg_match('/filename\*\s*=\s*UTF-8\'\'([^;]+)/i', $disposition, $m)) {
            $name = rawurldecode(trim($m[1], " \"'"));
        } elseif (preg_match('/filename\s*=\s*"?([^";]+)"?/i', $disposition, $m)) {
            $name = trim($m[1]);
        }
        if ($name === '') {
            $name = rawurldecode(basename((string) parse_url($url, PHP_URL_PATH)));
        }
        $name = trim((string) preg_replace('/[<>:"\/\\\\|?*\x00-\x1F]+/', '_', $name), ' .');
        if ($name === '' || $name === '_') {
            $name = 'download';
        }
        if (! str_contains($name, '.')) {
            $ext = self::EXTENSIONS[strtolower(trim(explode(';', $type)[0]))] ?? '';
            $name .= $ext !== '' ? '.'.$ext : '';
        }

        return mb_substr($name, 0, 150);
    }
}

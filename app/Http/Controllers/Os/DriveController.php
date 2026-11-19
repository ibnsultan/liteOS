<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Support\Drive;
use App\Support\RecentFiles;
use App\Support\Trash;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

// The signed-in user's drive (/os/fs/*), the MVP's fs.* actions with the same arguments and replies: reads are GET
// with the path in the query string, changes are POST. All the rules live in App\Support\Drive.
class DriveController extends Controller
{
    // types the browser may show inline; anything else is sent as a download-type octet stream
    const TYPES = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp',
        'bmp' => 'image/bmp', 'svg' => 'image/svg+xml', 'ico' => 'image/x-icon',
        'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm', 'ogv' => 'video/ogg', 'mov' => 'video/quicktime',
        'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'm4a' => 'audio/mp4',
        'flac' => 'audio/flac', 'aac' => 'audio/aac',
        'pdf' => 'application/pdf', 'txt' => 'text/plain; charset=utf-8', 'md' => 'text/plain; charset=utf-8',
        'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8', 'json' => 'application/json; charset=utf-8', 'csv' => 'text/csv; charset=utf-8',
        'vtt' => 'text/vtt; charset=utf-8', 'srt' => 'text/plain; charset=utf-8', 'm3u' => 'audio/x-mpegurl', 'm3u8' => 'application/vnd.apple.mpegurl',
    ];

    public function list(Request $request): JsonResponse
    {
        $this->result = $this->drive($request)->list((string) $request->query('path', '/'));

        return $this->jsonSuccess();
    }

    public function stat(Request $request): JsonResponse
    {
        $this->result = $this->drive($request)->stat((string) $request->query('path', '/'));

        return $this->jsonSuccess();
    }

    public function read(Request $request): JsonResponse
    {
        $this->result = $this->drive($request)->read((string) $request->query('path'), $request->query('track', '1') !== '0');

        return $this->jsonSuccess();
    }

    /**
     * The file itself, for <img>, <video>, <audio>, previews and downloads. Range requests are answered by the
     * response itself, so video and music can seek. A user's file never runs with LiteOS's rights: it is sandboxed.
     */
    public function raw(Request $request): BinaryFileResponse
    {
        $drive = $this->drive($request);
        $clean = $drive->clean((string) $request->query('path'));
        $abs = $drive->abs($clean);
        abort_unless(is_file($abs), 404, 'File not found.');

        $headers = [
            'Content-Type' => self::TYPES[strtolower(pathinfo($clean, PATHINFO_EXTENSION))] ?? 'application/octet-stream',
            'Content-Security-Policy' => "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'",
            'Cache-Control' => 'private, max-age=0, must-revalidate',
        ];

        return $request->query('download') === '1'
            ? response()->download($abs, basename($clean), $headers)
            : response()->file($abs, $headers);
    }

    public function write(Request $request): JsonResponse
    {
        // a new, empty file arrives as "" and Laravel turns empty strings into null
        $content = $request->input('content') ?? '';
        abort_unless(is_string($content), 400, 'Content must be text.');
        if ($request->input('encoding') === 'base64') {
            $content = base64_decode($content, true);
            abort_if($content === false, 400, 'Invalid file data.');
        }

        $this->result = $this->drive($request)->write((string) $request->input('path'), $content, $request->input('overwrite', true) !== false);

        return $this->jsonSuccess();
    }

    public function mkdir(Request $request): JsonResponse
    {
        $this->result = $this->drive($request)->mkdir((string) $request->input('path'));

        return $this->jsonSuccess();
    }

    public function rename(Request $request): JsonResponse
    {
        $this->result = $this->drive($request)->rename((string) $request->input('path'), (string) $request->input('name'));

        return $this->jsonSuccess();
    }

    public function move(Request $request): JsonResponse
    {
        $this->result = $this->drive($request)->transfer($this->paths($request), (string) $request->input('dest', '/'), copy: false);

        return $this->jsonSuccess();
    }

    public function copy(Request $request): JsonResponse
    {
        $this->result = $this->drive($request)->transfer($this->paths($request), (string) $request->input('dest', '/'), copy: true);

        return $this->jsonSuccess();
    }

    /**
     * Moves items to the Trash (nothing is erased here).
     */
    public function delete(Request $request): JsonResponse
    {
        $this->result = ['trashed' => Trash::for($request->user())->put($this->paths($request))];

        return $this->jsonSuccess();
    }

    public function upload(Request $request): JsonResponse
    {
        $files = $request->file('files', []);
        $this->result = $this->drive($request)->upload((string) $request->input('path', '/'), is_array($files) ? array_values($files) : [$files]);

        return $this->jsonSuccess();
    }

    public function search(Request $request): JsonResponse
    {
        $limit = min(500, max(1, (int) $request->query('limit', 200)));
        $this->result = $this->drive($request)->search((string) $request->query('q', ''), (string) $request->query('kind', ''), $limit);

        return $this->jsonSuccess();
    }

    /**
     * The storage this device has, for Files' "This device" (like "This PC"). Today that is the user's drive; other
     * kinds (USB drives, network storage) can join the list later. A drive with an .ico at its top level shows that
     * icon instead of the generic disk.
     */
    public function drives(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->result = [[
            'id' => 'drive',
            'name' => 'My drive',
            'path' => '/',
            'kind' => 'disk',
            'used' => Drive::usage($user->username),
            'quota' => Drive::quotaBytes($user),
            'icon' => (new Drive($user))->icon(),
        ]];

        return $this->jsonSuccess();
    }

    public function usage(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->result = ['used' => Drive::usage($user->username), 'quota' => Drive::quotaBytes($user)];

        return $this->jsonSuccess();
    }

    public function recent(Request $request): JsonResponse
    {
        $this->result = RecentFiles::list($request->user());

        return $this->jsonSuccess();
    }

    private function drive(Request $request): Drive
    {
        return new Drive($request->user());
    }

    /**
     * @return list<mixed>
     */
    private function paths(Request $request): array
    {
        $paths = $request->input('paths', []);

        return is_array($paths) ? array_values($paths) : [];
    }

    public static function routes(): void
    {
        Route::get('/list', [self::class, 'list'])->name('fs.list');
        Route::get('/stat', [self::class, 'stat'])->name('fs.stat');
        Route::get('/read', [self::class, 'read'])->name('fs.read');
        Route::get('/raw', [self::class, 'raw'])->name('fs.raw');
        Route::get('/search', [self::class, 'search'])->name('fs.search');
        Route::get('/usage', [self::class, 'usage'])->name('fs.usage');
        Route::get('/drives', [self::class, 'drives'])->name('fs.drives');
        Route::get('/recent', [self::class, 'recent'])->name('fs.recent');
        Route::post('/write', [self::class, 'write'])->name('fs.write');
        Route::post('/mkdir', [self::class, 'mkdir'])->name('fs.mkdir');
        Route::post('/rename', [self::class, 'rename'])->name('fs.rename');
        Route::post('/move', [self::class, 'move'])->name('fs.move');
        Route::post('/copy', [self::class, 'copy'])->name('fs.copy');
        Route::post('/delete', [self::class, 'delete'])->name('fs.delete');
        Route::post('/upload', [self::class, 'upload'])->name('fs.upload');
    }
}

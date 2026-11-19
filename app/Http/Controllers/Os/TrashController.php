<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Support\Trash;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// The signed-in user's Trash (/os/trash/*), the MVP's trash.* actions: list it, put items back, delete them for good.
// Moving items into the Trash is DriveController@delete.
class TrashController extends Controller
{
    public function list(Request $request): JsonResponse
    {
        $this->result = Trash::for($request->user())->list();

        return $this->jsonSuccess();
    }

    public function restore(Request $request): JsonResponse
    {
        $this->result = ['restored' => Trash::for($request->user())->restore($this->ids($request))];

        return $this->jsonSuccess();
    }

    /**
     * Deletes for good; no ids empties the whole Trash.
     */
    public function purge(Request $request): JsonResponse
    {
        $this->result = ['deleted' => Trash::for($request->user())->purge($this->ids($request))];

        return $this->jsonSuccess();
    }

    /**
     * @return list<mixed>
     */
    private function ids(Request $request): array
    {
        $ids = $request->input('ids', []);

        return is_array($ids) ? array_values($ids) : [];
    }

    public static function routes(): void
    {
        Route::get('/list', [self::class, 'list'])->name('trash.list');
        Route::post('/restore', [self::class, 'restore'])->name('trash.restore');
        Route::post('/purge', [self::class, 'purge'])->name('trash.purge');
    }
}

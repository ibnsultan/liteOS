<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// A file a user opened or saved recently (App\Support\RecentFiles). Looked up by path_hash, see the migration.
#[Fillable(['user_id', 'path', 'path_hash', 'opened_at'])]
class RecentFile extends Model
{
    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['opened_at' => 'datetime'];
    }

    // belongs to the user who opened it
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

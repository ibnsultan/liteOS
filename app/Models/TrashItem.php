<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// One item in a user's Trash (App\Support\Trash): its name, where it was deleted from, and its folder in the trash.
#[Fillable(['user_id', 'trash_id', 'name', 'original_path', 'kind', 'size', 'deleted_at'])]
class TrashItem extends Model
{
    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['size' => 'integer', 'deleted_at' => 'datetime'];
    }

    // belongs to the user whose Trash it is in
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The item as the Trash lists it (the MVP's keys).
     *
     * @return array{id: string, name: string, original: string, type: string, size: int|null, deletedAt: int}
     */
    public function toPublic(): array
    {
        return [
            'id' => $this->trash_id,
            'name' => $this->name,
            'original' => $this->original_path,
            'type' => $this->kind,
            'size' => $this->size,
            'deletedAt' => $this->deleted_at->getTimestamp(),
        ];
    }
}

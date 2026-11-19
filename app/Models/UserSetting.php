<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// A user's desktop settings: only the values they changed, as one JSON object. Read and written whole through
// App\Support\UserSettings, which adds the defaults and validates every change.
#[Fillable(['user_id', 'settings'])]
class UserSetting extends Model
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['settings' => 'array'];
    }

    // belongs to a user
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

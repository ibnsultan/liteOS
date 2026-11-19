<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

// One setting for the whole instance (instance name, default storage quota...), by key. Read and written through
// App\Support\SystemSettings, which holds the defaults and the validation.
#[Fillable(['key', 'value'])]
class SystemSetting extends Model
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['value' => 'json'];
    }
}

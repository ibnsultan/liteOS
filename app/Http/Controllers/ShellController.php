<?php

namespace App\Http\Controllers;

use App\Support\SystemSettings;
use Illuminate\Contracts\View\View;

// The desktop page (/), for a signed-in, unlocked user (routes/web.php sends everyone else to setup, sign-in or the lock
// page). os.js asks /auth/status and starts the desktop.
class ShellController extends Controller
{
    public function show(): View
    {
        $this->instanceName = SystemSettings::get('instanceName');

        return view('os', $this->data);
    }
}

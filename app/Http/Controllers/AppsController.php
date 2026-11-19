<?php

namespace App\Http\Controllers;

use App\Support\AppRegistry;
use Illuminate\Contracts\View\View;

// An app window's page (/apps/<id>): resources/views/apps/<id>.blade.php for a bundled app. The desktop opens it in an
// iframe and passes what to open in the query string (?path=/Documents/a.ldoc&win=w3), which the SDK reads.
class AppsController extends Controller
{
    public function show(string $app, AppRegistry $apps): View
    {
        abort_if($apps->find($app) === null || ! view()->exists('apps.'.$app), 404);

        return view('apps.'.$app);
    }
}

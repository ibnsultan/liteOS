<?php

namespace App\Http\Controllers;

use App\Support\AppRegistry;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

// An app window's page (/apps/<id>): resources/views/apps/<id>.blade.php for a bundled app. The desktop opens it in an
// iframe and passes what to open in the query string (?path=/Documents/a.ldoc&win=w3), which the SDK reads.
class AppsController extends Controller
{
    public function show(Request $request, string $app, AppRegistry $apps): View|RedirectResponse
    {
        abort_if($apps->find($app) === null || ! view()->exists('apps.'.$app), 404);
        // an app the account isn't allowed (a Local account's list, App\Support\Capabilities) is refused and logged
        Gate::authorize('app', $app);
        // a guest uses apps only in the desktop's windows, never as pages of their own: the browser says how the page
        // is being loaded (Sec-Fetch-Dest), and anything but a frame (a typed address, a new tab, an old browser
        // that doesn't say) goes back to the desktop. The SDK does the same in the browser (sdk.js).
        if ($request->user()->isGuest() && $request->header('Sec-Fetch-Dest') !== 'iframe') {
            return redirect()->route('home');
        }

        return view('apps.'.$app);
    }
}

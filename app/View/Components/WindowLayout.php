<?php

namespace App\View\Components;

use Closure;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

// The page around an app window's content (resources/views/layouts/window.blade.php): the shared app stylesheet, the
// app's own styles, LOS_CONFIG, the icon set, the registry and the SDK, then the app's own scripts. Used by every
// resources/views/apps/<id>.blade.php as <x-layout-window app="notes" title="Notes">.
class WindowLayout extends Component
{
    /**
     * @param  string  $app  the app id, which is also its folder under public/assets/apps
     * @param  list<string>  $styles  the app's stylesheets, relative to its folder
     * @param  list<string>  $scripts  the app's scripts in load order, relative to its folder
     * @param  list<string>  $vendor  third-party libraries it needs first, from public/assets/vendor (npm run vendor)
     */
    public function __construct(
        public string $app,
        public string $title,
        public array $styles = [],
        public array $scripts = ['app.js'],
        public array $vendor = [],
    ) {}

    public function render(): View|Closure|string
    {
        return view('layouts.window');
    }
}

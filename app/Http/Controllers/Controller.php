<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;
use Throwable;

// Base controller. Properties set on a controller ($this->entries = ...) collect in $data, which is handed to the view
// (view('...', $this->data)) or merged into the JSON body by jsonSuccess / jsonError. Every JSON reply has the shape
// { success, message, ...data }; the shell's and the SDK's api() helpers read it (public/assets/js/os.js, sdk.js), and
// bootstrap/app.php gives thrown exceptions the same shape.
abstract class Controller
{
    /** @var array<string, mixed> */
    protected array $data = [];

    public function __set(string $name, mixed $value): void
    {
        $this->data[$name] = $value;
    }

    public function __get(string $name): mixed
    {
        return property_exists($this, $name) ? $this->$name : ($this->data[$name] ?? null);
    }

    /**
     * The error page for an HTTP status (resources/views/errors/<code>.blade.php), with the collected data.
     */
    protected function errorPage(int $code): Response
    {
        return response()->view("errors.$code", $this->data, $code);
    }

    /**
     * { success: true, message } merged with every value set on the controller.
     */
    protected function jsonSuccess(string $message = ''): JsonResponse
    {
        return response()->json(array_merge(['success' => true, 'message' => $message], $this->data));
    }

    /**
     * { success: false, message } merged with every value set on the controller. The message is shown to the user as
     * it is, so it is a plain sentence ("That folder doesn’t exist."), never a code.
     */
    protected function jsonError(string $message, int $code = 400): JsonResponse
    {
        return response()->json(array_merge(['success' => false, 'message' => $message], $this->data), $code);
    }

    /**
     * Logs an unexpected exception and answers with a general message (plus the details while debugging).
     */
    protected function jsonException(Throwable $e): JsonResponse
    {
        Log::error('Exception occurred', [
            'message' => $e->getMessage(),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString(),
        ]);

        if (config('app.debug')) {
            $this->debug = ['message' => $e->getMessage(), 'line' => $e->getLine(), 'file' => $e->getFile()];
        }

        return $this->jsonError('Something went wrong on the server.', 500);
    }
}

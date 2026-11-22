<?php

use App\Http\Middleware\EnsureSetUp;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // accept proxied traffic thru localhost
        $middleware->trustProxies(at: ['127.0.0.1', '::1']);

        // signed out: the sign-in page; signed in: the desktop
        $middleware->redirectGuestsTo(fn () => route('login'));
        $middleware->redirectUsersTo(fn () => route('home'));

        // a new install goes to setup before anything asks it to sign in
        $middleware->prependToPriorityList(before: AuthenticatesRequests::class, prepend: EnsureSetUp::class);

        // a session remembers the password it signed in with: once the password changes (by the user or an
        // administrator), every other session of that account is signed out on its next request. The session that
        // changed it is kept, because the new password is stored in it at the end of that request.
        $middleware->web(append: AuthenticateSession::class);

        // nosniff, same-origin framing, origin-only referrers and a policy that breaks nothing (SecurityHeaders)
        $middleware->append(SecurityHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // the desktop's API (/os) and sign-in (/auth) always answer in JSON
        $wantsJson = fn (Request $request) => $request->is('os/*', 'auth/*') || $request->expectsJson();

        $exceptions->shouldRenderJsonWhen($wantsJson);

        // every JSON error has the same { success: false, message } shape as Controller::jsonError, so the shell and
        // the SDK show thrown exceptions and returned errors alike. Messages are plain sentences shown to the user.
        $exceptions->render(function (Throwable $e, Request $request) use ($wantsJson) {
            if (! $wantsJson($request)) {
                return null; // fall through to the regular HTML error pages
            }

            // a response thrown as it is (a rate limit's own 429) is already the answer
            if ($e instanceof HttpResponseException) {
                return $e->getResponse();
            }

            $status = 500;
            $message = 'Something went wrong on the server.';
            $response = [];

            if ($e instanceof HttpException) {
                $status = $e->getStatusCode();
                $message = $e->getMessage() ?: (Response::$statusTexts[$status] ?? 'Something went wrong.');
            }

            // the router's own wording ("The route os/x could not be found.") isn't for people; a message given with
            // abort(404, '...') (the drive's "Folder not found.") is kept
            if ($e instanceof NotFoundHttpException && ($e->getMessage() === '' || str_starts_with($e->getMessage(), 'The route ') || $e->getMessage() === 'Not Found')) {
                $message = 'That doesn’t exist.';
            }

            // Laravel wraps these in an HttpException before this callback runs; check the original
            if ($e->getPrevious() instanceof ModelNotFoundException) {
                $status = 404;
                $message = 'That item doesn’t exist any more.';
            }

            if ($e instanceof TokenMismatchException || $e->getPrevious() instanceof TokenMismatchException) {
                $status = 419;
                $message = 'Your session expired. Reload the page and try again.';
            }

            if ($e instanceof ValidationException) {
                $status = 422;
                $message = $e->getMessage();
                $response['errors'] = $e->errors();
            }

            if ($e instanceof AuthenticationException) {
                $status = 401;
                $message = 'Please sign in.';
            }

            // a refused gate (can:admin) reaches here as a 403 HttpException wrapping the AuthorizationException;
            // Laravel's stock wording is replaced, a gate's own message is kept
            if ($e instanceof AuthorizationException || $e->getPrevious() instanceof AuthorizationException) {
                $status = 403;
                $message = in_array($e->getMessage(), ['', 'This action is unauthorized.'], true) ? 'Only administrators can do that.' : $e->getMessage();
            }

            $response = ['success' => false, 'message' => $message] + $response;

            if (config('app.debug') && $status >= 500) {
                $response['debug'] = [
                    'exception' => get_class($e),
                    'message' => $e->getMessage(),
                    'line' => $e->getLine(),
                    'file' => $e->getFile(),
                ];
            }

            return response()->json($response, $status);
        });
    })->create();

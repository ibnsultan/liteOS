<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Monolog\Handler\NullHandler;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // tests sign in and change accounts all the time; none of that belongs in the real security log
        // (SecurityLogTest points the channel at a file of its own)
        config(['logging.channels.security' => ['driver' => 'monolog', 'handler' => NullHandler::class]]);
    }
}

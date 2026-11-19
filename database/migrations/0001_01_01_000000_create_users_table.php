<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // LiteOS accounts. People sign in with a username (no email: accounts are created by an administrator, and
        // passwords are reset by one too), and each account has a drive under storage/app/drives/<username>.
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('username', 32)->unique()->comment('lowercase, 2–32 of a-z 0-9 . _ -; also the drive folder');
            $table->string('name', 60)->comment('display name');
            $table->string('password');
            $table->string('role', 16)->default('user')->comment('admin | user (App\Support\Role)');
            $table->char('color', 7)->default('#2F6FD6')->comment('avatar colour on the sign-in screen');
            $table->unsignedInteger('quota_mb')->nullable()->comment('drive size; null = the system default');
            $table->timestamp('disabled_at')->nullable()->comment('set while the account may not sign in');
            $table->timestamp('last_login_at')->nullable();
            $table->rememberToken();
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('sessions');
    }
};

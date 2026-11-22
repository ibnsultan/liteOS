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
        // A Local account's switches set by an administrator (web access, allowed apps, changing its own name and
        // password; App\Support\Capabilities). Null means the role's defaults, which is what every existing account
        // gets, so administrators and standard users behave exactly as before. The role column is already a string,
        // so "local" needs no change there.
        Schema::table('users', function (Blueprint $table) {
            $table->json('permissions')->nullable()->after('quota_mb');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('permissions');
        });
    }
};

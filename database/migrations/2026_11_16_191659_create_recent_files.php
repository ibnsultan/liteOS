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
        // The files each user opened or saved most recently (the launcher's and Files' "Recent"), newest first. A drive
        // path can be too long for a MySQL index, so rows are found by path_hash (SHA-256 of the path).
        Schema::create('recent_files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('path');
            $table->char('path_hash', 64);
            $table->timestamp('opened_at')->useCurrent();
            $table->unique(['user_id', 'path_hash']);
            $table->index(['user_id', 'opened_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('recent_files');
    }
};

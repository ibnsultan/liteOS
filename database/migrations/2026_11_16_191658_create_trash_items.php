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
        // What is in each user's Trash. The item itself is moved to .trash/<username>/<trash_id> on the drives disk;
        // this row remembers where it came from so Restore can put it back.
        Schema::create('trash_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->char('trash_id', 12)->unique()->comment('random; also the item\'s folder name in the trash');
            $table->string('name', 255)->comment('file or folder name, shown in the Trash');
            $table->text('original_path')->comment('drive path it was deleted from');
            $table->string('kind', 4)->comment('file | dir');
            $table->unsignedBigInteger('size')->nullable()->comment('bytes; null for folders');
            $table->timestamp('deleted_at')->useCurrent();
            $table->index(['user_id', 'deleted_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('trash_items');
    }
};

<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Guest;
use App\Support\Role;
use App\Support\SystemSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// Usage tracking (/os/usage/*, App\Support\Usage): off until an administrator turns it on, each user reads only their
// own, websites by name only, guests never, old days deleted.
class UsageTest extends TestCase
{
    use RefreshDatabase;

    private User $amina;

    private User $baraka;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->amina = User::factory()->create(['username' => 'amina']);
        $this->baraka = User::factory()->create(['username' => 'baraka']);
    }

    /** @return array<string, mixed> */
    private function report(array $more = []): array
    {
        return array_merge([
            'day' => Carbon::today()->toDateString(),
            'slots' => [['slot' => 100, 'app' => 'documents', 'seconds' => 50], ['slot' => 100, 'app' => 'browser', 'seconds' => 10]],
            'items' => [
                ['kind' => 'file', 'app' => 'documents', 'item' => '/Documents/report.ldoc', 'seconds' => 50],
                ['kind' => 'site', 'app' => 'browser', 'item' => 'https://www.github.com/someone/secret-repo?tab=1', 'seconds' => 10],
            ],
        ], $more);
    }

    public function test_nothing_is_recorded_until_an_administrator_turns_it_on(): void
    {
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report())->assertOk()->assertJsonPath('result.recorded', false);
        $this->assertSame(0, DB::table('usage_slots')->count());

        SystemSettings::put(['usageTracking' => true]);
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report())->assertOk()->assertJsonPath('result.recorded', true);
        $this->assertSame(2, DB::table('usage_slots')->count());
    }

    public function test_reports_add_up_and_websites_keep_only_their_name(): void
    {
        SystemSettings::put(['usageTracking' => true]);
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report())->assertOk();
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report())->assertOk();

        $day = Carbon::today()->toDateString();
        $res = $this->actingAs($this->amina)->getJson('/os/usage/get?from='.$day.'&to='.$day)->assertOk();
        $res->assertJsonPath('result.days.'.$day.'.documents', 100)
            ->assertJsonPath('result.days.'.$day.'.browser', 20)
            ->assertJsonPath('result.slots.0.slot', 100)
            ->assertJsonPath('result.tracking', true);
        $items = collect($res->json('result.items'));
        $this->assertSame(['/Documents/report.ldoc', 'github.com'], $items->pluck('item')->all());
        $this->assertSame(20, $items->firstWhere('item', 'github.com')['seconds']);
        $this->assertSame(0, DB::table('usage_items')->where('item', 'like', '%secret%')->count());
    }

    public function test_each_user_sees_only_their_own(): void
    {
        SystemSettings::put(['usageTracking' => true]);
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report())->assertOk();

        $day = Carbon::today()->toDateString();
        $this->actingAs($this->baraka)->getJson('/os/usage/get?from='.$day.'&to='.$day)
            ->assertOk()->assertJsonPath('result.days', [])->assertJsonPath('result.items', []);
    }

    public function test_administrators_see_everyone_and_users_never_see_each_other(): void
    {
        SystemSettings::put(['usageTracking' => true]);
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report())->assertOk();
        $day = Carbon::today()->toDateString();
        $q = 'from='.$day.'&to='.$day;

        $this->actingAs($this->baraka)->getJson('/os/usage/everyone?'.$q)->assertForbidden();
        $this->actingAs($this->baraka)->getJson('/os/usage/of?user=amina&'.$q)->assertForbidden();

        $admin = User::factory()->create(['username' => 'admin', 'role' => Role::Admin->value]);
        $all = $this->actingAs($admin)->getJson('/os/usage/everyone?'.$q)->assertOk();
        $amina = collect($all->json('result.users'))->firstWhere('username', 'amina');
        $this->assertSame(60, $amina['seconds']);
        $this->assertSame('documents', $amina['topApp']);
        $this->assertSame('github.com', $amina['topSite']);
        $all->assertJsonPath('result.apps.0.app', 'documents')->assertJsonPath('result.sites.0.item', 'github.com');

        $this->actingAs($admin)->getJson('/os/usage/of?user=amina&'.$q)->assertOk()
            ->assertJsonPath('result.days.'.$day.'.documents', 50)
            ->assertJsonPath('result.user.username', 'amina');
        $this->actingAs($admin)->getJson('/os/usage/of?user=nobody&'.$q)->assertNotFound();
    }

    public function test_impossible_reports_are_refused(): void
    {
        SystemSettings::put(['usageTracking' => true]);
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report(['day' => Carbon::today()->subDays(10)->toDateString()]))->assertStatus(422);
        $many = array_map(fn ($i) => ['slot' => $i, 'app' => 'documents', 'seconds' => 300], range(0, 9));
        $this->actingAs($this->amina)->postJson('/os/usage/add', $this->report(['slots' => $many]))->assertStatus(422);
        $this->assertSame(0, DB::table('usage_slots')->count());
    }

    public function test_the_guest_is_never_recorded(): void
    {
        SystemSettings::put(['usageTracking' => true, 'guestEnabled' => true]);
        Guest::sync(true);
        $guest = Guest::account();
        $this->assertSame(Role::Guest, $guest->role);
        $this->actingAs($guest)->postJson('/os/usage/add', $this->report())->assertOk()->assertJsonPath('result.recorded', false);
        $this->assertSame(0, DB::table('usage_slots')->count());
    }

    public function test_days_older_than_the_administrator_keeps_are_deleted(): void
    {
        SystemSettings::put(['usageTracking' => true]);
        DB::table('usage_slots')->insert(['user_id' => $this->amina->id, 'day' => Carbon::today()->subDays(40)->toDateString(), 'slot' => 1, 'app' => 'files', 'seconds' => 5]);
        DB::table('usage_slots')->insert(['user_id' => $this->amina->id, 'day' => Carbon::today()->subDays(10)->toDateString(), 'slot' => 1, 'app' => 'files', 'seconds' => 5]);

        $admin = User::factory()->create(['username' => 'admin', 'role' => Role::Admin->value]);
        $this->actingAs($admin)->postJson('/os/system/save', ['system' => ['usageKeepDays' => 30]])->assertOk()->assertJsonPath('result.usageKeepDays', 30);
        $this->assertSame(1, DB::table('usage_slots')->count());
        $this->actingAs($admin)->postJson('/os/system/save', ['system' => ['usageKeepDays' => 7]])->assertStatus(422);
    }
}

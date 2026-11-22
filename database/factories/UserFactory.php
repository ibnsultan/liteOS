<?php

namespace Database\Factories;

use App\Models\User;
use App\Support\Role;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state: a user with the password "password".
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'username' => fake()->unique()->userName(),
            'name' => fake()->name(),
            'password' => static::$password ??= Hash::make('password'),
            'role' => Role::User,
            'color' => fake()->randomElement(User::COLORS),
            'remember_token' => Str::random(10),
        ];
    }

    /**
     * An administrator.
     */
    public function admin(): static
    {
        return $this->state(fn (array $attributes) => ['role' => Role::Admin]);
    }

    /**
     * A Local account (limited), with an administrator's switches if given.
     *
     * @param  array<string, mixed>|null  $permissions
     */
    public function local(?array $permissions = null): static
    {
        return $this->state(fn (array $attributes) => ['role' => Role::Local, 'permissions' => $permissions]);
    }

    /**
     * An account that can't sign in.
     */
    public function disabled(): static
    {
        return $this->state(fn (array $attributes) => ['disabled_at' => now()]);
    }
}

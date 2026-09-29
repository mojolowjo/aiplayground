package io.github.mojolowjo.cloudly.config;

import java.util.List;

/**
 * One switchable optimization.
 *
 * <p>The key doubles as a mixin package: the option {@code entity.cramming} controls every
 * mixin under {@code io.github.mojolowjo.cloudly.mixin.entity.cramming}.
 *
 * @param key            dotted name used in {@code cloudly.properties}
 * @param defaultEnabled whether the optimization is on when the player hasn't chosen
 * @param changesGameplay true if the optimization makes the game behave differently from
 *                       vanilla; such options must default to off
 * @param description    one line shown above the option in the config file
 * @param conflictsWith  mod IDs that already do this job; while one is installed the option
 *                       defaults to off, so the two never patch the same code
 */
public record Option(String key, boolean defaultEnabled, boolean changesGameplay, String description,
		List<String> conflictsWith) {
	public Option {
		if (changesGameplay && defaultEnabled) {
			throw new IllegalArgumentException("Gameplay-changing option " + key + " must default to off");
		}
		conflictsWith = List.copyOf(conflictsWith);
	}
}

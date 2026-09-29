package io.github.mojolowjo.cloudly.config;

import java.util.List;

/**
 * Every optimization Cloudly has. Adding one means adding an entry here and putting its
 * mixins in the matching package under {@code io.github.mojolowjo.cloudly.mixin}.
 */
public final class CloudlyOptions {
	public static final List<Option> ALL = List.of();

	private CloudlyOptions() {
	}
}

package io.github.mojolowjo.cloudly.bench.scenario;

import java.util.Map;

import io.github.mojolowjo.cloudly.bench.Scenario;
import io.github.mojolowjo.cloudly.bench.WorldBuilder;
import net.minecraft.server.level.ServerLevel;

/**
 * Not a benchmark: creates the template world every run starts from. A brand-new world
 * keeps generating and saving the area around spawn for minutes, which showed up as
 * stretches of slow ticks in the middle of measurements. Generating it once, letting it
 * settle, and saving it on shutdown removes that from every later run.
 */
public final class PrepareScenario implements Scenario {
	@Override
	public String name() {
		return "prepare";
	}

	@Override
	public String description() {
		return "Generate and save the template world (not a benchmark).";
	}

	@Override
	public void build(WorldBuilder world, ServerLevel level) {
		Scenario.buildPlatform(world);
	}

	@Override
	public Map<String, Object> verify(ServerLevel level) {
		return Map.of();
	}
}

package io.github.mojolowjo.cloudly.bench.scenario;

import java.util.Map;

import io.github.mojolowjo.cloudly.bench.LevelQueries;
import io.github.mojolowjo.cloudly.bench.Scenario;
import io.github.mojolowjo.cloudly.bench.WorldBuilder;
import net.minecraft.server.level.ServerLevel;

public final class IdleScenario implements Scenario {
	@Override
	public String name() {
		return "idle";
	}

	@Override
	public String description() {
		return "An empty platform: the cost of the server doing nothing.";
	}

	@Override
	public void build(WorldBuilder world, ServerLevel level) {
		Scenario.buildPlatform(world);
	}

	@Override
	public Map<String, Object> verify(ServerLevel level) {
		return Map.of("entities", LevelQueries.entityCensus(level));
	}
}

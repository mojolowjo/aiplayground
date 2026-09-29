package io.github.mojolowjo.cloudly.bench.scenario;

import java.util.Map;

import io.github.mojolowjo.cloudly.bench.LevelQueries;
import io.github.mojolowjo.cloudly.bench.Scenario;
import io.github.mojolowjo.cloudly.bench.WorldBuilder;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityTypes;

/**
 * An overcrowded animal pen: every cow pushes against its neighbors every tick. The driver
 * turns off cramming damage so the crowd stays the same size for the whole run.
 */
public final class CrammingScenario implements Scenario {
	private static final int COWS = 200;
	private static final int PEN_MIN = 10;
	private static final int PEN_SIZE = 8;
	private static final int Y = FLOOR_Y + 1;

	@Override
	public String name() {
		return "cramming";
	}

	@Override
	public String description() {
		return COWS + " cows packed into an " + PEN_SIZE + "x" + PEN_SIZE + " pen.";
	}

	@Override
	public void build(WorldBuilder world, ServerLevel level) {
		Scenario.buildPlatform(world);
		int max = PEN_MIN + PEN_SIZE - 1;
		world.fill(PEN_MIN - 1, Y, PEN_MIN - 1, max + 1, Y + 1, max + 1, "minecraft:glass");
		world.fill(PEN_MIN, Y, PEN_MIN, max, Y + 1, max, "minecraft:air");
		for (int i = 0; i < COWS; i++) {
			int x = PEN_MIN + i % PEN_SIZE;
			int z = PEN_MIN + (i / PEN_SIZE) % PEN_SIZE;
			world.summon("minecraft:cow", x + 0.5, Y, z + 0.5, "");
		}
	}

	@Override
	public Map<String, Object> verify(ServerLevel level) {
		return Map.of("cowsExpected", COWS, "cows", LevelQueries.countEntities(level, EntityTypes.COW, area()));
	}

	@Override
	public Map<String, Object> results(ServerLevel level) {
		return Map.of("cowsAtEnd", LevelQueries.countEntities(level, EntityTypes.COW, area()));
	}
}

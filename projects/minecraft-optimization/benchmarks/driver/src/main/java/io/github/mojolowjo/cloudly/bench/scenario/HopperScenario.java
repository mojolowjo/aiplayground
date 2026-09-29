package io.github.mojolowjo.cloudly.bench.scenario;

import java.util.LinkedHashMap;
import java.util.Map;

import io.github.mojolowjo.cloudly.bench.LevelQueries;
import io.github.mojolowjo.cloudly.bench.Scenario;
import io.github.mojolowjo.cloudly.bench.WorldBuilder;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;

/**
 * Hopper chains moving items from a full barrel to an empty one. The number of items that
 * arrive during measurement is exact vanilla behavior, so it doubles as a parity check:
 * an optimization that changes it has changed how hoppers work.
 */
public final class HopperScenario implements Scenario {
	private static final int CHAINS = 50;
	private static final int LENGTH = 20;
	private static final int START_X = 5;
	private static final int START_Z = 5;
	private static final int Y = FLOOR_Y + 1;

	private int deliveredBefore;

	@Override
	public String name() {
		return "hoppers";
	}

	@Override
	public String description() {
		return CHAINS + " chains of " + LENGTH + " hoppers (" + CHAINS * LENGTH + " total) moving items between barrels.";
	}

	@Override
	public void build(WorldBuilder world, ServerLevel level) {
		Scenario.buildPlatform(world);
		for (int chain = 0; chain < CHAINS; chain++) {
			int z = START_Z + chain;
			world.fill(START_X, Y, z, START_X + LENGTH - 1, Y, z, "minecraft:hopper[facing=east]");
			world.setBlock(START_X + LENGTH, Y, z, "minecraft:barrel");
			world.setBlock(START_X, Y + 1, z, "minecraft:barrel");
			for (int slot = 0; slot < 27; slot++) {
				world.run("item replace block " + START_X + " " + (Y + 1) + " " + z + " container." + slot
						+ " with minecraft:cobblestone 64");
			}
		}
	}

	@Override
	public Map<String, Object> verify(ServerLevel level) {
		int hoppers = 0;
		for (int chain = 0; chain < CHAINS; chain++) {
			for (int i = 0; i < LENGTH; i++) {
				if (LevelQueries.isBlock(level, START_X + i, Y, START_Z + chain, Blocks.HOPPER)) {
					hoppers++;
				}
			}
		}
		Map<String, Object> checks = new LinkedHashMap<>();
		checks.put("hoppersExpected", CHAINS * LENGTH);
		checks.put("hoppers", hoppers);
		checks.put("sourceItems", LevelQueries.itemsIn(level, START_X, Y + 1, START_Z));
		return checks;
	}

	@Override
	public void startMeasuring(ServerLevel level) {
		deliveredBefore = delivered(level);
	}

	@Override
	public Map<String, Object> results(ServerLevel level) {
		return Map.of("itemsDeliveredDuringMeasurement", delivered(level) - deliveredBefore);
	}

	private int delivered(ServerLevel level) {
		int total = 0;
		for (int chain = 0; chain < CHAINS; chain++) {
			total += Math.max(0, LevelQueries.itemsIn(level, START_X + LENGTH, Y, START_Z + chain));
		}
		return total;
	}
}

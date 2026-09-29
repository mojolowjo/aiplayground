package io.github.mojolowjo.cloudly.bench.scenario;

import java.util.List;
import java.util.Map;

import io.github.mojolowjo.cloudly.bench.LevelQueries;
import io.github.mojolowjo.cloudly.bench.Scenario;
import io.github.mojolowjo.cloudly.bench.WorldBuilder;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityTypes;

/** A trading hall: villagers locked in one-block cells, each next to a workstation. */
public final class VillagerScenario implements Scenario {
	private static final int COLUMNS = 20;
	private static final int ROWS = 15;
	private static final int Y = FLOOR_Y + 1;
	private static final List<String> WORKSTATIONS = List.of("lectern", "composter", "barrel", "blast_furnace",
			"smoker", "cartography_table", "fletching_table", "smithing_table", "stonecutter", "loom", "grindstone",
			"brewing_stand", "cauldron");

	@Override
	public String name() {
		return "villagers";
	}

	@Override
	public String description() {
		return COLUMNS * ROWS + " villagers in one-block trading cells, each beside a workstation.";
	}

	/**
	 * New villagers spend their first minutes searching for and walking to workstations,
	 * which costs about twice the steady-state tick time. Measure the trading hall after
	 * they've settled into their jobs.
	 */
	@Override
	public int minimumWarmupTicks() {
		return 3600;
	}

	@Override
	public void build(WorldBuilder world, ServerLevel level) {
		Scenario.buildPlatform(world);
		// A solid glass block, then carve a cell per villager: cells sit 3 apart along X
		// (wall, villager, workstation) and 2 apart along Z (shared walls).
		world.fill(2, Y, 2, cellX(COLUMNS - 1) + 2, Y + 1, cellZ(ROWS - 1) + 1, "minecraft:glass");
		int index = 0;
		for (int column = 0; column < COLUMNS; column++) {
			for (int row = 0; row < ROWS; row++) {
				int x = cellX(column);
				int z = cellZ(row);
				world.fill(x, Y, z, x, Y + 1, z, "minecraft:air");
				world.setBlock(x + 1, Y, z, "minecraft:" + WORKSTATIONS.get(index++ % WORKSTATIONS.size()));
				world.summon("minecraft:villager", x + 0.5, Y, z + 0.5, "");
			}
		}
	}

	@Override
	public Map<String, Object> verify(ServerLevel level) {
		return Map.of("villagersExpected", COLUMNS * ROWS,
				"villagers", LevelQueries.countEntities(level, EntityTypes.VILLAGER, area()));
	}

	@Override
	public Map<String, Object> results(ServerLevel level) {
		return Map.of("villagersAtEnd", LevelQueries.countEntities(level, EntityTypes.VILLAGER, area()));
	}

	private static int cellX(int column) {
		return 3 + column * 3;
	}

	private static int cellZ(int row) {
		return 3 + row * 2;
	}
}

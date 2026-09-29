package io.github.mojolowjo.cloudly.bench;

import java.util.Map;
import java.util.TreeMap;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.Container;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.block.Block;

/** Read-only checks scenarios use to verify their setup and report results. */
public final class LevelQueries {
	private LevelQueries() {
	}

	public static int countEntities(ServerLevel level, EntityType<?> type, Scenario.Area area) {
		int count = 0;
		for (Entity entity : level.getAllEntities()) {
			if (entity.getType() == type && inside(entity, area)) {
				count++;
			}
		}
		return count;
	}

	/** Entity counts by type ID across the whole level. */
	public static Map<String, Integer> entityCensus(ServerLevel level) {
		Map<String, Integer> census = new TreeMap<>();
		for (Entity entity : level.getAllEntities()) {
			census.merge(BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString(), 1, Integer::sum);
		}
		return census;
	}

	public static boolean isBlock(ServerLevel level, int x, int y, int z, Block block) {
		return level.getBlockState(new BlockPos(x, y, z)).is(block);
	}

	/** Total item count in the container at a position, or -1 if there is none. */
	public static int itemsIn(ServerLevel level, int x, int y, int z) {
		if (!(level.getBlockEntity(new BlockPos(x, y, z)) instanceof Container container)) {
			return -1;
		}
		int total = 0;
		for (int slot = 0; slot < container.getContainerSize(); slot++) {
			total += container.getItem(slot).getCount();
		}
		return total;
	}

	private static boolean inside(Entity entity, Scenario.Area area) {
		double x = entity.getX();
		double z = entity.getZ();
		return x >= area.minX() && x < area.maxX() + 1 && z >= area.minZ() && z < area.maxZ() + 1;
	}
}

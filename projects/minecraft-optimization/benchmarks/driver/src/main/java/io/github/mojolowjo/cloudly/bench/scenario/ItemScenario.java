package io.github.mojolowjo.cloudly.bench.scenario;

import java.util.List;
import java.util.Map;

import io.github.mojolowjo.cloudly.bench.LevelQueries;
import io.github.mojolowjo.cloudly.bench.Scenario;
import io.github.mojolowjo.cloudly.bench.WorldBuilder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;

/**
 * Loose items on the ground, like a farm with a full collection system. Every item is a
 * different stackable type: each one keeps looking for neighbors to merge with, but none
 * ever merge, so the load stays constant. Items never despawn.
 */
public final class ItemScenario implements Scenario {
	private static final int ITEMS = 1200;
	private static final int FIELD_MIN = 20;
	private static final int FIELD_SIZE = 16;
	private static final int Y = FLOOR_Y + 1;

	private int spawned;

	@Override
	public String name() {
		return "items";
	}

	@Override
	public String description() {
		return ITEMS + " item entities of different types on a " + FIELD_SIZE + "x" + FIELD_SIZE + " floor.";
	}

	@Override
	public void build(WorldBuilder world, ServerLevel level) {
		Scenario.buildPlatform(world);
		int max = FIELD_MIN + FIELD_SIZE - 1;
		world.fill(FIELD_MIN - 1, Y, FIELD_MIN - 1, max + 1, Y, max + 1, "minecraft:glass");
		world.fill(FIELD_MIN, Y, FIELD_MIN, max, Y, max, "minecraft:air");

		List<Item> items = BuiltInRegistries.ITEM.stream()
				.filter(item -> item != Items.AIR && item.getDefaultMaxStackSize() > 1)
				.limit(ITEMS)
				.toList();
		spawned = items.size();
		for (int i = 0; i < items.size(); i++) {
			double x = FIELD_MIN + i % FIELD_SIZE + 0.5;
			double z = FIELD_MIN + (i / FIELD_SIZE) % FIELD_SIZE + 0.5;
			String id = BuiltInRegistries.ITEM.getKey(items.get(i)).toString();
			world.summon("minecraft:item", x, Y + 0.2, z,
					"{Item:{id:\"" + id + "\",count:1},Age:-32768s,PickupDelay:32767s}");
		}
	}

	@Override
	public Map<String, Object> verify(ServerLevel level) {
		// Items behind experimental features can't be summoned, so compare with what was tried.
		return Map.of("itemsAttempted", spawned, "items", LevelQueries.countEntities(level, EntityTypes.ITEM, area()));
	}

	@Override
	public Map<String, Object> results(ServerLevel level) {
		return Map.of("itemsAtEnd", LevelQueries.countEntities(level, EntityTypes.ITEM, area()));
	}
}

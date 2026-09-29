package io.github.mojolowjo.cloudly.bench;

import java.util.Map;

import net.minecraft.server.level.ServerLevel;

/**
 * A repeatable workload. The driver force-loads {@link #area()}, calls {@link #build}, lets
 * the game warm up, then measures every tick until the tick budget is used up or
 * {@link #isComplete} returns true.
 */
public interface Scenario {
	/** The platform most scenarios build on: 4×4 chunks high in the sky, away from terrain. */
	Area PLATFORM = new Area(0, 0, 63, 63);
	int FLOOR_Y = 199;

	String name();

	/** One sentence describing the workload, copied into the results. */
	String description();

	/** Block area that must be loaded before {@link #build} runs, and stays loaded. */
	default Area area() {
		return PLATFORM;
	}

	void build(WorldBuilder world, ServerLevel level);

	/** Checks that the build worked; the numbers are copied into the results. */
	Map<String, Object> verify(ServerLevel level);

	/** Called on the first measured tick. */
	default void startMeasuring(ServerLevel level) {
	}

	/** Lets a scenario end measurement early, for work that finishes on its own. */
	default boolean isComplete(ServerLevel level) {
		return false;
	}

	/** Extra numbers for the results, gathered after measurement. */
	default Map<String, Object> results(ServerLevel level) {
		return Map.of();
	}

	/** Clears the platform volume and lays a floor, shared by most scenarios. */
	static void buildPlatform(WorldBuilder world) {
		Area a = PLATFORM;
		world.fill(a.minX(), FLOOR_Y, a.minZ(), a.maxX(), FLOOR_Y + 16, a.maxZ(), "minecraft:air");
		world.fill(a.minX(), FLOOR_Y, a.minZ(), a.maxX(), FLOOR_Y, a.maxZ(), "minecraft:smooth_stone");
	}

	record Area(int minX, int minZ, int maxX, int maxZ) {
	}
}

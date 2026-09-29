package io.github.mojolowjo.cloudly.bench.scenario;

import java.util.LinkedHashMap;
import java.util.Map;

import io.github.mojolowjo.cloudly.bench.Scenario;
import io.github.mojolowjo.cloudly.bench.WorldBuilder;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.TicketType;
import net.minecraft.world.level.ChunkPos;

/**
 * Generates a square of new chunks far from spawn, the way a player arriving there would:
 * one loading ticket, generation in the background, the server ticking normally meanwhile.
 * Measures both how fast chunks appear and how much ticks slow down while they do.
 * Measurement ends when the last chunk is ready, so the tick budget is only a safety cap.
 */
public final class WorldgenScenario implements Scenario {
	private static final int RADIUS = 12;
	private static final int SIDE = RADIUS * 2 + 1;
	private static final int ORIGIN_CHUNK = 1000;

	private long startNanos;
	private long endNanos;
	private int ready;

	@Override
	public String name() {
		return "worldgen";
	}

	@Override
	public String description() {
		return "Generate " + SIDE * SIDE + " new chunks (" + SIDE + "x" + SIDE + ") far from spawn.";
	}

	@Override
	public void build(WorldBuilder world, ServerLevel level) {
	}

	@Override
	public Map<String, Object> verify(ServerLevel level) {
		return Map.of("chunksRequested", SIDE * SIDE);
	}

	@Override
	public void startMeasuring(ServerLevel level) {
		startNanos = System.nanoTime();
		// Unlike ServerLevel.setChunkForced, a ticket doesn't block the tick until the chunks
		// exist. A radius-R ticket brings every chunk within R of the center to full status.
		ChunkPos center = new ChunkPos(ORIGIN_CHUNK + RADIUS, ORIGIN_CHUNK + RADIUS);
		level.getChunkSource().addTicketWithRadius(TicketType.FORCED, center, RADIUS);
	}

	@Override
	public boolean isComplete(ServerLevel level) {
		// hasChunk() only says a chunk is scheduled; getChunkNow() is non-null once it exists.
		ready = 0;
		for (int x = 0; x < SIDE; x++) {
			for (int z = 0; z < SIDE; z++) {
				if (level.getChunkSource().getChunkNow(ORIGIN_CHUNK + x, ORIGIN_CHUNK + z) != null) {
					ready++;
				}
			}
		}
		if (ready == SIDE * SIDE && endNanos == 0) {
			endNanos = System.nanoTime();
		}
		return endNanos != 0;
	}

	@Override
	public Map<String, Object> results(ServerLevel level) {
		Map<String, Object> results = new LinkedHashMap<>();
		results.put("chunksReady", ready);
		results.put("complete", endNanos != 0);
		if (endNanos != 0) {
			double seconds = (endNanos - startNanos) / 1e9;
			results.put("seconds", seconds);
			results.put("chunksPerSecond", SIDE * SIDE / seconds);
		}
		return results;
	}
}

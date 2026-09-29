package io.github.mojolowjo.cloudly.bench;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.MinecraftServer;

/**
 * Builds scenarios with ordinary game commands. Commands change far less between Minecraft
 * versions than the game's internal code, so scenarios survive updates better this way.
 */
public final class WorldBuilder {
	/** The default {@code max_block_modifications} game rule: the most one fill may change. */
	private static final int MAX_FILL_VOLUME = 32768;

	private final MinecraftServer server;
	private final CommandSourceStack source;
	private int commandCount;

	WorldBuilder(MinecraftServer server) {
		this.server = server;
		this.source = server.createCommandSourceStack().withSuppressedOutput();
	}

	public void run(String command) {
		server.getCommands().performPrefixedCommand(source, command);
		commandCount++;
	}

	public void setBlock(int x, int y, int z, String block) {
		run("setblock " + x + " " + y + " " + z + " " + block);
	}

	/** Fills a box of any size, split into pieces small enough for the fill command. */
	public void fill(int x1, int y1, int z1, int x2, int y2, int z2, String block) {
		int minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
		int minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
		int minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
		int depth = maxZ - minZ + 1;
		int sliceWidth = Math.max(1, MAX_FILL_VOLUME / depth);
		for (int y = minY; y <= maxY; y++) {
			for (int x = minX; x <= maxX; x += sliceWidth) {
				int endX = Math.min(maxX, x + sliceWidth - 1);
				run("fill " + x + " " + y + " " + minZ + " " + endX + " " + y + " " + maxZ + " " + block);
			}
		}
	}

	public void summon(String entity, double x, double y, double z, String data) {
		run("summon " + entity + " " + x + " " + y + " " + z + (data.isEmpty() ? "" : " " + data));
	}

	int commandCount() {
		return commandCount;
	}
}

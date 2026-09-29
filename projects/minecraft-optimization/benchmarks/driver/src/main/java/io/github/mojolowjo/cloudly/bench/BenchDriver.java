package io.github.mojolowjo.cloudly.bench;

import java.io.IOException;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.ParseException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import com.google.gson.GsonBuilder;
import io.github.mojolowjo.cloudly.bench.scenario.CrammingScenario;
import io.github.mojolowjo.cloudly.bench.scenario.HopperScenario;
import io.github.mojolowjo.cloudly.bench.scenario.IdleScenario;
import io.github.mojolowjo.cloudly.bench.scenario.ItemScenario;
import io.github.mojolowjo.cloudly.bench.scenario.PrepareScenario;
import io.github.mojolowjo.cloudly.bench.scenario.VillagerScenario;
import io.github.mojolowjo.cloudly.bench.scenario.WorldgenScenario;
import jdk.jfr.Configuration;
import jdk.jfr.Recording;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.SharedConstants;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.gamerules.GameRules;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Runs one benchmark scenario on a dedicated server, writes the results as JSON (plus a JFR
 * recording of the measured window), then stops the server.
 */
public final class BenchDriver implements ModInitializer {
	private static final Logger LOGGER = LoggerFactory.getLogger("CloudlyBench");
	private static final int CHUNK_LOAD_TIMEOUT_TICKS = 6000;
	private static final Map<String, Supplier<Scenario>> SCENARIOS = new LinkedHashMap<>();

	static {
		SCENARIOS.put("idle", IdleScenario::new);
		SCENARIOS.put("villagers", VillagerScenario::new);
		SCENARIOS.put("cramming", CrammingScenario::new);
		SCENARIOS.put("items", ItemScenario::new);
		SCENARIOS.put("hoppers", HopperScenario::new);
		SCENARIOS.put("worldgen", WorldgenScenario::new);
		SCENARIOS.put("prepare", PrepareScenario::new);
	}

	private enum Phase { PREPARE, LOAD_CHUNKS, WARM_UP, MEASURE, DONE }

	private BenchSettings settings;
	private Scenario scenario;
	private Phase phase = Phase.PREPARE;
	private int phaseTicks;
	private long tickStartNanos;
	private long[] tickNanos;
	private int measured;
	private long measureStartNanos;
	private long gcCountBefore;
	private long gcMillisBefore;
	private Recording recording;
	private final Map<String, Object> result = new LinkedHashMap<>();

	@Override
	public void onInitialize() {
		settings = BenchSettings.fromSystemProperties();
		if (settings == null) {
			return;
		}
		Supplier<Scenario> factory = SCENARIOS.get(settings.scenario());
		if (factory == null) {
			throw new IllegalArgumentException("Unknown benchmark scenario '" + settings.scenario()
					+ "'. Known: " + SCENARIOS.keySet());
		}
		scenario = factory.get();
		tickNanos = new long[settings.measureTicks()];
		LOGGER.info("Benchmark '{}' armed: {} warm-up ticks, up to {} measured ticks", scenario.name(),
				settings.warmupTicks(), settings.measureTicks());
		ServerLifecycleEvents.SERVER_STARTED.register(server -> result.put("startupMillis",
				System.currentTimeMillis() - ManagementFactory.getRuntimeMXBean().getStartTime()));
		ServerTickEvents.START_SERVER_TICK.register(server -> tickStartNanos = System.nanoTime());
		ServerTickEvents.END_SERVER_TICK.register(this::endTick);
	}

	private void endTick(MinecraftServer server) {
		long tickDuration = System.nanoTime() - tickStartNanos;
		ServerLevel level = server.overworld();
		phaseTicks++;
		switch (phase) {
			case PREPARE -> prepare(server, level);
			case LOAD_CHUNKS -> {
				if (areaLoaded(level)) {
					build(server, level);
				} else if (phaseTicks > CHUNK_LOAD_TIMEOUT_TICKS) {
					fail(server, "Scenario area did not load within " + CHUNK_LOAD_TIMEOUT_TICKS + " ticks");
				}
			}
			case WARM_UP -> {
				if (phaseTicks >= warmupTicks()) {
					startMeasuring(level);
				}
			}
			case MEASURE -> {
				tickNanos[measured++] = tickDuration;
				if (measured == tickNanos.length || scenario.isComplete(level)) {
					finish(server, level);
				}
			}
			case DONE -> {
			}
		}
	}

	private void prepare(MinecraftServer server, ServerLevel level) {
		GameRules rules = server.getGameRules();
		rules.set(GameRules.ADVANCE_TIME, false, server);
		rules.set(GameRules.ADVANCE_WEATHER, false, server);
		rules.set(GameRules.SPAWN_MOBS, false, server);
		rules.set(GameRules.SPAWN_PATROLS, false, server);
		rules.set(GameRules.SPAWN_PHANTOMS, false, server);
		rules.set(GameRules.SPAWN_WANDERING_TRADERS, false, server);
		rules.set(GameRules.MAX_ENTITY_CRAMMING, 0, server);
		WorldBuilder commands = new WorldBuilder(server);
		commands.run("time set noon");
		commands.run("weather clear");

		Scenario.Area area = scenario.area();
		for (int cx = area.minX() >> 4; cx <= area.maxX() >> 4; cx++) {
			for (int cz = area.minZ() >> 4; cz <= area.maxZ() >> 4; cz++) {
				level.setChunkForced(cx, cz, true);
			}
		}
		nextPhase(Phase.LOAD_CHUNKS);
	}

	private boolean areaLoaded(ServerLevel level) {
		Scenario.Area area = scenario.area();
		for (int cx = area.minX() >> 4; cx <= area.maxX() >> 4; cx++) {
			for (int cz = area.minZ() >> 4; cz <= area.maxZ() >> 4; cz++) {
				if (level.getChunkSource().getChunkNow(cx, cz) == null) {
					return false;
				}
			}
		}
		return true;
	}

	private void build(MinecraftServer server, ServerLevel level) {
		long start = System.nanoTime();
		WorldBuilder world = new WorldBuilder(server);
		scenario.build(world, level);
		result.put("buildCommands", world.commandCount());
		result.put("buildMillis", (System.nanoTime() - start) / 1_000_000);
		LOGGER.info("Built scenario '{}' with {} commands", scenario.name(), world.commandCount());
		nextPhase(Phase.WARM_UP);
	}

	private void startMeasuring(ServerLevel level) {
		result.put("setup", scenario.verify(level));
		result.put("entitiesAtStart", LevelQueries.entityCensus(level));
		if (settings.recordJfr()) {
			try {
				recording = new Recording(Configuration.getConfiguration("profile"));
				recording.setName("cloudly-bench-" + scenario.name());
				recording.start();
			} catch (IOException | ParseException e) {
				LOGGER.warn("Could not start JFR recording", e);
			}
		}
		gcCountBefore = gcCount();
		gcMillisBefore = gcMillis();
		scenario.startMeasuring(level);
		measureStartNanos = System.nanoTime();
		nextPhase(Phase.MEASURE);
	}

	private void finish(MinecraftServer server, ServerLevel level) {
		double wallSeconds = (System.nanoTime() - measureStartNanos) / 1e9;
		if (recording != null) {
			recording.stop();
			try {
				recording.dump(jfrPath());
				result.put("jfr", jfrPath().getFileName().toString());
			} catch (IOException e) {
				LOGGER.warn("Could not save JFR recording", e);
			}
			recording.close();
		}
		result.put("ticksMeasured", measured);
		result.put("wallSeconds", wallSeconds);
		result.put("ticksPerSecond", measured / wallSeconds);
		result.put("mspt", TickStats.summarize(tickNanos, measured));
		result.put("gcCount", gcCount() - gcCountBefore);
		result.put("gcMillis", gcMillis() - gcMillisBefore);
		Runtime runtime = Runtime.getRuntime();
		result.put("heapUsedMbAtEnd", (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024));
		result.put("scenarioResults", scenario.results(level));
		// Memory still in use after a full collection: what the world actually needs, without
		// the garbage that happens to be waiting. Measured last so the pause affects nothing.
		System.gc();
		long heapAfterGc = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getUsed();
		result.put("heapAfterGcMb", heapAfterGc / (1024 * 1024));
		result.put("entitiesAtEnd", LevelQueries.entityCensus(level));
		result.put("tickMillis", TickStats.toMillis(tickNanos, measured));
		write(server, "ok");
	}

	private void fail(MinecraftServer server, String reason) {
		LOGGER.error("Benchmark failed: {}", reason);
		result.put("error", reason);
		write(server, "failed");
	}

	private void write(MinecraftServer server, String status) {
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("status", status);
		out.put("scenario", scenario.name());
		out.put("description", scenario.description());
		out.put("stack", settings.stack());
		out.put("run", settings.run());
		out.put("finishedAt", Instant.now().toString());
		out.put("minecraft", SharedConstants.getCurrentVersion().name());
		out.put("mods", modList());
		out.put("jvm", jvmInfo());
		out.put("warmupTicks", warmupTicks());
		out.putAll(result);
		try {
			Path output = settings.output().toAbsolutePath();
			Files.createDirectories(output.getParent());
			Files.writeString(output, new GsonBuilder().setPrettyPrinting().serializeSpecialFloatingPointValues()
					.create().toJson(out));
			LOGGER.info("Benchmark '{}' {}: results written to {}", scenario.name(), status, output);
		} catch (IOException e) {
			LOGGER.error("Could not write benchmark results", e);
		}
		phase = Phase.DONE;
		server.halt(false);
	}

	private Path jfrPath() {
		String name = settings.output().getFileName().toString().replaceFirst("\\.json$", "") + ".jfr";
		return settings.output().toAbsolutePath().resolveSibling(name);
	}

	private int warmupTicks() {
		return Math.max(settings.warmupTicks(), scenario.minimumWarmupTicks());
	}

	private void nextPhase(Phase next) {
		phase = next;
		phaseTicks = 0;
	}

	/** Top-level mods only; the dozens of Fabric API modules are folded into Fabric API. */
	private static Map<String, String> modList() {
		Map<String, String> mods = new LinkedHashMap<>();
		for (ModContainer mod : FabricLoader.getInstance().getAllMods()) {
			if (mod.getContainingMod().isEmpty()) {
				mods.put(mod.getMetadata().getId(), mod.getMetadata().getVersion().getFriendlyString());
			}
		}
		return mods;
	}

	private static Map<String, Object> jvmInfo() {
		Map<String, Object> jvm = new LinkedHashMap<>();
		jvm.put("version", System.getProperty("java.vm.version"));
		jvm.put("vendor", System.getProperty("java.vm.vendor"));
		List<String> collectors = new ArrayList<>();
		for (GarbageCollectorMXBean gc : ManagementFactory.getGarbageCollectorMXBeans()) {
			collectors.add(gc.getName());
		}
		jvm.put("garbageCollectors", collectors);
		jvm.put("maxHeapMb", Runtime.getRuntime().maxMemory() / (1024 * 1024));
		jvm.put("cpus", Runtime.getRuntime().availableProcessors());
		// Benchmark settings are already recorded separately; network and certificate settings
		// describe the machine's environment, not the benchmark.
		jvm.put("arguments", ManagementFactory.getRuntimeMXBean().getInputArguments().stream()
				.filter(arg -> !arg.startsWith("-D" + BenchSettings.PREFIX))
				.filter(arg -> !arg.matches("-D(javax\\.net\\.ssl|https?\\.|jdk\\.http\\.auth).*"))
				.toList());
		return jvm;
	}

	private static long gcCount() {
		long total = 0;
		for (GarbageCollectorMXBean gc : ManagementFactory.getGarbageCollectorMXBeans()) {
			total += Math.max(0, gc.getCollectionCount());
		}
		return total;
	}

	private static long gcMillis() {
		long total = 0;
		for (GarbageCollectorMXBean gc : ManagementFactory.getGarbageCollectorMXBeans()) {
			total += Math.max(0, gc.getCollectionTime());
		}
		return total;
	}
}

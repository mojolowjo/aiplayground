package io.github.mojolowjo.cloudly.bench;

import java.nio.file.Path;

/** Benchmark settings, read from {@code -Dcloudly.bench.*} system properties. */
record BenchSettings(String scenario, String stack, int run, int warmupTicks, int measureTicks, Path output,
		boolean recordJfr) {
	static final String PREFIX = "cloudly.bench.";

	/** Returns null when no scenario was requested, so the driver stays inactive. */
	static BenchSettings fromSystemProperties() {
		String scenario = System.getProperty(PREFIX + "scenario");
		if (scenario == null || scenario.isBlank()) {
			return null;
		}
		return new BenchSettings(
				scenario,
				System.getProperty(PREFIX + "stack", "unnamed"),
				Integer.getInteger(PREFIX + "run", 1),
				Integer.getInteger(PREFIX + "warmup", 600),
				Integer.getInteger(PREFIX + "measure", 1200),
				Path.of(System.getProperty(PREFIX + "output", "bench-result.json")),
				Boolean.parseBoolean(System.getProperty(PREFIX + "jfr", "true")));
	}
}

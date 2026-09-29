package io.github.mojolowjo.cloudly.bench;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/** Summary statistics for measured tick durations, reported in milliseconds. */
final class TickStats {
	private TickStats() {
	}

	static Map<String, Double> summarize(long[] nanos, int count) {
		Map<String, Double> stats = new LinkedHashMap<>();
		if (count == 0) {
			return stats;
		}
		long[] sorted = Arrays.copyOf(nanos, count);
		Arrays.sort(sorted);
		double sum = 0;
		for (long value : sorted) {
			sum += value;
		}
		double mean = sum / count;
		double squares = 0;
		for (long value : sorted) {
			squares += (value - mean) * (value - mean);
		}
		stats.put("mean", millis(mean));
		stats.put("median", millis(percentile(sorted, 50)));
		stats.put("p95", millis(percentile(sorted, 95)));
		stats.put("p99", millis(percentile(sorted, 99)));
		stats.put("min", millis(sorted[0]));
		stats.put("max", millis(sorted[count - 1]));
		stats.put("stddev", millis(Math.sqrt(squares / count)));
		return stats;
	}

	static double[] toMillis(long[] nanos, int count) {
		double[] out = new double[count];
		for (int i = 0; i < count; i++) {
			out[i] = Math.round(nanos[i] / 1e3) / 1e3;
		}
		return out;
	}

	/** Nearest-rank percentile. */
	private static double percentile(long[] sorted, double percent) {
		int rank = (int) Math.ceil(percent / 100 * sorted.length);
		return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
	}

	private static double millis(double nanos) {
		return Math.round(nanos / 1e3) / 1e3;
	}
}

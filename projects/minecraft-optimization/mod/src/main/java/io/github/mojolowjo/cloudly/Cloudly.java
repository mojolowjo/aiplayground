package io.github.mojolowjo.cloudly;

import io.github.mojolowjo.cloudly.config.CloudlyConfig;
import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class Cloudly implements ModInitializer {
	public static final String MOD_ID = "cloudly";
	private static final Logger LOGGER = LoggerFactory.getLogger("Cloudly");

	@Override
	public void onInitialize() {
		CloudlyConfig config = CloudlyConfig.current();
		long enabled = config.decisions().values().stream().filter(CloudlyConfig.Decision::enabled).count();
		LOGGER.info("Cloudly loaded: {} of {} optimizations on", enabled, config.decisions().size());
		for (CloudlyConfig.Decision decision : config.decisions().values()) {
			LOGGER.info("  {} = {} ({})", decision.option().key(), decision.enabled(), decision.reason());
		}
	}
}

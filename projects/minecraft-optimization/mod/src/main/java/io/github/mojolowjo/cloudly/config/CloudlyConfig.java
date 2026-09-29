package io.github.mojolowjo.cloudly.config;

import java.io.IOException;
import java.io.Reader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.function.Predicate;

/**
 * The player's choices from {@code config/cloudly.properties}, resolved against the known
 * options and the installed mods.
 */
public final class CloudlyConfig {
	private static volatile CloudlyConfig current;

	private final Map<String, Decision> decisions;
	private final List<String> warnings;

	private CloudlyConfig(Map<String, Decision> decisions, List<String> warnings) {
		this.decisions = Collections.unmodifiableMap(decisions);
		this.warnings = List.copyOf(warnings);
	}

	/** Whether an option ended up on, and why. */
	public record Decision(Option option, boolean enabled, String reason) {
	}

	/**
	 * Resolves every option. An explicit player choice always wins; otherwise a conflicting
	 * mod turns the option off; otherwise the option's default applies.
	 */
	public static CloudlyConfig resolve(String fileContents, List<Option> options, Predicate<String> isModLoaded) {
		List<String> warnings = new ArrayList<>();
		Properties properties = new Properties();
		try (Reader reader = new StringReader(fileContents)) {
			properties.load(reader);
		} catch (IOException | IllegalArgumentException e) {
			warnings.add("Could not read cloudly.properties, using defaults: " + e.getMessage());
			properties.clear();
		}

		Map<String, Option> byKey = new LinkedHashMap<>();
		for (Option option : options) {
			byKey.put(option.key(), option);
		}
		for (String key : properties.stringPropertyNames()) {
			if (!byKey.containsKey(key)) {
				warnings.add("Unknown option '" + key + "' in cloudly.properties, ignoring it");
			}
		}

		Map<String, Decision> decisions = new LinkedHashMap<>();
		for (Option option : options) {
			String value = properties.getProperty(option.key());
			Boolean explicit = parseBoolean(value);
			if (value != null && explicit == null) {
				warnings.add("Option '" + option.key() + "' must be true or false, not '" + value.trim() + "'");
			}

			Decision decision;
			if (explicit != null) {
				decision = new Decision(option, explicit, "set in cloudly.properties");
			} else {
				Optional<String> conflict = option.conflictsWith().stream().filter(isModLoaded).findFirst();
				decision = conflict
						.map(mod -> new Decision(option, false, "off because " + mod + " is installed"))
						.orElseGet(() -> new Decision(option, option.defaultEnabled(), "default"));
			}
			decisions.put(option.key(), decision);
		}
		return new CloudlyConfig(decisions, warnings);
	}

	/** Reads the config file, creating it with every option listed if it doesn't exist yet. */
	public static CloudlyConfig load(Path file, List<Option> options, Predicate<String> isModLoaded) {
		String contents = "";
		List<String> ioWarnings = new ArrayList<>();
		try {
			if (Files.exists(file)) {
				contents = Files.readString(file, StandardCharsets.ISO_8859_1);
			} else {
				Files.createDirectories(file.getParent());
				Files.writeString(file, defaultFile(options), StandardCharsets.ISO_8859_1);
			}
		} catch (IOException e) {
			ioWarnings.add("Could not access " + file + ", using defaults: " + e.getMessage());
		}
		CloudlyConfig config = resolve(contents, options, isModLoaded);
		if (ioWarnings.isEmpty()) {
			return config;
		}
		List<String> warnings = new ArrayList<>(ioWarnings);
		warnings.addAll(config.warnings);
		return new CloudlyConfig(config.decisions, warnings);
	}

	/** The text of a fresh config file: every option commented out at its default. */
	public static String defaultFile(List<Option> options) {
		StringBuilder out = new StringBuilder();
		out.append("# Cloudly settings. Each optimization can be switched on or off.\n");
		out.append("# Remove the '#' in front of a line and set it to true or false to override\n");
		out.append("# the default. Changes take effect the next time the game starts.\n");
		for (Option option : options) {
			out.append('\n');
			out.append("# ").append(option.description()).append('\n');
			if (option.changesGameplay()) {
				out.append("# Changes gameplay compared to vanilla.\n");
			}
			if (!option.conflictsWith().isEmpty()) {
				out.append("# Off by default while any of these mods is installed: ")
						.append(String.join(", ", option.conflictsWith())).append('\n');
			}
			out.append('#').append(option.key()).append('=').append(option.defaultEnabled()).append('\n');
		}
		return out.toString();
	}

	/**
	 * Finds the option controlling a mixin, by the longest option key that is a package
	 * prefix of the mixin's name relative to the mixin root package.
	 */
	public Optional<Decision> decisionForMixin(String relativeMixinName) {
		Decision best = null;
		for (Decision decision : decisions.values()) {
			String prefix = decision.option().key() + ".";
			if (relativeMixinName.startsWith(prefix)
					&& (best == null || decision.option().key().length() > best.option().key().length())) {
				best = decision;
			}
		}
		return Optional.ofNullable(best);
	}

	public Map<String, Decision> decisions() {
		return decisions;
	}

	public List<String> warnings() {
		return warnings;
	}

	public static CloudlyConfig current() {
		return current;
	}

	static void setCurrent(CloudlyConfig config) {
		current = config;
	}

	private static Boolean parseBoolean(String value) {
		if (value == null) {
			return null;
		}
		return switch (value.trim().toLowerCase()) {
			case "true" -> Boolean.TRUE;
			case "false" -> Boolean.FALSE;
			default -> null;
		};
	}
}

package io.github.mojolowjo.cloudly.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CloudlyConfigTest {
	private static final Option ENTITY = new Option("entity", true, false, "Entity tweaks", List.of());
	private static final Option CRAMMING = new Option("entity.cramming", true, false, "Faster cramming",
			List.of("othermod"));
	private static final Option ACTIVATION = new Option("entity.activation", false, true,
			"Tick distant mobs less", List.of());
	private static final List<Option> OPTIONS = List.of(ENTITY, CRAMMING, ACTIVATION);

	@Test
	void defaultsApplyWhenFileIsEmpty() {
		CloudlyConfig config = CloudlyConfig.resolve("", OPTIONS, mod -> false);
		assertTrue(config.decisions().get("entity.cramming").enabled());
		assertFalse(config.decisions().get("entity.activation").enabled());
		assertTrue(config.warnings().isEmpty());
	}

	@Test
	void explicitChoiceWinsOverDefault() {
		CloudlyConfig config = CloudlyConfig.resolve("entity.cramming=false\nentity.activation = TRUE\n", OPTIONS,
				mod -> false);
		assertFalse(config.decisions().get("entity.cramming").enabled());
		assertTrue(config.decisions().get("entity.activation").enabled());
	}

	@Test
	void conflictingModTurnsOptionOffUnlessPlayerOverrides() {
		CloudlyConfig byDefault = CloudlyConfig.resolve("", OPTIONS, Set.of("othermod")::contains);
		assertFalse(byDefault.decisions().get("entity.cramming").enabled());
		assertEquals("off because othermod is installed", byDefault.decisions().get("entity.cramming").reason());

		CloudlyConfig forced = CloudlyConfig.resolve("entity.cramming=true", OPTIONS, Set.of("othermod")::contains);
		assertTrue(forced.decisions().get("entity.cramming").enabled());
	}

	@Test
	void badValuesAndUnknownKeysWarnAndFallBack() {
		CloudlyConfig config = CloudlyConfig.resolve("entity.cramming=maybe\nnot.a.real.option=true\n", OPTIONS,
				mod -> false);
		assertTrue(config.decisions().get("entity.cramming").enabled());
		assertEquals(2, config.warnings().size());
	}

	@Test
	void mixinUsesMostSpecificOption() {
		CloudlyConfig config = CloudlyConfig.resolve("entity=false", OPTIONS, mod -> false);
		assertEquals("entity.cramming",
				config.decisionForMixin("entity.cramming.EntityPushMixin").orElseThrow().option().key());
		assertEquals("entity", config.decisionForMixin("entity.OtherMixin").orElseThrow().option().key());
		assertTrue(config.decisionForMixin("world.SomeMixin").isEmpty());
		// "entity.crammingextra" must not match the "entity.cramming" option.
		assertEquals("entity", config.decisionForMixin("entity.crammingextra.XMixin").orElseThrow().option().key());
	}

	@Test
	void gameplayChangingOptionsCannotDefaultToOn() {
		assertThrows(IllegalArgumentException.class, () -> new Option("x", true, true, "bad", List.of()));
	}

	@Test
	void missingFileIsCreatedAndReadsBackAsDefaults(@TempDir Path dir) throws Exception {
		Path file = dir.resolve("config").resolve("cloudly.properties");
		CloudlyConfig first = CloudlyConfig.load(file, OPTIONS, mod -> false);
		assertTrue(Files.exists(file));
		assertTrue(Files.readString(file).contains("#entity.activation=false"));

		CloudlyConfig second = CloudlyConfig.load(file, OPTIONS, mod -> false);
		assertEquals(first.decisions(), second.decisions());
		assertTrue(second.warnings().isEmpty());
	}
}

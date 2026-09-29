package io.github.mojolowjo.cloudly.config;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import net.fabricmc.loader.api.FabricLoader;
import org.objectweb.asm.tree.ClassNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.extensibility.IMixinConfigPlugin;
import org.spongepowered.asm.mixin.extensibility.IMixinInfo;

/**
 * Loads the config before any mixin is applied and skips the mixins of every optimization
 * that is switched off.
 */
public final class CloudlyMixinPlugin implements IMixinConfigPlugin {
	private static final Logger LOGGER = LoggerFactory.getLogger("Cloudly");

	private CloudlyConfig config;
	private String mixinPackage;

	@Override
	public void onLoad(String mixinPackage) {
		this.mixinPackage = mixinPackage + ".";
		FabricLoader loader = FabricLoader.getInstance();
		config = CloudlyConfig.load(loader.getConfigDir().resolve("cloudly.properties"), CloudlyOptions.ALL,
				loader::isModLoaded);
		CloudlyConfig.setCurrent(config);
		config.warnings().forEach(LOGGER::warn);
	}

	@Override
	public boolean shouldApplyMixin(String targetClassName, String mixinClassName) {
		String relative = mixinClassName.startsWith(mixinPackage)
				? mixinClassName.substring(mixinPackage.length())
				: mixinClassName;
		Optional<CloudlyConfig.Decision> decision = config.decisionForMixin(relative);
		if (decision.isEmpty()) {
			// Every mixin must belong to an option so players can always switch it off.
			throw new IllegalStateException("Cloudly mixin " + mixinClassName + " has no matching option");
		}
		return decision.get().enabled();
	}

	@Override
	public String getRefMapperConfig() {
		return null;
	}

	@Override
	public void acceptTargets(Set<String> myTargets, Set<String> otherTargets) {
	}

	@Override
	public List<String> getMixins() {
		return null;
	}

	@Override
	public void preApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {
	}

	@Override
	public void postApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {
	}
}

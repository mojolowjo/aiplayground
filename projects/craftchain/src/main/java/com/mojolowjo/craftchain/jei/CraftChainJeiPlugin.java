package com.mojolowjo.craftchain.jei;

import com.mojolowjo.craftchain.CraftChain;
import mezz.jei.api.IModPlugin;
import mezz.jei.api.JeiPlugin;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.resources.ResourceLocation;
import org.jetbrains.annotations.Nullable;

/**
 * JEI finds this class through the {@link JeiPlugin} annotation. All we want from JEI is its
 * runtime, which tells us which ingredient the mouse is over.
 */
@JeiPlugin
public final class CraftChainJeiPlugin implements IModPlugin {
    // fromNamespaceAndPath exists on Forge 47.3+ (the constructor is deprecated there); mods.toml requires 47.3.25+.
    private static final ResourceLocation UID = ResourceLocation.fromNamespaceAndPath(CraftChain.MOD_ID, "jei_plugin");

    @Nullable
    private static volatile IJeiRuntime runtime;

    @Override
    public ResourceLocation getPluginUid() {
        return UID;
    }

    @Override
    public void onRuntimeAvailable(IJeiRuntime jeiRuntime) {
        runtime = jeiRuntime;
        CraftChain.LOGGER.info("JEI runtime available");
    }

    @Override
    public void onRuntimeUnavailable() {
        runtime = null;
    }

    @Nullable
    public static IJeiRuntime runtime() {
        return runtime;
    }
}

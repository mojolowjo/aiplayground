package com.mojolowjo.craftchain;

import com.mojolowjo.craftchain.pins.PinnedList;
import com.mojolowjo.craftchain.pins.PinnedOverlay;
import com.mojang.logging.LogUtils;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterGuiOverlaysEvent;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.config.ModConfig;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;

/**
 * Mod entry point. Everything is client side; see {@code clientSideOnly=true} in mods.toml,
 * which also makes Forge skip loading this mod on dedicated servers.
 */
@Mod(CraftChain.MOD_ID)
public final class CraftChain {
    public static final String MOD_ID = "craftchain";
    public static final Logger LOGGER = LogUtils.getLogger();

    public CraftChain(FMLJavaModLoadingContext context) {
        context.registerConfig(ModConfig.Type.CLIENT, ClientConfig.SPEC);
        DistExecutor.unsafeRunWhenOn(Dist.CLIENT, () -> () -> clientInit(context.getModEventBus()));
    }

    private static void clientInit(IEventBus modBus) {
        modBus.addListener((RegisterKeyMappingsEvent e) -> Keybinds.register(e));
        modBus.addListener((RegisterGuiOverlaysEvent e) -> e.registerAboveAll("pinned_list", new PinnedOverlay()));
        MinecraftForge.EVENT_BUS.register(new ClientEvents());
        PinnedList.get().load();
        LOGGER.info("CraftChain client hooks registered");
    }
}

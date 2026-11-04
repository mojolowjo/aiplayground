package com.mojolowjo.dataexport;

import com.mojang.logging.LogUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Mod;
import org.slf4j.Logger;

import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;

/**
 * Data Export: a client-only mod. {@code /dataexport [name]} writes everything the client knows
 * about the pack's game data to {@code <game dir>/dataexport/<name>/}. See README.md.
 */
@Mod(DataExport.MOD_ID)
public final class DataExport {
    public static final String MOD_ID = "dataexport";
    public static final Logger LOGGER = LogUtils.getLogger();

    public DataExport() {
        MinecraftForge.EVENT_BUS.addListener(this::registerCommands);
        LOGGER.info("[dataexport] loaded; type /dataexport in a world to write the pack's data");
    }

    private void registerCommands(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("dataexport")
                .executes(ctx -> run(null))
                .then(Commands.argument("name", StringArgumentType.word())
                        .executes(ctx -> run(StringArgumentType.getString(ctx, "name")))));
    }

    private static int run(String name) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || mc.player == null) {
            say(mc, "dataexport: join a world or server first");
            return 0;
        }
        String folder = name != null ? Names.sanitize(name) : Names.sanitize(Exporter.defaultName(mc));
        say(mc, "dataexport: writing dataexport/" + folder + " ... the game may pause a few seconds");
        // One tick later, so the line above is on screen before the client thread is busy.
        mc.tell(() -> {
            Exporter.Report r;
            try {
                r = new Exporter(mc, folder).run();
            } catch (Throwable t) {
                LOGGER.error("[dataexport] export failed", t);
                say(mc, "dataexport FAILED: " + t + " (see latest.log)");
                return;
            }
            for (String line : r.lines()) say(mc, line);
        });
        return 1;
    }

    static void say(Minecraft mc, String text) {
        LOGGER.info("[dataexport] {}", text);
        if (mc.player != null) mc.player.displayClientMessage(Component.literal(text), false);
    }
}

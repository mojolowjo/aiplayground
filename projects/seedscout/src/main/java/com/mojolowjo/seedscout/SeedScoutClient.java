package com.mojolowjo.seedscout;

import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraftforge.client.event.ClientPlayerNetworkEvent;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.GameShuttingDownEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.fml.ModLoadingContext;
import net.minecraftforge.fml.config.ModConfig;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.lwjgl.glfw.GLFW;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** The client half: config, key, commands, the request tick, process and link life cycle. */
public final class SeedScoutClient {
    private SeedScoutClient() {}

    public static final KeyMapping TOGGLE_KEY = new KeyMapping("key.seedscout.toggle", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_X, "key.categories.seedscout");
    private static int tickCounter;
    private static Thread connector;

    public static void init() {
        ModLoadingContext.get().registerConfig(ModConfig.Type.CLIENT, ClientConfig.SPEC, ClientConfig.FILE);
        FMLJavaModLoadingContext.get().getModEventBus().addListener((RegisterKeyMappingsEvent e) -> e.register(TOGGLE_KEY));
        MinecraftForge.EVENT_BUS.addListener(SeedScoutClient::registerCommands);
        MinecraftForge.EVENT_BUS.addListener(SeedScoutClient::onClientTick);
        MinecraftForge.EVENT_BUS.addListener(OreRenderer::onRenderLevel);
        MinecraftForge.EVENT_BUS.addListener(SeedScoutClient::onLogin);
        MinecraftForge.EVENT_BUS.addListener(SeedScoutClient::onLogout);
        MinecraftForge.EVENT_BUS.addListener((GameShuttingDownEvent e) -> {
            ScoutLink.disconnect();
            ScoutProcess.stop(20);
        });
        SeedScout.LOGGER.info("[seedscout] client loaded; /seedscout setup, start, status");
    }

    public static Path gameDir() {
        return Minecraft.getInstance().gameDirectory.toPath();
    }

    public static Path scoutDir() {
        return gameDir().resolve("seedscout");
    }

    public static Path serverDir() {
        return scoutDir().resolve("server");
    }

    /** Chat plus log, from any thread. */
    public static void say(String text) {
        SeedScout.LOGGER.info("[seedscout] {}", text);
        Minecraft mc = Minecraft.getInstance();
        mc.execute(() -> {
            if (mc.player != null) mc.player.displayClientMessage(Component.literal("[seedscout] " + text), false);
        });
    }

    private static void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        Minecraft mc = Minecraft.getInstance();
        while (TOGGLE_KEY.consumeClick()) toggle();
        if (++tickCounter % 10 == 0) {
            ScoutLink.setCacheDir(scoutDir().resolve("cache"));
            ScoutLink.tick(mc);
        }
    }

    private static void onLogin(ClientPlayerNetworkEvent.LoggingIn event) {
        ScoutLink.setCacheDir(scoutDir().resolve("cache"));
        Minecraft mc = Minecraft.getInstance();
        if (ClientConfig.AUTO_START.get() && !mc.hasSingleplayerServer() && !ScoutProcess.isRunning()) start();
        else if (ScoutLink.isConnected()) ScoutLink.checkHash();
    }

    private static void onLogout(ClientPlayerNetworkEvent.LoggingOut event) {
        ScoutLink.saveAll();
    }

    private static void toggle() {
        boolean on = !ClientConfig.OVERLAY_ON.get();
        ClientConfig.OVERLAY_ON.set(on);
        ClientConfig.SPEC.save();
        say("overlay " + (on ? "on" : "off"));
    }

    // ---- commands -------------------------------------------------------------------------------------

    private static void registerCommands(RegisterClientCommandsEvent event) {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("seedscout")
                .executes(ctx -> status())
                .then(Commands.literal("setup").executes(ctx -> setup(false))
                        .then(Commands.literal("accept-eula").executes(ctx -> setup(true))))
                .then(Commands.literal("start").executes(ctx -> start()))
                .then(Commands.literal("stop").executes(ctx -> stop()))
                .then(Commands.literal("status").executes(ctx -> status()))
                .then(Commands.literal("hash").executes(ctx -> hash()))
                .then(Commands.literal("toggle").executes(ctx -> { toggle(); return 1; }))
                .then(Commands.literal("range").then(Commands.argument("n", IntegerArgumentType.integer(1, 16)).executes(ctx -> {
                    ClientConfig.RANGE.set(IntegerArgumentType.getInteger(ctx, "n"));
                    ClientConfig.SPEC.save();
                    say("range " + ClientConfig.RANGE.get() + " chunks");
                    return 1;
                })))
                .then(Commands.literal("ram").then(Commands.argument("size", StringArgumentType.word()).executes(ctx -> {
                    ClientConfig.RAM.set(StringArgumentType.getString(ctx, "size"));
                    ClientConfig.SPEC.save();
                    say("scout server heap " + ServerFiles.xmx(ClientConfig.RAM.get(), "5G") + " (takes effect on the next start)");
                    return 1;
                })))
                .then(Commands.literal("seed").then(Commands.argument("seed", StringArgumentType.greedyString()).executes(ctx -> {
                    ClientConfig.SEED.set(StringArgumentType.getString(ctx, "seed").trim());
                    ClientConfig.SPEC.save();
                    say("seed " + ClientConfig.seed() + ", expected hash " + Seeds.obfuscate(ClientConfig.seed())
                            + ". Run /seedscout setup again (it rewrites level-seed); delete seedscout/server/world first.");
                    return 1;
                })))
                .then(Commands.literal("autostart").then(Commands.argument("on", com.mojang.brigadier.arguments.BoolArgumentType.bool()).executes(ctx -> {
                    ClientConfig.AUTO_START.set(com.mojang.brigadier.arguments.BoolArgumentType.getBool(ctx, "on"));
                    ClientConfig.SPEC.save();
                    say("auto-start " + ClientConfig.AUTO_START.get());
                    return 1;
                })))
                .then(Commands.literal("color").then(Commands.argument("id", StringArgumentType.string())
                        .then(Commands.argument("rrggbb", StringArgumentType.word()).executes(ctx -> {
                            try {
                                ClientConfig.setColor(StringArgumentType.getString(ctx, "id"),
                                        Integer.parseInt(StringArgumentType.getString(ctx, "rrggbb").replace("#", ""), 16));
                                say("color set");
                            } catch (NumberFormatException e) {
                                say("color must be six hex digits, like FF8800");
                            }
                            return 1;
                        }))))
                .then(Commands.literal("ores")
                        .then(Commands.literal("list").executes(ctx -> oresList()))
                        .then(Commands.literal("add").then(Commands.argument("id", StringArgumentType.string()).executes(ctx -> oresAdd(ctx))))
                        .then(Commands.literal("remove").then(Commands.argument("id", StringArgumentType.string()).executes(ctx -> oresRemove(ctx)))));
        event.getDispatcher().register(root);
    }

    private static int setup(boolean acceptEula) {
        if (ScoutSetup.isBusy()) {
            say("setup is already running");
            return 0;
        }
        say("setup starting in the background; progress follows here");
        Thread t = new Thread(new ScoutSetup(gameDir(), acceptEula, ClientConfig.RAM.get(), SeedScoutClient::say), "seedscout-setup");
        t.setDaemon(true);
        t.start();
        return 1;
    }

    private static int start() {
        if (ScoutProcess.isRunning()) {
            say("the scout server is already running (" + ScoutProcess.uptime() + ")");
            return 0;
        }
        if (!ScoutProcess.isInstalled(serverDir())) {
            say("no scout server yet: run /seedscout setup first");
            return 0;
        }
        if (!ScoutProcess.eulaAccepted(serverDir())) {
            say("the EULA is not accepted: /seedscout setup accept-eula");
            return 0;
        }
        try {
            Path log = ScoutProcess.newLog(scoutDir(), "scout");
            ScoutProcess.launch(serverDir(), ClientConfig.RAM.get(), log, true);
            say("scout server starting with " + ServerFiles.xmx(ClientConfig.RAM.get(), "5G") + "; log seedscout/" + scoutDir().relativize(log));
        } catch (IOException e) {
            say("start failed: " + e.getMessage());
            return 0;
        }
        connector = new Thread(SeedScoutClient::waitAndConnect, "seedscout-connect");
        connector.setDaemon(true);
        connector.start();
        return 1;
    }

    /** Waits for the scout mod's endpoint file, then connects; reports when the process dies first. */
    private static void waitAndConnect() {
        Process p = ScoutProcess.process();
        long t0 = System.currentTimeMillis();
        while (p != null && p.isAlive()) {
            JsonObject ep = ScoutProcess.readEndpoint(serverDir());
            if (ep != null && ep.has("port") && ep.has("token")) {
                try {
                    ScoutLink.connect(ep.get("port").getAsInt(), ep.get("token").getAsString());
                    say("connected to the scout server after " + (System.currentTimeMillis() - t0) / 1000 + " s; checking the hash");
                } catch (IOException e) {
                    say("cannot connect to the scout socket: " + e.getMessage());
                }
                return;
            }
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                return;
            }
        }
        if (p != null) say("the scout server exited with code " + p.exitValue() + " before it was ready; see seedscout/logs");
    }

    private static int stop() {
        if (!ScoutProcess.isRunning()) {
            say("the scout server is not running");
            ScoutLink.disconnect();
            return 0;
        }
        say("stopping the scout server ...");
        Thread t = new Thread(() -> {
            ScoutLink.disconnect();
            ScoutProcess.stop(60);
            say("scout server stopped");
        }, "seedscout-stop");
        t.setDaemon(true);
        t.start();
        return 1;
    }

    private static int status() {
        long seed = ClientConfig.seed();
        say("seed " + seed + ", expected hash " + Seeds.obfuscate(seed) + "; range " + ClientConfig.RANGE.get()
                + "; overlay " + (ClientConfig.OVERLAY_ON.get() ? "on" : "off") + ", " + OreRenderer.lastDrawn + " boxes drawn");
        say("server: " + (ScoutProcess.isInstalled(serverDir()) ? "installed" : "NOT installed (run setup)")
                + ", eula " + (ScoutProcess.eulaAccepted(serverDir()) ? "accepted" : "not accepted")
                + ", " + (ScoutProcess.isRunning() ? "running " + ScoutProcess.uptime() : "not running")
                + (ScoutSetup.isBusy() ? ", setup in progress" : ""));
        say("link: " + ScoutLink.status());
        return 1;
    }

    private static int hash() {
        long seed = ClientConfig.seed();
        Long real = ScoutLink.realServerHash();
        say("configured seed " + seed + " hashes to " + Seeds.obfuscate(seed));
        say("this server's hashed seed: " + (real == null ? "unknown (not in a world)" : real.toString()));
        say("scout world's hashed seed: " + (ScoutLink.scoutHash() == null ? "unknown (not connected)" : ScoutLink.scoutHash().toString()));
        ScoutLink.checkHash();
        return 1;
    }

    private static int oresList() {
        List<String> ores = ClientConfig.ores();
        say("ores (" + ores.size() + "): " + String.join(", ", ores));
        Minecraft mc = Minecraft.getInstance();
        if (mc.level != null) {
            Map<String, Integer> counts = new TreeMap<>(ScoutLink.store(mc.level.dimension().location().toString()).countsById());
            if (!counts.isEmpty()) say("cached here: " + counts);
        }
        return 1;
    }

    private static int oresAdd(CommandContext<CommandSourceStack> ctx) {
        String id = StringArgumentType.getString(ctx, "id");
        List<String> ores = ClientConfig.ores();
        if (ores.contains(id)) {
            say(id + " is already in the list");
            return 0;
        }
        ores.add(id);
        ClientConfig.setOres(ores);
        say("added " + id + "; chunks are scanned again for the new list");
        return 1;
    }

    private static int oresRemove(CommandContext<CommandSourceStack> ctx) {
        String id = StringArgumentType.getString(ctx, "id");
        List<String> ores = ClientConfig.ores();
        if (!ores.remove(id)) {
            say(id + " is not in the list");
            return 0;
        }
        ClientConfig.setOres(ores);
        say("removed " + id);
        return 1;
    }
}

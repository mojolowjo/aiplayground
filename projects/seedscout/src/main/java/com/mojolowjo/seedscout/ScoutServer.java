package com.mojolowjo.seedscout;

import com.google.gson.JsonObject;
import com.mojang.datafixers.util.Either;
import net.minecraft.core.SectionPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ChunkHolder;
import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.TicketType;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.biome.BiomeManager;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.ChunkAccess;
import net.minecraft.world.level.chunk.ChunkStatus;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.registries.ForgeRegistries;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.math.BigInteger;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The scout side: a localhost socket with a random token. Each connection sends JSON lines
 * ({@link Protocol}); scan requests generate the chunks through the normal chunk system
 * ({@code getChunkFuture(x, z, FULL, true)}, at most {@link #PARALLEL} in flight, held by a ticket of our
 * own until the scan is done) and answer with the ore positions. Nothing is ever saved: every level has
 * {@code noSave} set, mobs, weather and daylight are frozen.
 */
public final class ScoutServer {
    private ScoutServer() {}

    private static final int PARALLEL = 8;
    private static final TicketType<ChunkPos> SCOUT_TICKET = TicketType.create("seedscout", Comparator.comparingLong(ChunkPos::toLong));

    private static MinecraftServer server;
    private static ServerSocket socket;
    private static String token;
    private static final AtomicBoolean running = new AtomicBoolean();
    private static final ExecutorService scanThread = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "seedscout-scan");
        t.setDaemon(true);
        return t;
    });
    private static final Semaphore inFlight = new Semaphore(PARALLEL);
    private static final Map<Block, String> idCache = new HashMap<>();

    public static void init() {
        MinecraftForge.EVENT_BUS.addListener(ScoutServer::onStarted);
        MinecraftForge.EVENT_BUS.addListener(ScoutServer::onStopping);
    }

    private static void onStarted(ServerStartedEvent event) {
        server = event.getServer();
        freeze(server);
        try {
            socket = new ServerSocket(0, 4, InetAddress.getLoopbackAddress());
            token = new BigInteger(128, new SecureRandom()).toString(16);
            running.set(true);
            Thread accept = new Thread(ScoutServer::acceptLoop, "seedscout-accept");
            accept.setDaemon(true);
            accept.start();
            JsonObject ep = new JsonObject();
            ep.addProperty("port", socket.getLocalPort());
            ep.addProperty("token", token);
            ep.addProperty("pid", ProcessHandle.current().pid());
            Files.writeString(Path.of(ServerFiles.ENDPOINT_FILE), ep.toString(), StandardCharsets.UTF_8);
            SeedScout.LOGGER.info("[seedscout] scout socket on 127.0.0.1:{} (token in {}); hashed seed {}",
                    socket.getLocalPort(), ServerFiles.ENDPOINT_FILE, BiomeManager.obfuscateSeed(seed(server)));
        } catch (IOException e) {
            SeedScout.LOGGER.error("[seedscout] cannot open the scout socket", e);
        }
    }

    private static void onStopping(ServerStoppingEvent event) {
        running.set(false);
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        try {
            Files.deleteIfExists(Path.of(ServerFiles.ENDPOINT_FILE));
        } catch (IOException ignored) {
        }
    }

    /** No saving, no mobs, no weather, no daylight, no random ticks: the world stays as generated. */
    private static void freeze(MinecraftServer server) {
        GameRules rules = server.getGameRules();
        rules.getRule(GameRules.RULE_DOMOBSPAWNING).set(false, server);
        rules.getRule(GameRules.RULE_DO_PATROL_SPAWNING).set(false, server);
        rules.getRule(GameRules.RULE_DO_TRADER_SPAWNING).set(false, server);
        rules.getRule(GameRules.RULE_DOINSOMNIA).set(false, server);
        rules.getRule(GameRules.RULE_WEATHER_CYCLE).set(false, server);
        rules.getRule(GameRules.RULE_DAYLIGHT).set(false, server);
        rules.getRule(GameRules.RULE_DOFIRETICK).set(false, server);
        rules.getRule(GameRules.RULE_RANDOMTICKING).set(0, server);
        for (ServerLevel level : server.getAllLevels()) {
            level.noSave = true;
            level.setWeatherParameters(1_000_000, 0, false, false);
        }
    }

    static long seed(MinecraftServer server) {
        return server.getWorldData().worldGenOptions().seed();
    }

    private static void acceptLoop() {
        while (running.get()) {
            try {
                Socket s = socket.accept();
                Thread t = new Thread(() -> serve(s), "seedscout-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (running.get()) SeedScout.LOGGER.warn("[seedscout] accept failed: {}", e.toString());
            }
        }
    }

    private static void serve(Socket s) {
        try (s; BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
             PrintWriter out = new PrintWriter(new OutputStreamWriter(s.getOutputStream(), StandardCharsets.UTF_8), true)) {
            boolean authed = false;
            String line;
            while ((line = in.readLine()) != null) {
                JsonObject msg;
                try {
                    msg = Protocol.parse(line);
                } catch (RuntimeException e) {
                    send(out, Protocol.error("bad json"));
                    continue;
                }
                String cmd = Protocol.command(msg);
                if (!authed) {
                    if (cmd.equals("auth") && msg.has("token") && token.equals(msg.get("token").getAsString())) {
                        authed = true;
                        JsonObject ok = new JsonObject();
                        ok.addProperty("cmd", "auth");
                        ok.addProperty("ok", true);
                        send(out, ok);
                        continue;
                    }
                    send(out, Protocol.error("auth required"));
                    return;
                }
                switch (cmd) {
                    case "hash" -> send(out, Protocol.hashReply(BiomeManager.obfuscateSeed(seed(server)), seed(server)));
                    case "scan" -> scanThread.submit(() -> scan(msg, out));
                    case "shutdown" -> {
                        SeedScout.LOGGER.info("[seedscout] shutdown requested by the client");
                        server.halt(false);
                        return;
                    }
                    default -> send(out, Protocol.error("unknown command " + cmd));
                }
            }
        } catch (IOException e) {
            SeedScout.LOGGER.debug("[seedscout] connection closed: {}", e.toString());
        }
    }

    private static void send(PrintWriter out, JsonObject o) {
        synchronized (out) {
            out.println(o.toString());
        }
    }

    /** Runs on the scan thread: resolves the block list, then generates and scans the chunks, {@link #PARALLEL} at a time. */
    private static void scan(JsonObject msg, PrintWriter out) {
        String dim = msg.get("dim").getAsString();
        int query = msg.get("q").getAsInt();
        List<int[]> chunks = Protocol.chunks(msg);
        ServerLevel level = server.getLevel(ResourceKey.create(Registries.DIMENSION, new ResourceLocation(dim)));
        if (level == null) {
            for (int[] c : chunks) send(out, Protocol.chunkError(dim, query, c[0], c[1], "no dimension " + dim + " on the scout server"));
            return;
        }
        Set<Block> targets = resolve(Protocol.strings(msg, "blocks"));
        ServerChunkCache cache = level.getChunkSource();
        for (int[] c : chunks) {
            if (out.checkError()) return; // client gone
            final int x = c[0], z = c[1];
            ChunkPos pos = new ChunkPos(x, z);
            try {
                inFlight.acquire();
            } catch (InterruptedException e) {
                return;
            }
            // The ticket keeps the chunk from unloading while it generates; the UNKNOWN ticket getChunkFuture adds
            // times out after one tick. Added on the server thread, then the future is asked for off-thread so the
            // server keeps ticking instead of blocking on it.
            server.submit(() -> cache.addRegionTicket(SCOUT_TICKET, pos, 0, pos)).join();
            cache.getChunkFuture(x, z, ChunkStatus.FULL, true).whenComplete((either, err) -> {
                try {
                    if (err != null) {
                        send(out, Protocol.chunkError(dim, query, x, z, err.toString()));
                    } else {
                        Either<ChunkAccess, ChunkHolder.ChunkLoadingFailure> e = either;
                        e.ifLeft(chunk -> send(out, Protocol.chunkReply(dim, query, scanChunk(chunk, x, z, query, targets))));
                        e.ifRight(f -> send(out, Protocol.chunkError(dim, query, x, z, f.toString())));
                    }
                } catch (Throwable t) {
                    SeedScout.LOGGER.warn("[seedscout] scan of {} {},{} failed", dim, x, z, t);
                    send(out, Protocol.chunkError(dim, query, x, z, t.toString()));
                } finally {
                    server.execute(() -> cache.removeRegionTicket(SCOUT_TICKET, pos, 0, pos));
                    inFlight.release();
                }
            });
        }
    }

    /** Block ids and #tags -> the blocks to look for. Unknown ids are skipped and logged. */
    static Set<Block> resolve(List<String> names) {
        Set<Block> out = new HashSet<>();
        for (String n : names) {
            try {
                if (n.startsWith("#")) {
                    TagKey<Block> key = TagKey.create(Registries.BLOCK, new ResourceLocation(n.substring(1)));
                    if (ForgeRegistries.BLOCKS.tags() != null && ForgeRegistries.BLOCKS.tags().isKnownTagName(key))
                        ForgeRegistries.BLOCKS.tags().getTag(key).forEach(out::add);
                    else SeedScout.LOGGER.warn("[seedscout] unknown block tag {}", n);
                } else {
                    Block b = ForgeRegistries.BLOCKS.getValue(new ResourceLocation(n));
                    if (b != null && b != Blocks.AIR) out.add(b);
                    else SeedScout.LOGGER.warn("[seedscout] unknown block {}", n);
                }
            } catch (RuntimeException e) {
                SeedScout.LOGGER.warn("[seedscout] bad block name {}: {}", n, e.toString());
            }
        }
        return out;
    }

    /** Sections whose palette has none of the targets are skipped; the rest is read block by block. */
    static OreStore.ChunkOres scanChunk(ChunkAccess chunk, int cx, int cz, int query, Set<Block> targets) {
        List<OreStore.Ore> ores = new ArrayList<>();
        LevelChunkSection[] sections = chunk.getSections();
        for (int i = 0; i < sections.length; i++) {
            LevelChunkSection sec = sections[i];
            if (sec == null || sec.hasOnlyAir()) continue;
            if (!sec.maybeHas(s -> targets.contains(s.getBlock()))) continue;
            int y0 = SectionPos.sectionToBlockCoord(chunk.getSectionYFromSectionIndex(i));
            for (int y = 0; y < 16; y++)
                for (int z = 0; z < 16; z++)
                    for (int x = 0; x < 16; x++) {
                        BlockState s = sec.getBlockState(x, y, z);
                        Block b = s.getBlock();
                        if (targets.contains(b)) ores.add(new OreStore.Ore((cx << 4) + x, y0 + y, (cz << 4) + z, id(b)));
                    }
        }
        return new OreStore.ChunkOres(cx, cz, query, ores);
    }

    private static String id(Block b) {
        synchronized (idCache) {
            return idCache.computeIfAbsent(b, k -> {
                ResourceLocation rl = ForgeRegistries.BLOCKS.getKey(k);
                return rl == null ? "unknown" : rl.toString();
            });
        }
    }
}

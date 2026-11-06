package com.mojolowjo.seedscout;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.level.biome.BiomeManager;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.net.InetAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The client's connection to the scout server. Keeps the ore caches (one {@link OreStore} per dimension of
 * the configured seed), asks for uncached chunks around the player nearest first, and checks the scout's
 * hashed seed against the configured seed and the real server's.
 */
public final class ScoutLink {
    private ScoutLink() {}

    private static final int MAX_PER_REQUEST = 48;
    private static final long PENDING_TIMEOUT_MS = 90_000;
    private static final long SAVE_EVERY_MS = 30_000;

    private static Socket socket;
    private static PrintWriter out;
    private static volatile boolean connected;
    private static volatile Long scoutHash;
    private static volatile Long scoutSeed;
    private static String lastHashWarning;

    private static Path cacheDir;
    private static long cacheSeed;
    private static final Map<String, OreStore> stores = new HashMap<>();
    /** chunk key -> time requested, per dimension. */
    private static final Map<String, ConcurrentHashMap<Long, Long>> pending = new ConcurrentHashMap<>();
    private static long lastSave = System.currentTimeMillis();
    private static int received, errors;

    public static boolean isConnected() {
        return connected;
    }

    public static Long scoutHash() {
        return scoutHash;
    }

    public static void setCacheDir(Path dir) {
        cacheDir = dir;
    }

    /** Connects (on the calling thread) and starts the reader. */
    public static synchronized void connect(int port, String token) throws IOException {
        disconnect();
        Socket s = null;
        IOException last = null;
        for (int attempt = 0; attempt < 10 && s == null; attempt++) {
            try {
                s = new Socket(InetAddress.getByAddress(new byte[]{127, 0, 0, 1}), port);
            } catch (IOException e) {
                last = e;
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ie) {
                    throw e;
                }
            }
        }
        if (s == null) throw last;
        final Socket sock = s;
        PrintWriter w = new PrintWriter(new OutputStreamWriter(sock.getOutputStream(), StandardCharsets.UTF_8), true);
        socket = sock;
        out = w;
        connected = true;
        scoutHash = null;
        send(Protocol.auth(token));
        send(Protocol.hash());
        Thread reader = new Thread(() -> readLoop(sock), "seedscout-reader");
        reader.setDaemon(true);
        reader.start();
    }

    public static synchronized void disconnect() {
        connected = false;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        socket = null;
        out = null;
        pending.clear();
        saveAll();
    }

    public static void sendShutdown() {
        send(Protocol.shutdown());
    }

    private static void send(JsonObject o) {
        PrintWriter w = out;
        if (w == null) return;
        synchronized (w) {
            w.println(o.toString());
        }
    }

    private static void readLoop(Socket s) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = in.readLine()) != null) {
                JsonObject msg = Protocol.parse(line);
                switch (Protocol.command(msg)) {
                    case "hash" -> {
                        scoutHash = msg.get("hash").getAsLong();
                        scoutSeed = msg.get("seed").getAsLong();
                        Minecraft.getInstance().execute(ScoutLink::checkHash);
                    }
                    case "chunk" -> onChunk(msg);
                    case "error" -> SeedScoutClient.say("scout error: " + msg.get("error").getAsString());
                    default -> { }
                }
            }
        } catch (IOException | RuntimeException e) {
            if (connected) SeedScoutClient.say("scout connection lost: " + e.getMessage());
        } finally {
            if (socket == s) {
                connected = false;
                pending.clear();
            }
        }
    }

    private static void onChunk(JsonObject msg) {
        String dim = msg.get("dim").getAsString();
        OreStore.ChunkOres c = Protocol.chunkOres(msg);
        ConcurrentHashMap<Long, Long> p = pending.get(dim);
        if (p != null) p.remove(OreStore.key(c.x, c.z));
        if (msg.has("error")) {
            errors++;
            if (errors <= 3) SeedScoutClient.say("scout: chunk " + c.x + "," + c.z + " in " + dim + ": " + msg.get("error").getAsString());
            return;
        }
        received++;
        store(dim).put(c);
    }

    /** The store of a dimension for the configured seed, loaded from disk on first use. */
    public static synchronized OreStore store(String dim) {
        if (cacheDir == null) cacheDir = Minecraft.getInstance().gameDirectory.toPath().resolve("seedscout").resolve("cache");
        long seed = ClientConfig.seed();
        if (seed != cacheSeed) {
            saveAll();
            stores.clear();
            cacheSeed = seed;
        }
        return stores.computeIfAbsent(dim, d -> OreStore.load(cacheDir, seed, d));
    }

    public static synchronized void saveAll() {
        for (OreStore s : stores.values()) {
            if (!s.dirty()) continue;
            try {
                s.save(cacheDir);
            } catch (IOException e) {
                SeedScout.LOGGER.warn("[seedscout] cannot save the ore cache of {}", s.dimension(), e);
            }
        }
        lastSave = System.currentTimeMillis();
    }

    /** Every half second from the client tick: request what is missing around the player. */
    public static void tick(Minecraft mc) {
        if (System.currentTimeMillis() - lastSave > SAVE_EVERY_MS) saveAll();
        if (!connected || mc.level == null || mc.player == null) return;
        String dim = mc.level.dimension().location().toString();
        List<String> blocks = ClientConfig.ores();
        int query = Protocol.query(blocks);
        OreStore store = store(dim);
        ConcurrentHashMap<Long, Long> p = pending.computeIfAbsent(dim, d -> new ConcurrentHashMap<>());
        long now = System.currentTimeMillis();
        for (Iterator<Map.Entry<Long, Long>> it = p.entrySet().iterator(); it.hasNext(); )
            if (now - it.next().getValue() > PENDING_TIMEOUT_MS) it.remove();

        int range = ClientConfig.RANGE.get();
        int pcx = mc.player.chunkPosition().x, pcz = mc.player.chunkPosition().z;
        List<int[]> wanted = new ArrayList<>();
        for (int dx = -range; dx <= range; dx++)
            for (int dz = -range; dz <= range; dz++) {
                int cx = pcx + dx, cz = pcz + dz;
                if (store.has(cx, cz, query) || p.containsKey(OreStore.key(cx, cz))) continue;
                wanted.add(new int[]{cx, cz});
            }
        if (wanted.isEmpty()) return;
        wanted.sort(Comparator.comparingInt(c -> (c[0] - pcx) * (c[0] - pcx) + (c[1] - pcz) * (c[1] - pcz)));
        if (wanted.size() > MAX_PER_REQUEST) wanted = wanted.subList(0, MAX_PER_REQUEST);
        for (int[] c : wanted) p.put(OreStore.key(c[0], c[1]), now);
        send(Protocol.scan(dim, query, wanted, blocks));
    }

    /** Compares the scout's hashed seed with the configured seed and with the level the client is in. */
    public static void checkHash() {
        Long h = scoutHash;
        if (h == null) return;
        long expected = Seeds.obfuscate(ClientConfig.seed());
        StringBuilder warn = new StringBuilder();
        if (h != expected)
            warn.append("scout world seed ").append(scoutSeed).append(" (hash ").append(h)
                    .append(") is not the configured seed ").append(ClientConfig.seed()).append(" (hash ").append(expected)
                    .append("); delete seedscout/server/world and run /seedscout setup again. ");
        Long real = realServerHash();
        if (real != null && !real.equals(h))
            warn.append("the server you are on has hashed seed ").append(real).append(", the scout world has ").append(h)
                    .append(": its ores will NOT match this server.");
        if (warn.length() == 0) {
            if (lastHashWarning != null || !h.equals(scoutHashReported)) SeedScoutClient.say("hash check ok: " + h);
            lastHashWarning = null;
            scoutHashReported = h;
        } else if (!warn.toString().equals(lastHashWarning)) {
            lastHashWarning = warn.toString();
            SeedScoutClient.say("WARNING: " + warn);
        }
    }

    private static Long scoutHashReported;

    /** The hashed seed the real server sent for the current level, or null. */
    public static Long realServerHash() {
        ClientLevel level = Minecraft.getInstance().level;
        if (level == null) return null;
        try {
            return zoomSeed(level.getBiomeManager());
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    /** BiomeManager's one non-static long field (biomeZoomSeed), read by type so no mapping name is needed. */
    static long zoomSeed(BiomeManager manager) throws ReflectiveOperationException {
        Field found = null;
        int n = 0;
        for (Field f : BiomeManager.class.getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers()) || f.getType() != long.class) continue;
            found = f;
            n++;
        }
        if (n != 1) throw new ReflectiveOperationException("BiomeManager has " + n + " long fields");
        found.setAccessible(true);
        return found.getLong(manager);
    }

    public static String status() {
        int chunks = 0, ores = 0;
        synchronized (ScoutLink.class) {
            for (OreStore s : stores.values()) {
                chunks += s.chunkCount();
                ores += s.oreCount();
            }
        }
        int pend = 0;
        for (ConcurrentHashMap<Long, Long> p : pending.values()) pend += p.size();
        return (connected ? "connected" : "not connected") + ", hash " + (scoutHash == null ? "?" : scoutHash)
                + ", cache " + chunks + " chunks / " + ores + " ores, " + pend + " pending, " + received + " received, " + errors + " errors";
    }
}

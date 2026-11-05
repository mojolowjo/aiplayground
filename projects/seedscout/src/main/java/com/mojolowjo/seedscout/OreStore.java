package com.mojolowjo.seedscout;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * The ore cache of one dimension of one seed: chunk -> ore positions. Only ore positions are kept,
 * never block data. Pure Java, unit tested.
 *
 * <p>File format (gzip): "SSO1", long seed, UTF dimension, int idCount, idCount x UTF block id,
 * int chunkCount, per chunk: int x, int z, int query, int n, n x (byte localX<<4|localZ, short y, short idIndex).
 * {@code query} is the signature of the block list the chunk was scanned for; a chunk scanned for another
 * list counts as not cached.
 */
public final class OreStore {
    private static final int MAGIC = 0x5353_4F31; // "SSO1"

    public record Ore(int x, int y, int z, String id) {}

    public static final class ChunkOres {
        public final int x, z, query;
        public final List<Ore> ores;

        public ChunkOres(int x, int z, int query, List<Ore> ores) {
            this.x = x;
            this.z = z;
            this.query = query;
            this.ores = List.copyOf(ores);
        }
    }

    private final long seed;
    private final String dimension;
    private final Map<Long, ChunkOres> chunks = new LinkedHashMap<>();
    private boolean dirty;

    public OreStore(long seed, String dimension) {
        this.seed = seed;
        this.dimension = dimension;
    }

    public static long key(int x, int z) {
        return ((long) x & 0xFFFFFFFFL) | ((long) z << 32);
    }

    public long seed() { return seed; }
    public String dimension() { return dimension; }

    public synchronized ChunkOres get(int x, int z) {
        return chunks.get(key(x, z));
    }

    /** True when the chunk was scanned for exactly this block list. */
    public synchronized boolean has(int x, int z, int query) {
        ChunkOres c = chunks.get(key(x, z));
        return c != null && c.query == query;
    }

    public synchronized void put(ChunkOres c) {
        chunks.put(key(c.x, c.z), c);
        dirty = true;
    }

    public synchronized int chunkCount() { return chunks.size(); }

    public synchronized int oreCount() {
        int n = 0;
        for (ChunkOres c : chunks.values()) n += c.ores.size();
        return n;
    }

    public synchronized boolean dirty() { return dirty; }

    /** A snapshot of all chunks, for rendering without holding the lock. */
    public synchronized Collection<ChunkOres> snapshot() {
        return new ArrayList<>(chunks.values());
    }

    public synchronized void write(OutputStream raw) throws IOException {
        try (DataOutputStream out = new DataOutputStream(new GZIPOutputStream(raw))) {
            out.writeInt(MAGIC);
            out.writeLong(seed);
            out.writeUTF(dimension);
            Map<String, Integer> ids = new LinkedHashMap<>();
            for (ChunkOres c : chunks.values())
                for (Ore o : c.ores) ids.computeIfAbsent(o.id, k -> ids.size());
            if (ids.size() > Short.MAX_VALUE) throw new IOException("too many block ids: " + ids.size());
            out.writeInt(ids.size());
            for (String id : ids.keySet()) out.writeUTF(id);
            out.writeInt(chunks.size());
            for (ChunkOres c : chunks.values()) {
                out.writeInt(c.x);
                out.writeInt(c.z);
                out.writeInt(c.query);
                out.writeInt(c.ores.size());
                for (Ore o : c.ores) {
                    out.writeByte(((o.x & 15) << 4) | (o.z & 15));
                    out.writeShort(o.y);
                    out.writeShort(ids.get(o.id));
                }
            }
        }
        dirty = false;
    }

    public static OreStore read(InputStream raw) throws IOException {
        try (DataInputStream in = new DataInputStream(new GZIPInputStream(raw))) {
            if (in.readInt() != MAGIC) throw new IOException("not a seedscout ore cache");
            long seed = in.readLong();
            String dim = in.readUTF();
            OreStore store = new OreStore(seed, dim);
            int idCount = in.readInt();
            String[] ids = new String[idCount];
            for (int i = 0; i < idCount; i++) ids[i] = in.readUTF();
            int chunkCount = in.readInt();
            for (int i = 0; i < chunkCount; i++) {
                int x = in.readInt(), z = in.readInt(), query = in.readInt(), n = in.readInt();
                List<Ore> ores = new ArrayList<>(n);
                for (int j = 0; j < n; j++) {
                    int xz = in.readUnsignedByte();
                    int y = in.readShort();
                    int id = in.readShort();
                    ores.add(new Ore((x << 4) + (xz >> 4), y, (z << 4) + (xz & 15), ids[id]));
                }
                store.chunks.put(key(x, z), new ChunkOres(x, z, query, ores));
            }
            store.dirty = false;
            return store;
        }
    }

    /** The cache file of a dimension: {@code <dir>/<seed>/<namespace>.<path>.bin}. */
    public static Path file(Path cacheDir, long seed, String dimension) {
        return cacheDir.resolve(Long.toString(seed)).resolve(dimension.replace(':', '.').replace('/', '_') + ".bin");
    }

    /** Writes to a temp file first so a crash mid-write never leaves a broken cache. */
    public void save(Path cacheDir) throws IOException {
        Path f = file(cacheDir, seed, dimension);
        Files.createDirectories(f.getParent());
        Path tmp = f.resolveSibling(f.getFileName() + ".tmp");
        try (OutputStream out = Files.newOutputStream(tmp)) {
            write(out);
        }
        Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    /** Loads the dimension's cache, or an empty store when there is none or it is unreadable. */
    public static OreStore load(Path cacheDir, long seed, String dimension) {
        Path f = file(cacheDir, seed, dimension);
        if (Files.isRegularFile(f)) {
            try (InputStream in = Files.newInputStream(f)) {
                OreStore s = read(in);
                if (s.seed == seed && s.dimension.equals(dimension)) return s;
            } catch (IOException ignored) {
                // fall through: start empty
            }
        }
        return new OreStore(seed, dimension);
    }

    /** Groups ores by id, for a status line. */
    public synchronized Map<String, Integer> countsById() {
        Map<String, Integer> m = new HashMap<>();
        for (ChunkOres c : chunks.values())
            for (Ore o : c.ores) m.merge(o.id, 1, Integer::sum);
        return m;
    }
}

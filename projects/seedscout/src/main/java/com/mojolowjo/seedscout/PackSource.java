package com.mojolowjo.seedscout;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.Locale;
import java.util.function.Consumer;

/**
 * Where the pack's official server files come from. Prism Launcher writes the CurseForge ids of a managed
 * pack into the instance's {@code instance.cfg}; CurseForge's site API lists the server pack attached to that
 * file and serves it. Hardcoded fallback: MC Eternal 2 1.3. The text parsing is pure Java, unit tested.
 */
public final class PackSource {
    private PackSource() {}

    public static final String USER_AGENT = "seedscout/" + "0.1" + " (Forge mod; Java HttpClient)";
    public static final long MCE2_PROJECT = 1243287;
    public static final long MCE2_1_3_FILE = 8897052;
    public static final String MCE2_1_3_NAME = "1.3";

    /** A managed pack as Prism records it: project id, installed file id, version name. */
    public record Pack(long projectId, long fileId, String versionName, String source) {}

    /** The attached server pack of a pack file. */
    public record ServerPack(long id, String fileName, long length) {}

    /**
     * Prism's instance.cfg next to the game folder ({@code <instance>/minecraft} or {@code .minecraft}):
     * {@code ManagedPackType=flame}, {@code ManagedPackID}, {@code ManagedPackVersionID}, {@code ManagedPackVersionName}.
     */
    public static Pack parseInstanceCfg(String text) {
        long project = -1, file = -1;
        String name = "", type = "";
        for (String line : text.split("\\R")) {
            int eq = line.indexOf('=');
            if (eq <= 0) continue;
            String key = line.substring(0, eq).trim(), value = line.substring(eq + 1).trim();
            switch (key) {
                case "ManagedPackID" -> project = parseLong(value);
                case "ManagedPackVersionID" -> file = parseLong(value);
                case "ManagedPackVersionName" -> name = value;
                case "ManagedPackType" -> type = value.toLowerCase(Locale.ROOT);
            }
        }
        if (project <= 0 || file <= 0 || (!type.isEmpty() && !type.equals("flame"))) return null;
        return new Pack(project, file, name, "instance.cfg");
    }

    private static long parseLong(String s) {
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** The pack of the running instance, or the hardcoded MC Eternal 2 1.3. */
    public static Pack detect(Path gameDir) {
        for (Path dir : new Path[]{gameDir.getParent(), gameDir}) {
            if (dir == null) continue;
            Path cfg = dir.resolve("instance.cfg");
            if (!Files.isRegularFile(cfg)) continue;
            try {
                Pack p = parseInstanceCfg(Files.readString(cfg, StandardCharsets.UTF_8));
                if (p != null) return p;
            } catch (IOException ignored) {
            }
        }
        return new Pack(MCE2_PROJECT, MCE2_1_3_FILE, MCE2_1_3_NAME, "built-in default (MC Eternal 2 1.3)");
    }

    public static String additionalFilesUrl(Pack p) {
        return "https://www.curseforge.com/api/v1/mods/" + p.projectId() + "/files/" + p.fileId() + "/additional-files";
    }

    public static String downloadUrl(long projectId, long fileId) {
        return "https://www.curseforge.com/api/v1/mods/" + projectId + "/files/" + fileId + "/download";
    }

    /** The server pack among the additional files: the one whose name says server, else null. */
    public static ServerPack pickServerPack(String additionalFilesJson) {
        JsonObject root = JsonParser.parseString(additionalFilesJson).getAsJsonObject();
        JsonElement data = root.get("data");
        if (data == null || !data.isJsonArray()) return null;
        for (JsonElement e : data.getAsJsonArray()) {
            JsonObject f = e.getAsJsonObject();
            String name = f.has("fileName") ? f.get("fileName").getAsString() : "";
            if (name.toLowerCase(Locale.ROOT).contains("server"))
                return new ServerPack(f.get("id").getAsLong(), name, f.has("fileLength") ? f.get("fileLength").getAsLong() : -1);
        }
        return null;
    }

    private static HttpClient http() {
        return HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(30)).build();
    }

    public static String get(String url) throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).header("User-Agent", USER_AGENT).header("Accept", "application/json")
                .timeout(Duration.ofMinutes(2)).GET().build();
        HttpResponse<String> res = http().send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) throw new IOException("HTTP " + res.statusCode() + " from " + url);
        return res.body();
    }

    /**
     * Downloads a big file to {@code target}, resuming a {@code .part} left by an earlier run (Range request),
     * reporting every 100 MB. Returns false when the server refused the resume and a fresh download was needed too.
     */
    public static void download(String url, Path target, long expectedLength, Consumer<String> say) throws IOException, InterruptedException {
        Path part = target.resolveSibling(target.getFileName() + ".part");
        long have = Files.isRegularFile(part) ? Files.size(part) : 0;
        if (expectedLength > 0 && have > expectedLength) {
            Files.delete(part);
            have = 0;
        }
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).header("User-Agent", USER_AGENT).timeout(Duration.ofHours(3)).GET();
        if (have > 0) b.header("Range", "bytes=" + have + "-");
        HttpResponse<InputStream> res = http().send(b.build(), HttpResponse.BodyHandlers.ofInputStream());
        boolean resumed = res.statusCode() == 206;
        if (res.statusCode() != 200 && !resumed) throw new IOException("HTTP " + res.statusCode() + " from " + url);
        if (!resumed) have = 0;
        long total = expectedLength > 0 ? expectedLength : have + res.headers().firstValueAsLong("Content-Length").orElse(-1);
        say.accept((resumed ? "resuming at " + have / 1_000_000 + " MB" : "downloading") + (total > 0 ? " of " + total / 1_000_000 + " MB" : "") + " ...");
        long reported = have;
        try (InputStream in = res.body();
             var out = Files.newOutputStream(part, resumed ? new StandardOpenOption[]{StandardOpenOption.CREATE, StandardOpenOption.APPEND}
                     : new StandardOpenOption[]{StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE})) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                have += n;
                if (have - reported >= 100_000_000L) {
                    reported = have;
                    say.accept(have / 1_000_000 + " MB" + (total > 0 ? " of " + total / 1_000_000 : ""));
                }
            }
        }
        if (expectedLength > 0 && Files.size(part) != expectedLength)
            throw new IOException("download ended at " + Files.size(part) + " of " + expectedLength + " bytes; run setup again to resume");
        Files.move(part, target, StandardCopyOption.REPLACE_EXISTING);
    }
}

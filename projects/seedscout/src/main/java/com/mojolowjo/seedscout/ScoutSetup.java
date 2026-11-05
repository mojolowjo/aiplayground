package com.mojolowjo.seedscout;

import net.minecraftforge.fml.ModList;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * {@code /seedscout setup}: builds the scout server under {@code <instance>/seedscout/server/} from the
 * client's own files. Every step is skipped when its result is already there, so the command can be
 * repeated after a change to the mods. Runs on its own thread; progress goes to chat.
 */
public final class ScoutSetup implements Runnable {
    private static final int MAX_START_TRIES = 15;
    private static final Duration START_TIMEOUT = Duration.ofMinutes(25);
    private static final List<String> COPIED_FOLDERS = List.of("config", "defaultconfigs", "kubejs", "global_packs", "openloader", "scripts");

    private final Path gameDir, scoutDir, serverDir;
    private final boolean acceptEula;
    private final String ram;
    private final Consumer<String> say;
    private static volatile boolean busy;

    public ScoutSetup(Path gameDir, boolean acceptEula, String ram, Consumer<String> say) {
        this.gameDir = gameDir;
        this.scoutDir = gameDir.resolve("seedscout");
        this.serverDir = scoutDir.resolve("server");
        this.acceptEula = acceptEula;
        this.ram = ram;
        this.say = say;
    }

    public static boolean isBusy() {
        return busy;
    }

    @Override
    public void run() {
        if (busy) {
            say.accept("setup is already running");
            return;
        }
        busy = true;
        try {
            Files.createDirectories(serverDir);
            boolean eula = eula();
            download();
            install();
            syncMods();
            copyFolders();
            writeProperties();
            if (!eula) {
                say.accept("Files are in place. The server cannot start before the EULA is accepted: read " + ServerFiles.EULA_URL
                        + " and run /seedscout setup accept-eula to continue.");
                return;
            }
            if (ScoutProcess.isRunning()) {
                say.accept("the scout server is running; stop it before the test starts (/seedscout stop)");
                return;
            }
            testStarts();
        } catch (Throwable t) {
            SeedScout.LOGGER.error("[seedscout] setup failed", t);
            say.accept("setup FAILED: " + t + " (see latest.log)");
        } finally {
            busy = false;
        }
    }

    private boolean eula() throws IOException {
        if (ScoutProcess.eulaAccepted(serverDir)) return true;
        if (acceptEula) {
            Files.writeString(serverDir.resolve("eula.txt"), ServerFiles.eula(), StandardCharsets.UTF_8);
            say.accept("eula=true written (you accepted " + ServerFiles.EULA_URL + ")");
            return true;
        }
        say.accept("Minecraft EULA: " + ServerFiles.EULA_URL + " ; running a server means accepting it. "
                + "Setup prepares the files now; the server starts only after /seedscout setup accept-eula.");
        return false;
    }

    private Path installer() {
        return scoutDir.resolve(ServerFiles.INSTALLER_NAME);
    }

    private void download() throws IOException, InterruptedException {
        Path jar = installer();
        if (Files.isRegularFile(jar) && Files.size(jar) > 1_000_000) return;
        say.accept("downloading " + ServerFiles.INSTALLER_NAME + " from maven.minecraftforge.net ...");
        HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(30)).build();
        HttpRequest req = HttpRequest.newBuilder(URI.create(ServerFiles.INSTALLER_URL)).timeout(Duration.ofMinutes(10)).GET().build();
        Path tmp = jar.resolveSibling(jar.getFileName() + ".part");
        HttpResponse<Path> res = http.send(req, HttpResponse.BodyHandlers.ofFile(tmp));
        if (res.statusCode() != 200) {
            Files.deleteIfExists(tmp);
            throw new IOException("download failed: HTTP " + res.statusCode());
        }
        Files.move(tmp, jar, StandardCopyOption.REPLACE_EXISTING);
        say.accept("downloaded " + Files.size(jar) / 1024 + " KB");
    }

    private void install() throws IOException, InterruptedException {
        if (ScoutProcess.isInstalled(serverDir)) return;
        say.accept("installing the Forge server (downloads libraries, a few minutes) ...");
        Path log = scoutDir.resolve("logs").resolve("installer.log");
        Files.createDirectories(log.getParent());
        Process p = new ProcessBuilder(ScoutProcess.javaExecutable(), "-jar", installer().toString(), "--installServer", serverDir.toString())
                .directory(scoutDir.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
        if (!p.waitFor(30, TimeUnit.MINUTES)) {
            p.destroyForcibly();
            throw new IOException("the installer did not finish in 30 minutes (seedscout/logs/installer.log)");
        }
        if (p.exitValue() != 0 || !ScoutProcess.isInstalled(serverDir))
            throw new IOException("the installer failed with exit code " + p.exitValue() + " (seedscout/logs/installer.log)");
        say.accept("Forge server installed");
    }

    private Path excludedFile() {
        return scoutDir.resolve(ServerFiles.EXCLUDED_FILE);
    }

    private Set<String> loadExcluded() throws IOException {
        Path f = excludedFile();
        return Files.isRegularFile(f) ? ClientOnlyMods.parseExclusionList(Files.readString(f, StandardCharsets.UTF_8)) : new LinkedHashSet<>();
    }

    private void addExcluded(String jar, String reason) throws IOException {
        Files.writeString(excludedFile(), jar + " # " + reason + "\n", StandardCharsets.UTF_8,
                java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
    }

    /** Copies the client's mods minus the client-only ones; removes server jars that should not be there. */
    private void syncMods() throws IOException {
        Path clientMods = gameDir.resolve("mods"), serverMods = serverDir.resolve("mods");
        Files.createDirectories(serverMods);
        Set<String> excluded = loadExcluded();
        Map<String, Path> wanted = new LinkedHashMap<>();
        int builtin = 0, toml = 0, listed = 0;
        try (Stream<Path> jars = Files.list(clientMods)) {
            for (Path jar : (Iterable<Path>) jars.sorted()::iterator) {
                String name = jar.getFileName().toString();
                if (!name.endsWith(".jar")) continue;
                if (excluded.contains(name)) { listed++; continue; }
                if (ClientOnlyMods.matchesBuiltin(name)) { builtin++; continue; }
                String t = ClientOnlyMods.readModsToml(jar);
                if (t != null && ClientOnlyMods.tomlSaysClientOnly(t)) { toml++; continue; }
                wanted.put(name, jar);
            }
        }
        // this mod's own jar, when it is not among the client's mods (a dev run)
        Path self = ModList.get().getModFileById(SeedScout.MOD_ID).getFile().getFilePath();
        if (Files.isRegularFile(self) && self.toString().endsWith(".jar")) wanted.putIfAbsent(self.getFileName().toString(), self);

        int copied = 0, removed = 0;
        try (Stream<Path> present = Files.list(serverMods)) {
            for (Path jar : (Iterable<Path>) present::iterator) {
                String name = jar.getFileName().toString();
                if (name.endsWith(".jar") && !wanted.containsKey(name)) {
                    Files.delete(jar);
                    removed++;
                }
            }
        }
        for (Map.Entry<String, Path> e : wanted.entrySet()) {
            Path dst = serverMods.resolve(e.getKey());
            if (Files.isRegularFile(dst) && Files.size(dst) == Files.size(e.getValue())) continue;
            Files.copy(e.getValue(), dst, StandardCopyOption.REPLACE_EXISTING);
            copied++;
        }
        say.accept("mods: " + wanted.size() + " on the scout server (" + copied + " copied, " + removed + " removed); left out: "
                + builtin + " by name, " + toml + " marked client-only, " + listed + " from " + ServerFiles.EXCLUDED_FILE);
    }

    private void copyFolders() throws IOException {
        int files = 0;
        for (String folder : COPIED_FOLDERS) {
            Path src = gameDir.resolve(folder);
            if (!Files.isDirectory(src)) continue;
            files += copyTree(src, serverDir.resolve(folder), true);
        }
        Path defaults = gameDir.resolve("defaultconfigs");
        if (Files.isDirectory(defaults)) files += copyTree(defaults, serverDir.resolve("world").resolve("serverconfig"), false);
        say.accept("configs: " + files + " files copied (config, defaultconfigs, kubejs and friends; defaultconfigs also into world/serverconfig)");
    }

    /** Copies a tree; with {@code overwrite} false existing files stay (world/serverconfig keeps what the server wrote). */
    private static int copyTree(Path src, Path dst, boolean overwrite) throws IOException {
        int n = 0;
        try (Stream<Path> walk = Files.walk(src)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                Path target = dst.resolve(src.relativize(p).toString());
                if (Files.isDirectory(p)) {
                    Files.createDirectories(target);
                    continue;
                }
                if (p.getFileName().toString().equals(ClientConfig.FILE)) continue;
                if (!overwrite && Files.exists(target)) continue;
                if (overwrite && Files.exists(target) && Files.size(target) == Files.size(p)
                        && Files.getLastModifiedTime(target).compareTo(Files.getLastModifiedTime(p)) >= 0) continue;
                Files.createDirectories(target.getParent());
                Files.copy(p, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
                n++;
            }
        }
        return n;
    }

    private void writeProperties() throws IOException {
        Path f = serverDir.resolve("server.properties");
        long seed = ClientConfig.seed();
        if (Files.isRegularFile(f)) {
            String text = Files.readString(f, StandardCharsets.UTF_8);
            String updated = ServerFiles.withProperty(text, "level-seed", Long.toString(seed));
            if (!updated.equals(text)) {
                Files.writeString(f, updated, StandardCharsets.UTF_8);
                say.accept("server.properties: level-seed set to " + seed + " (the old world folder no longer matches; delete seedscout/server/world)");
            }
            return;
        }
        int port;
        try (ServerSocket s = new ServerSocket(0)) {
            port = s.getLocalPort();
        }
        Files.writeString(f, ServerFiles.serverProperties(seed, port), StandardCharsets.UTF_8);
        say.accept("server.properties written: seed " + seed + ", port " + port + ", view-distance 3, offline, 1 player");
    }

    /** Starts the server until it reaches "Done", excluding the jar each crash is traced to. */
    private void testStarts() throws IOException, InterruptedException {
        for (int attempt = 1; attempt <= MAX_START_TRIES; attempt++) {
            say.accept("test start " + attempt + "/" + MAX_START_TRIES + " (the first world generation can take many minutes) ...");
            Path log = ScoutProcess.newLog(scoutDir, "setup-start" + attempt);
            long t0 = System.currentTimeMillis();
            Process p = ScoutProcess.launch(serverDir, ram, log, false);
            boolean done = false;
            try {
                long lastLine = 0;
                while (p.isAlive()) {
                    Thread.sleep(2000);
                    List<String> lines = tail(log);
                    for (int i = (int) lastLine; i < lines.size(); i++) if (ServerFiles.isDoneLine(lines.get(i))) done = true;
                    lastLine = lines.size();
                    if (done) break;
                    if (System.currentTimeMillis() - t0 > START_TIMEOUT.toMillis()) {
                        say.accept("no 'Done' after " + START_TIMEOUT.toMinutes() + " minutes; stopping the test start (see " + scoutDir.relativize(log) + ")");
                        break;
                    }
                }
            } finally {
                if (p.isAlive()) {
                    ScoutProcess.console(p, "stop");
                    if (!p.waitFor(90, TimeUnit.SECONDS)) p.destroyForcibly();
                }
            }
            if (done) {
                say.accept("the scout server started and stopped cleanly. Setup done: /seedscout start");
                return;
            }
            String culprit = culprit(log);
            if (culprit == null) {
                say.accept("the server did not start and no client-only mod could be blamed. Read seedscout/" + scoutDir.relativize(log)
                        + " and the newest file in seedscout/server/crash-reports; add a jar name to seedscout/" + ServerFiles.EXCLUDED_FILE + " and run setup again.");
                return;
            }
            say.accept("start " + attempt + " failed because of " + culprit + "; excluded, retrying");
            addExcluded(culprit, "failed start " + attempt);
            Files.deleteIfExists(serverDir.resolve("mods").resolve(culprit));
        }
        say.accept("gave up after " + MAX_START_TRIES + " starts; see seedscout/" + ServerFiles.EXCLUDED_FILE + " and the logs");
    }

    private static List<String> tail(Path log) {
        try {
            return Files.readAllLines(log, StandardCharsets.ISO_8859_1);
        } catch (IOException e) {
            return List.of();
        }
    }

    /** The jar a failed start points at: from the log and the newest crash report, in that order. */
    private String culprit(Path log) throws IOException {
        List<String> texts = new ArrayList<>();
        texts.add(String.join("\n", tail(log)));
        Path crashes = serverDir.resolve("crash-reports");
        if (Files.isDirectory(crashes)) {
            try (Stream<Path> files = Files.list(crashes)) {
                files.filter(f -> f.toString().endsWith(".txt"))
                        .max(Comparator.comparingLong(f -> f.toFile().lastModified()))
                        .ifPresent(f -> texts.add(String.join("\n", tail(f))));
            }
        }
        Path mods = serverDir.resolve("mods");
        Map<String, String> idToJar = modIdIndex(mods);
        for (String text : texts) {
            ClientOnlyMods.Diagnosis d = ClientOnlyMods.diagnose(text);
            for (String jar : d.jars) if (Files.isRegularFile(mods.resolve(jar)) && !jar.startsWith("seedscout-")) return jar;
            for (String id : d.modIds) {
                String jar = idToJar.get(id);
                if (jar != null && !jar.startsWith("seedscout-")) return jar;
            }
            for (String cls : d.classes) {
                Path jar = ClientOnlyMods.findJarForClass(mods, cls);
                if (jar != null && !jar.getFileName().toString().startsWith("seedscout-")) return jar.getFileName().toString();
            }
        }
        return null;
    }

    private static Map<String, String> modIdIndex(Path mods) throws IOException {
        Map<String, String> m = new LinkedHashMap<>();
        try (Stream<Path> jars = Files.list(mods)) {
            for (Path jar : (Iterable<Path>) jars::iterator) {
                String t = ClientOnlyMods.readModsToml(jar);
                if (t == null) continue;
                for (String id : ClientOnlyMods.tomlModIds(t)) m.putIfAbsent(id, jar.getFileName().toString());
            }
        }
        return m;
    }
}

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
import java.nio.file.StandardOpenOption;
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
    /** First line of the exclusion list. A list without it came from 0.1.0, whose retries removed good mods; it is set aside. */
    private static final String EXCLUDED_HEADER = "# seedscout exclusions v2 (one jar per line; text after # is ignored)";

    private final Path gameDir, scoutDir, serverDir, clientMods, serverMods;
    private final boolean acceptEula;
    private final String ram;
    private final Consumer<String> say;
    private static volatile boolean busy;
    private Map<String, Path> clientIndex;
    /** True when a server pack zip supplied config files; the client's then only fill gaps. */
    private boolean packConfigs;

    public ScoutSetup(Path gameDir, boolean acceptEula, String ram, Consumer<String> say) {
        this.gameDir = gameDir;
        this.scoutDir = gameDir.resolve("seedscout");
        this.serverDir = scoutDir.resolve("server");
        this.clientMods = gameDir.resolve("mods");
        this.serverMods = serverDir.resolve("mods");
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

    // ---- the exclusion list ----------------------------------------------------------------------------

    private Path excludedFile() {
        return scoutDir.resolve(ServerFiles.EXCLUDED_FILE);
    }

    /** The saved list; a list from 0.1.0 (no header) is renamed to excluded-mods.old.txt and forgotten. */
    private Set<String> loadExcluded() throws IOException {
        Path f = excludedFile();
        if (!Files.isRegularFile(f)) return new LinkedHashSet<>();
        String text = Files.readString(f, StandardCharsets.UTF_8);
        if (!text.startsWith(EXCLUDED_HEADER)) {
            Path old = f.resolveSibling("excluded-mods.old.txt");
            Files.move(f, old, StandardCopyOption.REPLACE_EXISTING);
            say.accept("the old " + ServerFiles.EXCLUDED_FILE + " (from 0.1.0, it blamed the wrong jars) was set aside as excluded-mods.old.txt; starting fresh");
            return new LinkedHashSet<>();
        }
        return ClientOnlyMods.parseExclusionList(text);
    }

    private void addExcluded(String jar, String reason) throws IOException {
        Path f = excludedFile();
        if (!Files.isRegularFile(f)) Files.writeString(f, EXCLUDED_HEADER + "\n", StandardCharsets.UTF_8);
        Files.writeString(f, jar + " # " + reason + "\n", StandardCharsets.UTF_8, StandardOpenOption.APPEND);
    }

    private void removeExcluded(String jar) throws IOException {
        Path f = excludedFile();
        if (!Files.isRegularFile(f)) return;
        List<String> kept = new ArrayList<>();
        for (String line : Files.readAllLines(f, StandardCharsets.UTF_8)) {
            int hash = line.indexOf('#');
            String name = (hash > 0 ? line.substring(0, hash) : line.startsWith("#") ? "" : line).trim();
            if (!name.equals(jar)) kept.add(line);
        }
        Files.write(f, kept, StandardCharsets.UTF_8);
    }

    /** True when the jar is a client-only mod by name or by its mods.toml (not by the saved list). */
    private static boolean knownClientOnly(Path jar) {
        if (ClientOnlyMods.matchesBuiltin(jar.getFileName().toString())) return true;
        String t = ClientOnlyMods.readModsToml(jar);
        return t != null && ClientOnlyMods.tomlSaysClientOnly(t);
    }

    // ---- mods and configs --------------------------------------------------------------------------------

    /**
     * Gets the pack's official server files without the owner's help: the pack ids from Prism's instance.cfg
     * (or the built-in MC Eternal 2 1.3), the attached server pack from CurseForge, downloaded with resume.
     * A zip already in the seedscout folder is kept. Any failure falls back to filtering the client's mods.
     */
    private void fetchServerPack() {
        if (!ClientConfig.USE_SERVER_PACK.get()) return;
        try {
            if (serverPackZip() != null) return;
            PackSource.Pack pack = PackSource.detect(gameDir);
            say.accept("pack: project " + pack.projectId() + ", version " + pack.versionName() + " (file " + pack.fileId() + ", from " + pack.source() + ")");
            PackSource.ServerPack sp = PackSource.pickServerPack(PackSource.get(PackSource.additionalFilesUrl(pack)));
            if (sp == null) {
                say.accept("this pack version has no server pack on CurseForge; the client's mods are filtered instead");
                return;
            }
            Path target = scoutDir.resolve(sp.fileName());
            say.accept("server pack " + sp.fileName() + " (" + sp.length() / 1_000_000 + " MB) from CurseForge; this is a one-time download");
            PackSource.download(PackSource.downloadUrl(pack.projectId(), sp.id()), target, sp.length(), say);
            say.accept("server pack downloaded");
        } catch (Exception e) {
            SeedScout.LOGGER.warn("[seedscout] server pack fetch failed", e);
            say.accept("could not get the server pack (" + e.getMessage() + "); the client's mods are filtered instead. Run setup again to retry or resume.");
        }
    }

    /** The pack's official server files, when the zip is in the seedscout folder. */
    private Path serverPackZip() throws IOException {
        try (Stream<Path> files = Files.list(scoutDir)) {
            return files.filter(f -> f.getFileName().toString().toLowerCase(java.util.Locale.ROOT).endsWith(".zip"))
                    .filter(f -> !f.getFileName().toString().equals(ServerFiles.INSTALLER_NAME))
                    .max(Comparator.comparingLong(f -> f.toFile().lastModified())).orElse(null);
        }
    }

    /**
     * Mods from the server pack zip: its mods/*.jar replace the server's mods wholesale (plus this mod's jar), and
     * its config, defaultconfigs and kubejs folders are copied too when it has them. Returns false without a zip.
     */
    private boolean syncFromServerPack() throws IOException {
        Path zip = serverPackZip();
        if (zip == null) return false;
        say.accept("server pack found: " + zip.getFileName() + "; taking the mods from it instead of filtering the client's");
        Files.createDirectories(serverMods);
        Path self = ModList.get().getModFileById(SeedScout.MOD_ID).getFile().getFilePath();
        Map<String, Path> wanted = new LinkedHashMap<>();
        int configs = 0;
        try (java.util.zip.ZipFile z = new java.util.zip.ZipFile(zip.toFile())) {
            // the pack may sit in a top folder inside the zip: find the entry prefix that holds mods/
            String prefix = null;
            for (java.util.Enumeration<? extends java.util.zip.ZipEntry> en = z.entries(); en.hasMoreElements(); ) {
                String n = en.nextElement().getName();
                int i = n.indexOf("mods/");
                if (i >= 0 && n.endsWith(".jar") && n.indexOf('/', i + 5) < 0 && (prefix == null || i < prefix.length())) prefix = n.substring(0, i);
            }
            if (prefix == null) {
                say.accept("the zip has no mods/ folder with jars; ignoring it");
                return false;
            }
            Path tmp = scoutDir.resolve("serverpack-extract");
            for (java.util.Enumeration<? extends java.util.zip.ZipEntry> en = z.entries(); en.hasMoreElements(); ) {
                java.util.zip.ZipEntry e = en.nextElement();
                if (e.isDirectory() || !e.getName().startsWith(prefix)) continue;
                String rel = e.getName().substring(prefix.length());
                if (rel.startsWith("mods/") && rel.endsWith(".jar") && rel.indexOf('/', 5) < 0) {
                    String name = rel.substring(5);
                    Path dst = serverMods.resolve(name);
                    if (!Files.isRegularFile(dst) || Files.size(dst) != e.getSize()) {
                        try (java.io.InputStream in = z.getInputStream(e)) {
                            Files.copy(in, dst, StandardCopyOption.REPLACE_EXISTING);
                        }
                    }
                    wanted.put(name, dst);
                } else if (rel.startsWith("config/") || rel.startsWith("defaultconfigs/") || rel.startsWith("kubejs/")
                        || rel.startsWith("global_packs/") || rel.startsWith("openloader/")) {
                    if (rel.contains("..")) continue;
                    Path dst = serverDir.resolve(rel);
                    Files.createDirectories(dst.getParent());
                    try (java.io.InputStream in = z.getInputStream(e)) {
                        Files.copy(in, dst, StandardCopyOption.REPLACE_EXISTING);
                    }
                    configs++;
                    if (rel.startsWith("defaultconfigs/")) {
                        Path sc = serverDir.resolve("world").resolve("serverconfig").resolve(rel.substring("defaultconfigs/".length()));
                        if (!Files.exists(sc)) {
                            Files.createDirectories(sc.getParent());
                            Files.copy(dst, sc);
                        }
                    }
                }
            }
            Files.deleteIfExists(tmp);
        }
        if (Files.isRegularFile(self) && self.toString().endsWith(".jar")) {
            Path dst = serverMods.resolve(self.getFileName().toString());
            if (!Files.isRegularFile(dst) || Files.size(dst) != Files.size(self)) Files.copy(self, dst, StandardCopyOption.REPLACE_EXISTING);
            wanted.put(dst.getFileName().toString(), dst);
        }
        int removed = 0;
        try (Stream<Path> present = Files.list(serverMods)) {
            for (Path jar : (Iterable<Path>) present::iterator) {
                String name = jar.getFileName().toString();
                if (name.endsWith(".jar") && !wanted.containsKey(name)) {
                    Files.delete(jar);
                    removed++;
                }
            }
        }
        packConfigs = configs > 0;
        say.accept("mods: " + wanted.size() + " from the server pack (" + removed + " others removed); " + configs
                + " config files from the pack" + (configs == 0 ? " (none in the zip, the client's are used)" : ""));
        return true;
    }

    /** Copies the client's mods minus the client-only ones; removes server jars that should not be there. */
    private void syncMods() throws IOException {
        fetchServerPack();
        if (syncFromServerPack()) return;
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
            files += copyTree(src, serverDir.resolve(folder), !packConfigs);
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

    // ---- test starts ------------------------------------------------------------------------------------

    /** Starts the server until it reaches "Done", fixing the mod set after each failed start. */
    private void testStarts() throws IOException, InterruptedException {
        for (int attempt = 1; attempt <= MAX_START_TRIES; attempt++) {
            say.accept("test start " + attempt + "/" + MAX_START_TRIES + " (the first world generation can take many minutes) ...");
            Path log = ScoutProcess.newLog(scoutDir, "setup-start" + attempt);
            long t0 = System.currentTimeMillis();
            Process p = ScoutProcess.launch(serverDir, ram, log, false);
            boolean done = false;
            try {
                int seen = 0;
                while (p.isAlive()) {
                    Thread.sleep(2000);
                    List<String> lines = tail(log);
                    for (int i = seen; i < lines.size(); i++) if (ServerFiles.isDoneLine(lines.get(i))) done = true;
                    seen = lines.size();
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
            List<String> changes = repair(log, attempt);
            if (changes.isEmpty()) {
                say.accept("the server did not start and nothing could be blamed. Read seedscout/" + scoutDir.relativize(log)
                        + " and the newest file in seedscout/server/crash-reports; add a jar name to seedscout/" + ServerFiles.EXCLUDED_FILE + " and run setup again.");
                return;
            }
            say.accept("start " + attempt + " failed; " + String.join("; ", changes) + "; retrying");
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

    private static String readAll(Path f) {
        return String.join("\n", tail(f));
    }

    private Path newestCrashReport() throws IOException {
        Path crashes = serverDir.resolve("crash-reports");
        if (!Files.isDirectory(crashes)) return null;
        try (Stream<Path> files = Files.list(crashes)) {
            return files.filter(f -> f.toString().endsWith(".txt")).max(Comparator.comparingLong(f -> f.toFile().lastModified())).orElse(null);
        }
    }

    /** mod id -> jar, from the mods.toml of every jar in a folder. */
    private static Map<String, Path> index(Path mods) throws IOException {
        Map<String, Path> m = new LinkedHashMap<>();
        if (!Files.isDirectory(mods)) return m;
        try (Stream<Path> jars = Files.list(mods)) {
            for (Path jar : (Iterable<Path>) jars::iterator) {
                if (!jar.getFileName().toString().endsWith(".jar")) continue;
                String t = ClientOnlyMods.readModsToml(jar);
                if (t == null) continue;
                for (String id : ClientOnlyMods.tomlModIds(t)) m.putIfAbsent(id, jar);
            }
        }
        return m;
    }

    /**
     * Changes the mod set after a failed start and says what changed.
     * <p>Dependency failures first ("Mod ID: 'x', Requested by: 'y'"): a dependency the client has but the server
     * lacks is copied back (an earlier run removed it wrongly), unless it is a client-only mod, in which case the
     * mod that needs it is client-only too and goes out. A dependency the client does not have either: the
     * requester goes out. Only without dependency failures is a jar blamed by the crash report, and only for
     * client-class errors ("invalid dist DEDICATED_SERVER", client classes not found).
     */
    private List<String> repair(Path log, int attempt) throws IOException {
        List<String> changes = new ArrayList<>();
        String logText = readAll(log);
        Path crash = newestCrashReport();
        String crashText = crash != null && crash.toFile().lastModified() >= log.toFile().lastModified() - 120_000 ? readAll(crash) : "";

        if (clientIndex == null) clientIndex = index(clientMods);
        Map<String, Path> serverIndex = index(serverMods);
        Set<String> listed = loadExcluded();

        List<ClientOnlyMods.DependencyFailure> deps = ClientOnlyMods.dependencyFailures(logText);
        if (deps.isEmpty()) deps = ClientOnlyMods.dependencyFailures(crashText);
        Set<String> restored = new LinkedHashSet<>(), excluded = new LinkedHashSet<>();
        for (ClientOnlyMods.DependencyFailure f : deps) {
            Path clientJar = clientIndex.get(f.modId());
            Path requester = serverIndex.getOrDefault(f.requestedBy(), clientIndex.get(f.requestedBy()));
            if (clientJar != null && !serverIndex.containsKey(f.modId())) {
                String name = clientJar.getFileName().toString();
                if (knownClientOnly(clientJar)) {
                    exclude(requester, f.requestedBy() + " needs the client-only mod " + f.modId(), attempt, excluded);
                } else if (!restored.contains(name)) {
                    Files.copy(clientJar, serverMods.resolve(name), StandardCopyOption.REPLACE_EXISTING);
                    if (listed.contains(name)) removeExcluded(name);
                    restored.add(name);
                }
            } else {
                exclude(requester, f.modId() + " " + (f.missing() ? "is not installed" : "is " + f.actual() + ", needs " + f.expected()), attempt, excluded);
            }
        }
        if (!restored.isEmpty()) changes.add("copied back " + String.join(", ", restored));
        if (!excluded.isEmpty()) changes.add("excluded " + String.join(", ", excluded));
        if (!changes.isEmpty()) return changes;

        // Every "-- MOD x --" section about client code, in one round. A section whose stack frames name another mod's
        // jar is that mod's fault (Framework's config scan loading Controllable's client class): that jar goes, not x.
        for (ClientOnlyMods.CrashSection s : ClientOnlyMods.crashSections(crashText.isEmpty() ? logText : crashText)) {
            if (!s.clientClassError()) continue;
            List<String> others = new ArrayList<>();
            for (String jar : s.otherJars()) if (Files.isRegularFile(serverMods.resolve(jar))) others.add(jar);
            if (!others.isEmpty()) {
                for (String jar : others) if (!excluded.contains(jar)) { excludeNamed(jar, "client class error, through " + s.modId(), attempt); excluded.add(jar); }
            } else if (!s.modFile().isEmpty() && Files.isRegularFile(serverMods.resolve(s.modFile())) && !s.modFile().startsWith("seedscout-")) {
                if (!excluded.contains(s.modFile())) { excludeNamed(s.modFile(), "client class error in " + s.modId(), attempt); excluded.add(s.modFile()); }
            } else {
                Path jar = serverIndex.get(s.modId());
                if (jar != null && !excluded.contains(jar.getFileName().toString())) {
                    excludeNamed(jar.getFileName().toString(), "client class error in " + s.modId(), attempt);
                    excluded.add(jar.getFileName().toString());
                }
            }
        }
        if (!excluded.isEmpty()) {
            changes.add("excluded " + String.join(", ", excluded));
            return changes;
        }

        // No sections (a crash before mod construction): the classes the log could not load, looked up in the jars.
        for (String text : new String[]{crashText, logText}) {
            ClientOnlyMods.Diagnosis d = ClientOnlyMods.diagnose(text);
            if (!d.clientClassError) continue;
            for (String cls : d.classes) {
                Path jar = ClientOnlyMods.findJarForClass(serverMods, cls);
                if (jar != null) return List.of(excludeNamed(jar.getFileName().toString(), "client class " + cls, attempt));
            }
        }
        return changes;
    }

    private void exclude(Path jar, String reason, int attempt, Set<String> out) throws IOException {
        if (jar == null) return;
        String name = jar.getFileName().toString();
        if (name.startsWith("seedscout-") || out.contains(name)) return;
        excludeNamed(name, reason, attempt);
        out.add(name);
    }

    private String excludeNamed(String name, String reason, int attempt) throws IOException {
        addExcluded(name, reason + " (start " + attempt + ")");
        Files.deleteIfExists(serverMods.resolve(name));
        return "excluded " + name + " (" + reason + ")";
    }
}

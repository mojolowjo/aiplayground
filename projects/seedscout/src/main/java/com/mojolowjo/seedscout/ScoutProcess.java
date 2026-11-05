package com.mojolowjo.seedscout;

import com.google.gson.JsonObject;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * The scout server as a child process of the game. Started with the client's own Java, the installer's
 * argument file and {@code -Dseedscout.scout=true}; stopped through the socket, the console or, last, by force.
 * Dies with the game (shutdown hook plus a destroy on game exit).
 */
public final class ScoutProcess {
    private ScoutProcess() {}

    private static Process process;
    private static Instant startedAt;
    private static Path logFile;
    private static boolean hookInstalled;

    public static synchronized boolean isRunning() {
        return process != null && process.isAlive();
    }

    public static synchronized Process process() {
        return process;
    }

    public static synchronized Path logFile() {
        return logFile;
    }

    public static synchronized String uptime() {
        if (startedAt == null) return "-";
        Duration d = Duration.between(startedAt, Instant.now());
        return d.toMinutes() + " min " + (d.getSeconds() % 60) + " s";
    }

    /** The Java running this client, as the owner's brief asks; the JDK home as a fallback. */
    public static String javaExecutable() {
        return ProcessHandle.current().info().command()
                .orElseGet(() -> Path.of(System.getProperty("java.home"), "bin", ServerFiles.isWindows() ? "java.exe" : "java").toString());
    }

    public static boolean isInstalled(Path serverDir) {
        return Files.isRegularFile(serverDir.resolve(ServerFiles.argsFile(ServerFiles.isWindows())));
    }

    public static boolean eulaAccepted(Path serverDir) {
        Path eula = serverDir.resolve("eula.txt");
        try {
            return Files.isRegularFile(eula) && Files.readString(eula).matches("(?s).*(?m)^\\s*eula\\s*=\\s*true\\s*$.*");
        } catch (IOException e) {
            return false;
        }
    }

    /** The command line of a scout server start. */
    public static List<String> command(Path serverDir, String ram) {
        List<String> cmd = new ArrayList<>();
        cmd.add(javaExecutable());
        cmd.add(ServerFiles.xmx(ram, "5G"));
        cmd.add("-XX:+UseG1GC");
        cmd.add("-D" + SeedScout.SCOUT_PROPERTY + "=true");
        cmd.add("-Djava.awt.headless=true");
        cmd.add("@" + ServerFiles.argsFile(ServerFiles.isWindows()));
        cmd.add("nogui");
        return cmd;
    }

    /**
     * Launches the server with its output in {@code log}. Shared by {@code /seedscout start} and the setup's
     * test starts. The caller owns the returned process when {@code keep} is false.
     */
    public static synchronized Process launch(Path serverDir, String ram, Path log, boolean keep) throws IOException {
        if (keep && isRunning()) throw new IOException("the scout server is already running");
        Files.createDirectories(log.getParent());
        Files.deleteIfExists(serverDir.resolve(ServerFiles.ENDPOINT_FILE));
        ProcessBuilder pb = new ProcessBuilder(command(serverDir, ram))
                .directory(serverDir.toFile())
                .redirectErrorStream(true)
                .redirectOutput(log.toFile());
        Process p = pb.start();
        if (keep) {
            process = p;
            startedAt = Instant.now();
            logFile = log;
            installHook();
        }
        return p;
    }

    public static Path newLog(Path scoutDir, String prefix) {
        return scoutDir.resolve("logs").resolve(prefix + "-" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")) + ".log");
    }

    /** Reads port and token once the scout mod has written them; null while the file is not there yet. */
    public static JsonObject readEndpoint(Path serverDir) {
        Path f = serverDir.resolve(ServerFiles.ENDPOINT_FILE);
        if (!Files.isRegularFile(f)) return null;
        try {
            return Protocol.parse(Files.readString(f, StandardCharsets.UTF_8));
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /** Writes a console command to the server's stdin. */
    public static void console(Process p, String command) {
        try {
            OutputStream in = p.getOutputStream();
            in.write((command + "\n").getBytes(StandardCharsets.UTF_8));
            in.flush();
        } catch (IOException ignored) {
            // the process is gone
        }
    }

    /**
     * Stops the running scout server: a shutdown over the socket when connected, then the console "stop",
     * then force after the grace period. Returns when the process is gone.
     */
    public static void stop(long graceSeconds) {
        Process p;
        synchronized (ScoutProcess.class) {
            p = process;
        }
        if (p == null) return;
        if (p.isAlive()) {
            if (ScoutLink.isConnected()) ScoutLink.sendShutdown();
            console(p, "stop");
            try {
                if (!p.waitFor(graceSeconds, TimeUnit.SECONDS)) {
                    p.destroy();
                    if (!p.waitFor(10, TimeUnit.SECONDS)) p.destroyForcibly();
                }
            } catch (InterruptedException e) {
                p.destroyForcibly();
            }
        }
        synchronized (ScoutProcess.class) {
            if (process == p) {
                process = null;
                startedAt = null;
            }
        }
    }

    private static void installHook() {
        if (hookInstalled) return;
        hookInstalled = true;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            Process p = process;
            if (p != null && p.isAlive()) {
                console(p, "stop");
                try {
                    if (!p.waitFor(15, TimeUnit.SECONDS)) p.destroyForcibly();
                } catch (InterruptedException e) {
                    p.destroyForcibly();
                }
            }
        }, "seedscout-shutdown"));
    }
}

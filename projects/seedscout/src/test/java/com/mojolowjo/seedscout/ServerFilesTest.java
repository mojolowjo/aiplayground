package com.mojolowjo.seedscout;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ServerFilesTest {
    @Test
    void propertiesHoldTheBriefsSettings() {
        String p = ServerFiles.serverProperties(-3796965907673005514L, 25599);
        assertTrue(p.contains("\nlevel-seed=-3796965907673005514\n"));
        assertTrue(p.contains("\nserver-ip=127.0.0.1\n"));
        assertTrue(p.contains("\nserver-port=25599\n"));
        assertTrue(p.contains("\nonline-mode=false\n"));
        assertTrue(p.contains("\nview-distance=3\n"));
        assertTrue(p.contains("\nsimulation-distance=2\n"));
        assertTrue(p.contains("\nmax-players=1\n"));
        assertTrue(p.contains("\nenable-rcon=false\n"));
        assertTrue(p.contains("\nenable-query=false\n"));
        assertTrue(p.contains("\nmax-tick-time=-1\n"), "chunk generation must not trip the watchdog");
    }

    @Test
    void withPropertyReplacesOrAppends() {
        assertEquals("a=1\nlevel-seed=5\n", ServerFiles.withProperty("a=1\nlevel-seed=4\n", "level-seed", "5"));
        assertEquals("a=1\nlevel-seed=5\n", ServerFiles.withProperty("a=1\n", "level-seed", "5"));
        assertEquals("a=1\nlevel-seed=5\n", ServerFiles.withProperty("a=1", "level-seed", "5"));
    }

    @Test
    void doneLine() {
        assertTrue(ServerFiles.isDoneLine("[12:34:56] [Server thread/INFO] [minecraft/DedicatedServer]: Done (123.456s)! For help, type \"help\""));
        assertFalse(ServerFiles.isDoneLine("[12:34:56] [Server thread/INFO]: Preparing spawn area: 45%"));
    }

    @Test
    void xmxAcceptsSizesAndFallsBack() {
        assertEquals("-Xmx5G", ServerFiles.xmx("5G", "5G"));
        assertEquals("-Xmx4096M", ServerFiles.xmx("4096m", "5G"));
        assertEquals("-Xmx5G", ServerFiles.xmx("lots", "5G"));
        assertEquals("-Xmx5G", ServerFiles.xmx(null, "5G"));
    }

    @Test
    void argsFileAndInstallerNames() {
        assertEquals("libraries/net/minecraftforge/forge/1.20.1-47.4.2/unix_args.txt", ServerFiles.argsFile(false));
        assertEquals("libraries/net/minecraftforge/forge/1.20.1-47.4.2/win_args.txt", ServerFiles.argsFile(true));
        assertEquals("https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.2/forge-1.20.1-47.4.2-installer.jar", ServerFiles.INSTALLER_URL);
    }
}

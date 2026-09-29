# minecraft-bot

A plan for a bot that joins a friend's modded Minecraft server and takes orders
from chat: mine ores, build, and break blocks. No code yet. This file is the
handoff for a Claude Code session running on your own computer.

## Why it has to run on your computer

The cloud sessions can't open raw TCP connections, so they can't reach a
Minecraft server. That's true even with network access set to all domains. A
session on your laptop can.

## What we know

| Item | Value |
|---|---|
| Server address | `schmidt-comments.tun.ply.gg` (a playit.gg tunnel, resolves to `209.25.140.16`) |
| Port | **Unknown.** Playit tunnels usually use a non-default port. Get it from your friend or the Minecraft server list. |
| Modpack | NINE 0.0.5 |
| Minecraft version | 1.21.1 |
| Loader | NeoForge 21.1.249, with KubeJS |
| Server mode | Online, so the bot needs a Microsoft account that owns Java Edition |
| Bot account | A second account you own. Log in with the device code, never by typing the password into a script. |
| Permission | The server owner said yes. Ask them to whitelist the bot account. |

## Known risks

1. **NeoForge handshake.** Mineflayer speaks the vanilla protocol. A NeoForge
   server may refuse it or disconnect it during the mod handshake. Test this
   first, before building anything else.
2. **Modded blocks.** Mineflayer won't know the pack's modded ores and blocks.
   Vanilla ores work out of the box. Modded ones need mapping by name, if the
   server sends usable registry data.
3. **Anti-cheat.** Mine and move at normal speeds so the server doesn't kick the bot.

If the handshake fails, the fallback is a real headless NeoForge client with the
pack installed, driven by a mod or script. That's much more work, so only try
it if mineflayer can't connect.

## Plan

1. **Connection test.** Write a minimal mineflayer script that logs in with
   `auth: 'microsoft'` (device code), joins the server, prints chat, and then
   quits. Stop here if the handshake fails, and report the exact disconnect
   reason.
2. **Command bot.** It only obeys the owner's in-game name, which is set in config.
   - `!come`: walk to the owner (mineflayer-pathfinder)
   - `!mine <block> [count]`: find and dig blocks, such as `!mine iron_ore 10`
     (mineflayer-collectblock)
   - `!break`: break the block the owner is looking at
   - `!build <shape> <size>`: place blocks from the bot's inventory, such as
     `!build wall 5` or `!build floor 4`
   - `!stop`: cancel the current task
   - `!inv`: say what's in the inventory
3. **Config** goes in a `config.json` that's kept out of git:
   host, port, bot username, owner name, command prefix.

Keep all code in this folder, with its own `package.json` and `.gitignore`.
Never commit tokens: mineflayer caches its Microsoft login in a profiles folder,
and that folder goes in `.gitignore`.

## Running it

Requires Node.js 18 or newer.

```sh
cd projects/minecraft-bot
npm install
cp config.example.json config.json   # then fill in host, port, names
node bot.js
```

On first run it prints a Microsoft device code. Open the link, sign in with
the **bot's** account, and it will join the server.

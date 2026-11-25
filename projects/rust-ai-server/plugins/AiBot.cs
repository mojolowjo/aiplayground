using System;
using System.Collections.Generic;
using System.Text;
using Oxide.Core;
using Rust.Ai.Gen2;
using UnityEngine;
using UnityEngine.AI;

namespace Oxide.Plugins
{
    // One player-like bot. The body is a plain BasePlayer with no connection, so it looks and dies
    // like a real player. It finds paths on the game's own navmesh (the one NPC2 uses), but this
    // plugin moves the body itself, because a BasePlayer has no navigator.
    // Actions (chop, mine, barrel, loot) use the game's own melee, gather and loot code, so they
    // work the way they do for a player. There is no decision making: each runs only on command.
    // Chat (admins): /bot spawn|info|roam|stop|here|kill|chop|mine|barrel|loot|inv
    // Console/RCON: aibot.<same>
    [Info("AiBot", "mojolowjo", "0.4.0")]
    public class AiBot : RustPlugin
    {
        private const string PlayerPrefab = "assets/prefabs/player/player.prefab";
        private const string FileName = "AiBot";

        // Each name owns one bot ID for good, so a bot keeps its name, face and body through deaths
        // and restarts. Bot IDs are user IDs below 10,000,000; the game hands them out counting up
        // from 1, so it won't reach this range. Add names to the end only, never reorder them.
        private const ulong FirstId = 9000001;
        private static readonly string[] Names = { "Dusty", "Marlow", "Kestrel", "Bramble", "Otis", "Wren", "Hatch", "Juniper" };
        private const float RespawnSeconds = 30f;
        private static readonly string[] Clothes = { "hoodie", "pants", "shoes.boots", "burlap.gloves", "hat.beenie" };
        private static readonly string[] Belt = { "stone.pickaxe", "stonehatchet", "bandage" };

        private class Saved
        {
            public string Name;
            public ulong Id;
            public float X, Y, Z, Yaw, Health;
            public bool Roaming = true;
            public List<SavedItem> Items; // null means a fresh kit
        }

        private class SavedItem
        {
            public string Name, Where;
            public int Amount, Slot;
            public ulong Skin;
            public float Condition;
        }

        private Saved saved;
        private BasePlayer bot;
        private Walker walker;
        private Timer respawnTimer, jobTimer;
        private Job job;

        private static bool OurId(ulong id) => id >= FirstId && id < FirstId + (ulong)Names.Length;

        // The game returns a destroyed bot's ID to its free pool, which would let its next bot take ours.
        private static void KeepIdsReserved()
        {
            var field = typeof(BasePlayer).GetField("freeBotIds", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            (field?.GetValue(null) as List<ulong>)?.RemoveAll(OurId);
        }

        #region Lifecycle

        private void OnServerInitialized()
        {
            try { saved = Interface.Oxide.DataFileSystem.ReadObject<Saved>(FileName); } catch { saved = null; }
            KeepIdsReserved();
            jobTimer = timer.Every(0.2f, TickJob);
            if (saved == null || string.IsNullOrEmpty(saved.Name)) { saved = null; return; }
            var index = Array.IndexOf(Names, saved.Name);
            if (index < 0) { Puts("Unknown bot name " + saved.Name + ", not restoring it."); saved = null; return; }
            saved.Id = FirstId + (ulong)index;
            var why = SpawnBody(new Vector3(saved.X, saved.Y, saved.Z), saved.Yaw);
            Puts(why ?? "Restored " + saved.Name);
        }

        private void OnServerSave() => Save();

        private void OnNewSave(string filename)
        {
            saved = null;
            Interface.Oxide.DataFileSystem.WriteObject(FileName, new Saved());
        }

        private void Unload()
        {
            EndJob(null);
            Save();
            respawnTimer?.Destroy();
            jobTimer?.Destroy();
            RemoveBody();
        }

        private bool Alive => bot != null && !bot.IsDestroyed && bot.IsAlive();

        private void Save()
        {
            if (saved != null && Alive)
            {
                var p = bot.transform.position;
                saved.X = p.x; saved.Y = p.y; saved.Z = p.z;
                saved.Yaw = bot.viewAngles.y;
                saved.Health = bot.health;
                saved.Roaming = walker.Roaming;
                saved.Items = SaveItems(bot);
            }
            Interface.Oxide.DataFileSystem.WriteObject(FileName, saved ?? new Saved());
        }

        // Returns null on success, otherwise the reason.
        private string SpawnBody(Vector3 near, float yaw)
        {
            Vector3 pos;
            if (!Walker.Nearest(near, 5f, out pos) && !Walker.Nearest(near, 30f, out pos))
                return "No walkable ground near " + near;
            if (Walker.WaterDepth(pos) > Walker.MaxWater) return "That spot is under water.";
            KeepIdsReserved();

            var player = GameManager.server.CreateEntity(PlayerPrefab, pos, Quaternion.identity) as BasePlayer;
            if (player == null) return "Could not create a player entity.";
            player.enableSaving = false; // the data file is the save
            // A preset ID skips the game's bot ID pool, so register it as a bot the way the game does.
            player.userID = saved.Id;
            player.UserIDString = saved.Id.ToString();
            player.Spawn();
            if (!BasePlayer.bots.Contains(player)) BasePlayer.bots.Add(player);
            BasePlayer.botColliderWorkQueue.Add(player);
            player.displayName = saved.Name;
            player.InitializeHealth(saved.Health > 0f ? saved.Health : 100f, 100f);
            player.metabolism.calories.value = player.metabolism.calories.max;
            player.metabolism.hydration.value = player.metabolism.hydration.max;

            if (saved.Items == null || saved.Items.Count == 0)
            {
                foreach (var item in Clothes) Give(player, item, player.inventory.containerWear);
                foreach (var item in Belt) Give(player, item, player.inventory.containerBelt);
            }
            else LoadItems(player, saved.Items);
            var held = player.inventory.containerBelt.GetSlot(0);
            if (held != null) player.UpdateActiveItem(held.uid);

            bot = player;
            walker = player.gameObject.AddComponent<Walker>();
            walker.Init(player, yaw, saved.Roaming);
            player.SendNetworkUpdateImmediate();
            return null;
        }

        private static void Give(BasePlayer player, string shortname, ItemContainer where)
        {
            var item = ItemManager.CreateByName(shortname);
            if (item != null && !item.MoveToContainer(where)) item.Remove();
        }

        private static ItemContainer[] Containers(BasePlayer p) =>
            new[] { p.inventory.containerBelt, p.inventory.containerMain, p.inventory.containerWear };
        private static readonly string[] ContainerNames = { "belt", "main", "wear" };

        // Plain items only (no contents or ammo), which is all the bot gets: tools, clothes, resources.
        private static List<SavedItem> SaveItems(BasePlayer p)
        {
            var list = new List<SavedItem>();
            var cs = Containers(p);
            for (var c = 0; c < cs.Length; c++)
                foreach (var i in cs[c].itemList)
                    list.Add(new SavedItem { Name = i.info.shortname, Where = ContainerNames[c], Amount = i.amount, Slot = i.position, Skin = i.skin, Condition = i.hasCondition ? i.condition : -1f });
            return list;
        }

        private static void LoadItems(BasePlayer p, List<SavedItem> list)
        {
            var cs = Containers(p);
            foreach (var s in list)
            {
                var c = Array.IndexOf(ContainerNames, s.Where);
                var item = ItemManager.CreateByName(s.Name, Math.Max(1, s.Amount), s.Skin);
                if (item == null || c < 0) { item?.Remove(); continue; }
                if (s.Condition >= 0f && item.hasCondition) item.condition = s.Condition;
                if (!item.MoveToContainer(cs[c], s.Slot) && !item.MoveToContainer(cs[c])) item.Remove();
            }
        }

        private void RemoveBody()
        {
            EndJob(null);
            if (walker != null) UnityEngine.Object.DestroyImmediate(walker);
            if (bot != null && !bot.IsDestroyed) bot.Kill();
            bot = null;
            walker = null;
            NextTick(KeepIdsReserved);
        }

        // The game makes the corpse and removes the dead body by itself. The same bot comes back
        // at a random spawn point a little later, with fresh gear, like a player respawning.
        private void OnEntityDeath(BasePlayer player, HitInfo info)
        {
            if (player == null || player != bot) return;
            Puts(saved?.Name + " died at " + player.transform.position);
            EndJob(saved?.Name + " died.");
            if (walker != null) UnityEngine.Object.Destroy(walker);
            bot = null;
            walker = null;
            saved.Health = 0f;
            saved.Roaming = true;
            saved.Items = null; // the corpse keeps them; respawn with a fresh kit
            Save();
            timer.Once(5f, KeepIdsReserved);
            respawnTimer?.Destroy();
            respawnTimer = timer.Once(RespawnSeconds, Respawn);
        }

        private void Respawn()
        {
            if (saved == null || Alive) return;
            for (var i = 0; i < 5; i++)
            {
                var point = ServerMgr.FindSpawnPoint(null, 0UL);
                if (point == null) continue;
                if (SpawnBody(point.pos, point.rot.eulerAngles.y) != null) continue;
                Puts(saved.Name + " respawned at " + bot.transform.position);
                Save();
                return;
            }
            Puts("Could not respawn " + saved.Name + ", trying again in " + RespawnSeconds + " s");
            respawnTimer = timer.Once(RespawnSeconds, Respawn);
        }

        #endregion

        #region Commands

        private string Run(string verb, BasePlayer user)
        {
            switch (verb)
            {
                case "spawn":
                {
                    if (Alive) return saved.Name + " is already here. Use /bot here, or /bot kill first.";
                    respawnTimer?.Destroy();
                    Vector3 pos;
                    if (user != null) pos = InFrontOf(user);
                    else
                    {
                        var point = ServerMgr.FindSpawnPoint(null, 0UL);
                        if (point == null) return "No spawn point found.";
                        pos = point.pos;
                    }
                    var index = saved != null ? Array.IndexOf(Names, saved.Name) : -1; // dead, waiting to respawn
                    if (index < 0) index = UnityEngine.Random.Range(0, Names.Length);
                    saved = new Saved { Name = Names[index], Id = FirstId + (ulong)index, Roaming = user == null };
                    var why = SpawnBody(pos, user != null ? user.viewAngles.y + 180f : 0f);
                    if (why != null) { saved = null; return why; }
                    Save();
                    return "Spawned " + saved.Name + (saved.Roaming ? ", roaming." : ". Use /bot roam to let it walk.");
                }
                case "info": return Info();
                case "kill":
                    if (saved == null) return "No bot.";
                    respawnTimer?.Destroy();
                    RemoveBody();
                    saved = null;
                    Save();
                    return "Bot removed.";
            }
            if (!Alive) return "No bot. Use /bot spawn.";
            switch (verb)
            {
                case "roam": EndJob(null); walker.SetRoaming(true); Save(); return saved.Name + " is roaming.";
                case "stop": EndJob(null); walker.SetRoaming(false); Save(); return saved.Name + " stopped.";
                case "inv": return Inventory();
                case "chop": case "mine": case "barrel": case "loot": return StartJob(verb, user);
                case "here":
                    if (user == null) return "Only works in game.";
                    Vector3 to;
                    if (!Walker.Nearest(InFrontOf(user), 10f, out to)) return "No walkable ground in front of you.";
                    EndJob(null);
                    walker.SetRoaming(false);
                    walker.TeleportTo(to);
                    walker.Face(user.transform.position);
                    Save();
                    return saved.Name + " is here, standing still.";
            }
            return "Use spawn, info, roam, stop, here, kill, chop, mine, barrel, loot or inv.";
        }

        private static Vector3 InFrontOf(BasePlayer user)
        {
            var dir = Quaternion.Euler(0f, user.viewAngles.y, 0f) * Vector3.forward;
            return user.transform.position + dir * 4f;
        }

        private string Info()
        {
            if (!Alive)
                return (saved != null ? saved.Name + " is dead and respawns within " + RespawnSeconds + " s." : "No bot.") + " Server fps " + Performance.current.frameRate;
            var sb = new StringBuilder();
            sb.AppendLine(saved.Name + "  id " + bot.UserIDString + "  health " + bot.health.ToString("0"));
            sb.AppendLine("pos " + bot.transform.position + " (" + MapHelper.PositionToString(bot.transform.position) + ")  water " + Walker.WaterDepth(bot.transform.position).ToString("0.0") + " m");
            sb.AppendLine("wearing " + ItemNames(bot.inventory.containerWear) + "; belt " + ItemNames(bot.inventory.containerBelt));
            sb.AppendLine(job != null ? "job: " + job.Describe(bot) : "job: none");
            sb.Append(walker.Describe());
            sb.Append("\nserver fps " + Performance.current.frameRate);
            return sb.ToString();
        }

        private static string ItemNames(ItemContainer c)
        {
            var names = new List<string>();
            foreach (var i in c.itemList) names.Add(i.info.shortname);
            return string.Join(", ", names);
        }

        [ChatCommand("bot")]
        private void ChatBot(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin) return;
            SendReply(player, Run(args.Length > 0 ? args[0].ToLowerInvariant() : "", player));
        }

        private void FromConsole(ConsoleSystem.Arg arg, string verb)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            arg.ReplyWith(Run(verb, arg.Player()));
        }

        [ConsoleCommand("aibot.spawn")] private void ConSpawn(ConsoleSystem.Arg arg) => FromConsole(arg, "spawn");
        [ConsoleCommand("aibot.info")] private void ConInfo(ConsoleSystem.Arg arg) => FromConsole(arg, "info");
        [ConsoleCommand("aibot.roam")] private void ConRoam(ConsoleSystem.Arg arg) => FromConsole(arg, "roam");
        [ConsoleCommand("aibot.stop")] private void ConStop(ConsoleSystem.Arg arg) => FromConsole(arg, "stop");
        [ConsoleCommand("aibot.here")] private void ConHere(ConsoleSystem.Arg arg) => FromConsole(arg, "here");
        [ConsoleCommand("aibot.kill")] private void ConKill(ConsoleSystem.Arg arg) => FromConsole(arg, "kill");
        [ConsoleCommand("aibot.chop")] private void ConChop(ConsoleSystem.Arg arg) => FromConsole(arg, "chop");
        [ConsoleCommand("aibot.mine")] private void ConMine(ConsoleSystem.Arg arg) => FromConsole(arg, "mine");
        [ConsoleCommand("aibot.barrel")] private void ConBarrel(ConsoleSystem.Arg arg) => FromConsole(arg, "barrel");
        [ConsoleCommand("aibot.loot")] private void ConLoot(ConsoleSystem.Arg arg) => FromConsole(arg, "loot");
        [ConsoleCommand("aibot.inv")] private void ConInv(ConsoleSystem.Arg arg) => FromConsole(arg, "inv");

        // The game runs a bot's client commands on the server (BasePlayer.BotCommand). Gathering and
        // pickups send "note.inv" (the item popup), which the server doesn't know, so every hit
        // would log "Command 'note.inv' not found". This swallows it. Real clients are unaffected:
        // theirs goes over the network, not through the server's command list.
        [ConsoleCommand("note.inv")] private void BotNote(ConsoleSystem.Arg arg) { }

        #endregion

        #region Actions

        private const float SearchRadius = 120f, Reach = 2.4f;

        // One action at a time. Phases: walk to the target, then work it (swing at it, or take
        // what is inside), then for a barrel pick up what it dropped.
        private class Job
        {
            public string Kind, Phase = "walk", Note = "";
            public BaseEntity Target;
            public Vector3 Spot;
            public BasePlayer Asker;
            public Dictionary<string, int> Before;
            public float Next, Until, Started;
            public bool Approached, Opened, Stepped;
            public int Swings, Taken, Misses;
            public string LastHit;
            public List<BaseEntity> Drops;

            public string Describe(BasePlayer bot)
            {
                var d = Target != null && !Target.IsDestroyed ? ", " + Vector3.Distance(bot.transform.position, Target.transform.position).ToString("0") + " m away" : "";
                return Kind + " " + Phase + d + ", " + Swings + " swings (" + Misses + " misses in a row" + (LastHit != null ? ", last miss hit " + LastHit : "") + "), " + Taken + " items taken, " + (Time.time - Started).ToString("0") + " s";
            }
        }

        private static ResourceDispenser.GatherType GatherOf(BaseEntity e)
        {
            var d = e.GetComponent<ResourceDispenser>();
            return d != null ? d.gatherType : ResourceDispenser.GatherType.UNSET;
        }

        private static string Noun(string kind) =>
            kind == "chop" ? "tree" : kind == "mine" ? "ore node" : kind == "barrel" ? "barrel" : "crate";

        private static bool Matches(string kind, BaseEntity e)
        {
            if (e.HasParent()) return false;
            switch (kind)
            {
                // By what the node gives, not its class: wood piles are ore entities that give wood.
                case "chop": return e is ResourceEntity && GatherOf(e) == ResourceDispenser.GatherType.Tree;
                case "mine": return e is ResourceEntity && GatherOf(e) == ResourceDispenser.GatherType.Ore;
                case "barrel": return e is LootContainer && e.ShortPrefabName.Contains("barrel");
                case "loot":
                    var lc = e as LootContainer;
                    return lc != null && e.ShortPrefabName.Contains("crate") && !e.ShortPrefabName.Contains("hack")
                        && !lc.IsLocked() && lc.inventory != null && lc.inventory.itemList.Count > 0;
            }
            return false;
        }

        private string StartJob(string kind, BasePlayer asker)
        {
            EndJob(null);
            var from = bot.transform.position;
            var found = new List<BaseEntity>();
            foreach (var net in BaseNetworkable.serverEntities)
            {
                var e = net as BaseEntity;
                if (e == null || e.IsDestroyed || !Matches(kind, e)) continue;
                if ((e.transform.position - from).sqrMagnitude > SearchRadius * SearchRadius) continue;
                if (Walker.WaterDepth(e.transform.position) > Walker.MaxWater) continue;
                found.Add(e);
            }
            if (found.Count == 0) return "No " + Noun(kind) + " within " + SearchRadius + " m.";
            found.Sort((a, b) => (a.transform.position - from).sqrMagnitude.CompareTo((b.transform.position - from).sqrMagnitude));

            var j = new Job { Kind = kind, Asker = asker, Before = Counts(bot), Started = Time.time };
            var tried = 0;
            foreach (var e in found)
            {
                if (++tried > 8) break;
                j.Target = e;
                if (InReach(j)) break;
                Vector3 spot;
                if (!Walker.Nearest(e.transform.position, 4f, out spot)) { j.Target = null; continue; }
                if (walker.GoTo(spot, Vector3.Distance(from, spot) > 20f)) { j.Spot = spot; break; }
                j.Target = null;
            }
            if (j.Target == null) return "Found " + found.Count + " " + Noun(kind) + "s, but could not find a path to the nearest " + Math.Min(found.Count, 8) + ".";
            job = j;
            walker.Working = true;
            var dist = Vector3.Distance(from, j.Target.transform.position);
            j.Until = Time.time + 20f + dist / 2f;
            return saved.Name + " is going to the " + Noun(kind) + " " + dist.ToString("0") + " m away (" + j.Target.ShortPrefabName + ").";
        }

        // Stops the job; with a message, reports what it gained to the admin who asked and the log.
        private void EndJob(string why)
        {
            var j = job;
            if (j == null) return;
            job = null;
            if (Alive)
            {
                if (bot.inventory.loot.IsLooting()) bot.inventory.loot.Clear();
                walker.Working = false;
                walker.Halt();
            }
            if (why == null) return;
            var gained = new List<string>();
            if (Alive)
            {
                foreach (var kv in Counts(bot))
                {
                    int had;
                    j.Before.TryGetValue(kv.Key, out had);
                    if (kv.Value > had) gained.Add("+" + (kv.Value - had) + " " + kv.Key);
                }
            }
            var msg = why + (gained.Count > 0 ? " Got " + string.Join(", ", gained) + "." : " Got nothing.") + " (" + (Time.time - j.Started).ToString("0") + " s, " + j.Swings + " swings)";
            Puts(msg);
            if (j.Asker != null && j.Asker.IsConnected) SendReply(j.Asker, msg);
        }

        private static Dictionary<string, int> Counts(BasePlayer p)
        {
            var d = new Dictionary<string, int>();
            foreach (var c in Containers(p))
                foreach (var i in c.itemList)
                {
                    int n;
                    d.TryGetValue(i.info.displayName.english, out n);
                    d[i.info.displayName.english] = n + i.amount;
                }
            return d;
        }

        private bool InReach(Job j)
        {
            var t = j.Target;
            if (t is TreeEntity)
            {
                var flat = t.transform.position - bot.transform.position;
                flat.y = 0f;
                return flat.magnitude <= Reach + 0.6f;
            }
            var eyes = bot.eyes.position;
            return Vector3.Distance(eyes, t.ClosestPoint(eyes)) <= Reach;
        }

        private void TickJob()
        {
            var j = job;
            if (j == null) return;
            if (!Alive) { job = null; return; }
            if (Time.time < j.Next) return;
            var t = j.Target;
            var gone = t == null || t.IsDestroyed;
            var name = saved.Name;

            switch (j.Phase)
            {
                case "walk":
                    if (gone) { EndJob(name + ": the " + Noun(j.Kind) + " was gone before it got there."); return; }
                    if (InReach(j))
                    {
                        walker.Halt();
                        j.Phase = j.Kind == "loot" ? "take" : "work";
                        j.Until = Time.time + 120f;
                        j.Next = Time.time + 0.3f;
                        return;
                    }
                    if (walker.Busy)
                    {
                        if (Time.time > j.Until) EndJob(name + " took too long getting to the " + Noun(j.Kind) + ".");
                        return;
                    }
                    var flat = t.transform.position - bot.transform.position;
                    flat.y = 0f;
                    if (!j.Approached && flat.magnitude < 10f)
                    {
                        // The navmesh stops short of trees, rocks and crates; walk the last bit straight.
                        j.Approached = true;
                        walker.WalkStraight(t.transform.position - flat.normalized * 1f);
                        return;
                    }
                    EndJob(name + " could not reach the " + Noun(j.Kind) + " (" + flat.magnitude.ToString("0.0") + " m short).");
                    return;

                case "work":
                    if (gone || (t is BaseCombatEntity && ((BaseCombatEntity)t).IsDead()))
                    {
                        if (j.Kind != "barrel") { EndJob(name + " finished the " + Noun(j.Kind) + "."); return; }
                        j.Phase = "pickup";
                        j.Spot = t != null ? t.transform.position : bot.transform.position;
                        j.Next = Time.time + 0.8f; // let the drops land
                        return;
                    }
                    if (Time.time > j.Until) { EndJob(name + " gave up on the " + Noun(j.Kind) + "."); return; }
                    if (!InReach(j)) { j.Phase = "walk"; j.Approached = false; j.Until = Time.time + 20f; return; }
                    if (walker.Busy) return; // stepping closer
                    if (j.Misses >= 8) { EndJob(name + " kept missing the " + Noun(j.Kind) + " (last swing hit " + j.LastHit + ") and gave up."); return; }
                    if (j.Misses >= 2 && j.Misses % 2 == 0 && !j.Stepped)
                    {
                        // Two misses in a row: out of the tool's reach, or something in the way. Step in.
                        j.Stepped = true;
                        var toward = t.transform.position - bot.transform.position;
                        toward.y = 0f;
                        walker.WalkStraight(bot.transform.position + toward.normalized * 0.6f);
                        return;
                    }
                    if (j.Misses % 2 == 1) j.Stepped = false;
                    var melee = EquipTool(j);
                    if (melee == null) return; // switching, or EndJob already said why
                    if (melee.HasAttackCooldown()) return;
                    Swing(j, melee);
                    return;

                case "pickup":
                    if (j.Drops == null) j.Drops = DropsNear(j.Spot);
                    j.Drops.RemoveAll(d => d == null || d.IsDestroyed);
                    if (j.Drops.Count == 0) { EndJob(name + " broke the barrel and picked up the loot."); return; }
                    var drop = j.Drops[0];
                    if (Vector3.Distance(bot.eyes.position, drop.ClosestPoint(bot.eyes.position)) <= Reach)
                    {
                        walker.Halt();
                        walker.Face(drop.transform.position);
                        if (!PickUp(drop)) { EndJob(name + "'s inventory is full."); return; }
                        j.Drops.RemoveAt(0);
                        j.Approached = false;
                        j.Next = Time.time + 0.5f;
                        return;
                    }
                    if (walker.Busy) return;
                    if (!j.Approached) { j.Approached = true; walker.WalkStraight(drop.transform.position); return; }
                    j.Drops.RemoveAt(0); // couldn't get to this one
                    j.Approached = false;
                    return;

                case "take":
                    if (gone) { EndJob(name + " looted the crate."); return; }
                    var sc = t as StorageContainer;
                    walker.Face(t.CenterPoint());
                    if (!j.Opened)
                    {
                        j.Opened = true;
                        // The same call a player's "open" makes. The bot has no client, so nothing shows.
                        try { sc.PlayerOpenLoot(bot, "", false); }
                        catch (Exception ex) { Puts("PlayerOpenLoot failed, taking items directly: " + ex.Message); }
                        j.Next = Time.time + 0.6f;
                        return;
                    }
                    var items = sc.inventory.itemList;
                    if (items.Count > 0)
                    {
                        if (!bot.inventory.GiveItem(items[0])) { EndJob(name + "'s inventory is full."); return; }
                        j.Taken++;
                        j.Next = Time.time + 0.35f;
                        return;
                    }
                    // Closing the loot is what makes an empty crate go away, as for a player.
                    if (bot.inventory.loot.IsLooting() && bot.inventory.loot.entitySource == t) bot.inventory.loot.Clear();
                    else sc.PlayerStoppedLooting(bot);
                    EndJob(name + " looted the crate" + (t.IsDestroyed ? " and it despawned, empty." : "; it is empty but still there."));
                    return;
            }
        }

        // The best melee tool on the belt for this target, made the active item.
        private BaseMelee EquipTool(Job j)
        {
            var type = GatherOf(j.Target);
            Item best = null;
            var bestScore = 0f;
            foreach (var item in bot.inventory.containerBelt.itemList)
            {
                var m = item.GetHeldEntity() as BaseMelee;
                if (m == null || m.IsItemBroken()) continue;
                var score = type == ResourceDispenser.GatherType.UNSET ? m.TotalDamage() : m.GetGatherInfoFromIndex(type).gatherDamage;
                if (score > bestScore) { best = item; bestScore = score; }
            }
            if (best == null) { EndJob(saved.Name + " has no working tool for the " + Noun(j.Kind) + "."); return null; }
            if (bot.GetActiveItem() != best)
            {
                bot.UpdateActiveItem(best.uid);
                j.Next = Time.time + 0.8f; // deploy time
                return null;
            }
            return best.GetHeldEntity() as BaseMelee;
        }

        private static readonly System.Reflection.FieldInfo TreeMarker = typeof(TreeEntity).GetField("xMarker", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        private static readonly System.Reflection.FieldInfo OreSpot = typeof(OreResourceEntity).GetField("_hotSpot", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        // Where a player would swing: the tree's X marker or the ore's glowing spot when there is
        // one (those give the bonus), otherwise the trunk at chest height or the middle of the object.
        private Vector3 AimPoint(BaseEntity t, Vector3 eyes)
        {
            var field = t is TreeEntity ? TreeMarker : t is OreResourceEntity ? OreSpot : null;
            var spot = field?.GetValue(t) as Component;
            if (spot != null && spot.gameObject.activeInHierarchy) return spot.transform.position;
            if (t is TreeEntity)
            {
                var p = t.transform.position;
                p.y = Mathf.Max(p.y + 0.5f, eyes.y - 0.4f);
                return p;
            }
            return t.CenterPoint();
        }

        private void Swing(Job j, BaseMelee melee)
        {
            var t = j.Target;
            walker.Face(AimPoint(t, bot.eyes.position));
            melee.StartAttackCooldown(melee.repeatDelay);
            bot.SignalBroadcast(BaseEntity.Signal.Attack, string.Empty, null);
            if (melee.swingEffect.isValid)
                Effect.server.Run(melee.swingEffect.resourcePath, melee.transform.position, Vector3.forward, null, false);
            j.Swings++;
            // The hit lands a moment into the swing animation.
            timer.Once(0.3f, () =>
            {
                if (!Alive || melee == null || melee.IsDestroyed || job != j) return;
                var hit = Strike(melee);
                if (hit == t) { j.Misses = 0; return; }
                j.Misses++;
                j.LastHit = hit == null ? "nothing" : hit is BasePlayer ? ((BasePlayer)hit).displayName : hit.ShortPrefabName;
                Puts(saved.Name + "'s swing at the " + Noun(j.Kind) + " hit " + j.LastHit + " instead");
            });
        }

        private readonly List<RaycastHit> traceHits = new List<RaycastHit>();

        // A swing like a player's: it hits whatever is first along the bot's view, within the tool's
        // reach, not the thing it meant to hit. A player's client does this trace; the bot has no
        // client, so this is the game's own server-side melee trace (BaseMelee.ServerUse_Strike,
        // used for its AI): a thin ray first, then a fatter one. Because it starts at the eyes and
        // stops at the tool's reach, it also meets the server's anti-cheat rules for player hits
        // (distance and line of sight). The hit then goes through the tool's own player attack
        // code, which damages, gathers, wears the tool and plays effects. Returns what it hit.
        private BaseEntity Strike(BaseMelee melee)
        {
            var eyes = bot.eyes.position;
            var dir = bot.eyes.rotation * Vector3.forward;
            for (var pass = 0; pass < 2; pass++)
            {
                traceHits.Clear();
                var ray = new Ray(eyes - dir * (pass == 1 ? 0.2f : 0f), dir);
                GamePhysics.TraceAll(ray, pass == 1 ? melee.attackRadius : 0f, traceHits, melee.maxDistance + 0.2f, 1220225809, QueryTriggerInteraction.UseGlobal, null);
                foreach (var hit in traceHits)
                {
                    var e = hit.GetEntity();
                    if (e != null && (e == bot || e.EqualNetID(bot) || e.isClient)) continue;
                    var info = new HitInfo
                    {
                        Initiator = bot,
                        Weapon = melee,
                        WeaponPrefab = melee,
                        HitEntity = e,
                        PointStart = eyes,
                        HitPositionWorld = hit.point,
                        PointEnd = hit.point,
                        HitNormalWorld = hit.normal,
                        damageProperties = melee.damageProperties,
                    };
                    var mat = hit.collider != null ? hit.collider.sharedMaterial : null;
                    info.HitMaterial = e is BasePlayer || e is BaseNpc ? StringPool.Get("Flesh")
                        : StringPool.Get(mat != null ? AssetNameCache.GetName(mat) : "generic");
                    melee.DoAttackShared(info); // also hits terrain and rock faces, like a player
                    return e;
                }
            }
            return null; // swung at air
        }

        private static List<BaseEntity> DropsNear(Vector3 at)
        {
            var list = new List<BaseEntity>();
            foreach (var net in BaseNetworkable.serverEntities)
            {
                var e = net as BaseEntity;
                if (e == null || e.IsDestroyed || (e.transform.position - at).sqrMagnitude > 16f) continue;
                if ((e is WorldItem && ((WorldItem)e).item != null && ((WorldItem)e).allowPickup) || e is DroppedItemContainer) list.Add(e);
            }
            return list;
        }

        // Same steps as a player's pickup: take the item out of the world, then give it to the player.
        private bool PickUp(BaseEntity drop)
        {
            var w = drop as WorldItem;
            if (w != null)
            {
                var item = w.item;
                if (item == null) return true;
                w.RemoveItem();
                bot.GiveItem(item, BaseEntity.GiveItemReason.PickedUp);
                if (!w.IsDestroyed) w.Kill();
                bot.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item", null);
                job.Taken++;
                return true;
            }
            var bag = drop as DroppedItemContainer;
            if (bag == null || bag.inventory == null) return true;
            while (bag.inventory.itemList.Count > 0)
            {
                if (!bot.inventory.GiveItem(bag.inventory.itemList[0])) return false;
                job.Taken++;
            }
            bag.Kill();
            return true;
        }

        private string Inventory()
        {
            var sb = new StringBuilder(saved.Name + "'s inventory");
            var cs = Containers(bot);
            for (var c = 0; c < cs.Length; c++)
            {
                var parts = new List<string>();
                foreach (var i in cs[c].itemList)
                    parts.Add(i.info.displayName.english + (i.amount > 1 ? " x" + i.amount : "") + (i.hasCondition ? " (" + (i.conditionNormalized * 100f).ToString("0") + "%)" : ""));
                sb.Append("\n" + ContainerNames[c] + " (" + cs[c].itemList.Count + "/" + cs[c].capacity + "): " + (parts.Count > 0 ? string.Join(", ", parts) : "empty"));
            }
            return sb.ToString();
        }

        #endregion

        // Body movement and the wander routine. All movement code is in this class.
        private class Walker : MonoBehaviour
        {
            public const float MaxWater = 0.4f;
            private const float WalkSpeed = 2.6f, RunSpeed = 5.2f;
            private const float Step = 0.05f;
            private const float StuckSeconds = 3f, StuckDistance = 0.6f;
            private const float MaxStepUp = 1f, MaxDrop = 2f;

            private static readonly int GroundMask = LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed");
            private static readonly int BlockMask = LayerMask.GetMask("World", "Default", "Construction", "Deployed");

            public bool Roaming { get; private set; }
            public bool Working; // an action is running: no wandering or looking around
            public bool Busy => corners.Count > 0;

            private BasePlayer body;
            private readonly RustNavMeshPath path = new RustNavMeshPath();
            private readonly List<Vector3> corners = new List<Vector3>();
            private int corner;
            private Vector3 goal, lastDir = Vector3.forward;
            private float pitch, lookPitch;
            private float yaw, lookYaw, acc, speed, waitUntil, nextLook;
            private float stuckSince;
            private Vector3 stuckPos;
            private int stuckLevel;
            private string state = "standing";

            // Counters shown by /bot info.
            private float travelled, startedAt, deepest;
            private int trips, stucks, repaths, teleports, blocked, noGoal;

            public void Init(BasePlayer player, float startYaw, bool roam)
            {
                body = player;
                yaw = lookYaw = startYaw;
                startedAt = Time.time;
                lastDir = Quaternion.Euler(0f, yaw, 0f) * Vector3.forward;
                body.modelState.onground = true;
                SetLook();
                Roaming = roam;
                waitUntil = Time.time + 2f;
            }

            public void SetRoaming(bool on)
            {
                Roaming = on;
                waitUntil = Time.time + 1f;
                EndTrip("standing");
            }

            public void Face(Vector3 point)
            {
                var d = point - body.transform.position;
                lookYaw = Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
                // Tilt the head too (positive pitch looks down), so it looks at what it works on.
                var e = point - body.eyes.position;
                lookPitch = Mathf.Clamp(-Mathf.Atan2(e.y, new Vector2(e.x, e.z).magnitude) * Mathf.Rad2Deg, -80f, 80f);
            }

            public bool GoTo(Vector3 to, bool run)
            {
                if (!SetPath(to)) return false;
                speed = run ? RunSpeed : WalkSpeed;
                stuckLevel = 0;
                return true;
            }

            // A straight line, for the last few metres the navmesh doesn't cover.
            public void WalkStraight(Vector3 to)
            {
                corners.Clear();
                corners.Add(body.transform.position);
                corners.Add(to);
                corner = 1;
                goal = to;
                speed = WalkSpeed;
                stuckLevel = 0;
                state = "approaching";
                ResetStuck();
            }

            public void Halt() => EndTrip(Working ? "working" : "standing");

            public void TeleportTo(Vector3 pos)
            {
                corners.Clear();
                body.MovePosition(pos);
                ResetStuck();
            }

            private void Update()
            {
                acc += Time.deltaTime;
                if (acc < Step) return;
                var dt = Mathf.Min(acc, 0.25f);
                acc = 0f;
                if (body == null || body.IsDestroyed || body.IsDead()) return;
                if (body.IsWounded() || body.isMounted) { ResetStuck(); return; }

                if (corners.Count > 0) Walk(dt);
                else Idle();

                if (corners.Count > 0 || !Working) lookPitch = 0f; // eyes ahead while walking or idle
                yaw = Mathf.MoveTowardsAngle(yaw, lookYaw, 300f * dt);
                pitch = Mathf.MoveTowards(pitch, lookPitch, 200f * dt);
                SetLook();
            }

            private void Idle()
            {
                if (Working) return;
                if (Time.time >= nextLook)
                {
                    nextLook = Time.time + UnityEngine.Random.Range(1.5f, 4f);
                    if (Roaming) lookYaw += UnityEngine.Random.Range(-70f, 70f);
                }
                if (Roaming && Time.time >= waitUntil) PickTrip();
            }

            private void PickTrip()
            {
                var from = body.transform.position;
                for (var i = 0; i < 8; i++)
                {
                    // Prefer to carry on roughly the same way; widen the search as tries fail.
                    var turn = UnityEngine.Random.Range(-1f, 1f) * (35f + i * 20f);
                    var dir = Quaternion.Euler(0f, turn, 0f) * lastDir;
                    var dist = UnityEngine.Random.Range(30f, 100f) / (1f + i * 0.25f);
                    var want = from + dir * dist;
                    want.y = TerrainMeta.HeightMap.GetHeight(want);
                    Vector3 spot;
                    if (Nearest(want, 8f, out spot) && SetPath(spot))
                    {
                        speed = UnityEngine.Random.value < 0.4f ? RunSpeed : WalkSpeed;
                        stuckLevel = 0;
                        trips++;
                        return;
                    }
                }
                noGoal++;
                lastDir = -lastDir;
                waitUntil = Time.time + 2f;
                // Off the navmesh, or boxed in: nothing can be reached from here.
                if (noGoal % 4 == 0) Hop();
            }

            private bool SetPath(Vector3 to)
            {
                Vector3 from;
                corners.Clear();
                if (!Nearest(body.transform.position, 3f, out from)) return false;
                path.Reset();
                if (!RustNavMeshHelpers.CalculatePath(from, to, RustNavMeshHelpers.AllAreas, path, false)) return false;
                if (path.status != NavMeshPathStatus.PathComplete || path.corners.Count < 2) return false;
                var pts = new List<Vector3>();
                foreach (var c in path.corners) pts.Add(c.Value);
                if (Wet(pts)) return false;
                corners.AddRange(pts);
                corner = 1;
                goal = to;
                state = "travelling";
                ResetStuck();
                return true;
            }

            private static bool Wet(List<Vector3> pts)
            {
                for (var i = 1; i < pts.Count; i++)
                {
                    var n = Mathf.CeilToInt(Vector3.Distance(pts[i - 1], pts[i]) / 3f);
                    for (var k = 1; k <= n; k++)
                        if (WaterDepth(Vector3.Lerp(pts[i - 1], pts[i], k / (float)n)) > MaxWater) return true;
                }
                return false;
            }

            private void Walk(float dt)
            {
                var pos = body.transform.position;
                var left = speed * dt;
                var start = pos;
                while (left > 0f && corner < corners.Count)
                {
                    var flat = corners[corner] - pos;
                    flat.y = 0f;
                    var d = flat.magnitude;
                    if (d < 0.15f) { corner++; continue; }
                    var dir = flat / d;
                    var move = Mathf.Min(left, d);
                    Vector3 next;
                    if (Blocked(pos, dir) || !Ground(pos + dir * move, out next))
                    {
                        blocked++;
                        if (Vector3.Distance(pos, goal) < 2f) corner = corners.Count; // close enough
                        break;
                    }
                    left -= move;
                    pos = next;
                    lastDir = dir;
                    lookYaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
                }

                if (pos != start)
                {
                    travelled += Vector3.Distance(start, pos);
                    deepest = Mathf.Max(deepest, WaterDepth(pos));
                    body.MovePosition(pos);
                }
                if (corner >= corners.Count)
                {
                    EndTrip(Working ? "working" : "pausing");
                    waitUntil = Time.time + UnityEngine.Random.Range(1f, 7f);
                    return;
                }
                CheckStuck();
            }

            private static bool Blocked(Vector3 pos, Vector3 dir)
            {
                RaycastHit hit;
                return Physics.SphereCast(pos + Vector3.up * 1.3f - dir * 0.1f, 0.25f, dir, out hit, 0.5f, BlockMask, QueryTriggerInteraction.Ignore);
            }

            // Ground under a point at about the same height; false for cliffs, walls and deep water.
            private static bool Ground(Vector3 at, out Vector3 ground)
            {
                RaycastHit hit;
                ground = at;
                if (!Physics.Raycast(at + Vector3.up * MaxStepUp, Vector3.down, out hit, MaxStepUp + MaxDrop, GroundMask, QueryTriggerInteraction.Ignore)) return false;
                ground = hit.point;
                return WaterDepth(ground) <= MaxWater + 0.4f;
            }

            private void ResetStuck()
            {
                stuckSince = Time.time;
                stuckPos = body.transform.position;
            }

            private void CheckStuck()
            {
                if (Vector3.Distance(body.transform.position, stuckPos) > StuckDistance)
                {
                    ResetStuck();
                    stuckLevel = 0;
                    return;
                }
                if (Time.time - stuckSince < StuckSeconds) return;
                stucks++;
                stuckLevel++;
                ResetStuck();
                if (stuckLevel == 1)
                {
                    repaths++;
                    if (SetPath(goal)) return;
                    stuckLevel = 2;
                }
                if (stuckLevel == 2)
                {
                    lastDir = Quaternion.Euler(0f, UnityEngine.Random.Range(120f, 240f), 0f) * lastDir;
                    EndTrip("recovering");
                    var level = stuckLevel;
                    if (Roaming && !Working) PickTrip();
                    stuckLevel = level;
                    return;
                }
                Hop();
            }

            // Last resort: a few metres to the nearest good spot.
            private void Hop()
            {
                EndTrip("recovering");
                stuckLevel = 0;
                for (var i = 0; i < 20; i++)
                {
                    var r = UnityEngine.Random.insideUnitCircle.normalized * (2f + i * 0.5f);
                    Vector3 spot;
                    if (!Nearest(body.transform.position + new Vector3(r.x, 0f, r.y), 4f, out spot)) continue;
                    if (WaterDepth(spot) > MaxWater) continue;
                    if (Vector3.Distance(spot, body.transform.position) < 1f) continue;
                    teleports++;
                    TeleportTo(spot);
                    return;
                }
            }

            private void EndTrip(string newState)
            {
                corners.Clear();
                state = newState;
            }

            private void SetLook()
            {
                var rot = Quaternion.Euler(pitch, yaw, 0f);
                if (Mathf.Abs(Mathf.DeltaAngle(body.viewAngles.y, yaw)) > 0.5f || Mathf.Abs(Mathf.DeltaAngle(body.viewAngles.x, pitch)) > 0.5f)
                {
                    body.OverrideViewAngles(new Vector3(pitch, yaw, 0f));
                    body.eyes.rotation = rot;
                    body.transform.hasChanged = true;
                    if (corners.Count == 0) body.NetworkPositionTick();
                }
                var running = corners.Count > 0 && speed > WalkSpeed;
                if (body.modelState.sprinting != running || !body.modelState.onground)
                {
                    body.modelState.sprinting = running;
                    body.modelState.onground = true;
                    body.SendModelState();
                }
            }

            public string Describe()
            {
                var mins = (Time.time - startedAt) / 60f;
                return "roaming " + Roaming + ", looking " + body.viewAngles.x.ToString("0") + "° down, " + state + (corners.Count > 0 ? " to " + goal + " at " + speed + " m/s, " + Vector3.Distance(goal, body.transform.position).ToString("0") + " m left" : "")
                    + "\nsince spawn (" + mins.ToString("0.0") + " min): " + travelled.ToString("0") + " m, " + trips + " trips, stuck " + stucks
                    + " (repath " + repaths + ", teleport " + teleports + "), blocked steps " + blocked + ", no destination " + noGoal + ", deepest water " + deepest.ToString("0.0") + " m";
            }

            public static bool Nearest(Vector3 pos, float range, out Vector3 found)
            {
                NavMeshHit hit;
                found = pos;
                if (!RustNavMeshHelpers.SamplePosition(pos, out hit, range, RustNavMeshHelpers.AllAreas, false)) return false;
                found = hit.position;
                RaycastHit ground;
                if (Physics.Raycast(found + Vector3.up, Vector3.down, out ground, 3f, GroundMask, QueryTriggerInteraction.Ignore)) found = ground.point;
                return true;
            }

            public static float WaterDepth(Vector3 pos) => WaterLevel.GetWaterDepth(pos, false, false);
        }
    }
}

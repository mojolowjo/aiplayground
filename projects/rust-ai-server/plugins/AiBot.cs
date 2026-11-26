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
            Trails.Load();
            timer.Every(600f, Trails.Load); // pick up new recordings every 10 minutes
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
                case "unstuck":
                {
                    // An admin teleport out of a rock or wall, to the nearest walkable spot 2 to 8 m away.
                    var here = bot.transform.position;
                    for (var i = 0; i < 30; i++)
                    {
                        var r = UnityEngine.Random.insideUnitCircle.normalized * (2f + i * 0.2f);
                        Vector3 spot;
                        if (!Walker.Nearest(here + new Vector3(r.x, 0f, r.y), 2f, out spot) || Vector3.Distance(spot, here) < 1.5f) continue;
                        if (AntiHack.TestInsideTerrain(spot) || Physics.CheckCapsule(spot + Vector3.up * 0.6f, spot + Vector3.up * 1.4f, 0.34f, 1503731969, QueryTriggerInteraction.Ignore)) continue;
                        EndJob(null);
                        walker.TeleportTo(spot);
                        return saved.Name + " moved " + Vector3.Distance(spot, here).ToString("0.0") + " m to " + spot + ".";
                    }
                    return "No free spot nearby.";
                }
                case "chop": case "mine": case "barrel": case "loot": return StartJob(verb, user);
                case "path": return PathToCrosshair(user);
                case "route":
                {
                    var dump = walker.DumpRoute();
                    Puts("Route dump:\n" + dump); // full copy in the server console
                    return dump;
                }
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
            return "Use spawn, info, roam, stop, here, unstuck, kill, chop, mine, barrel, loot or inv.";
        }

        // /bot path (here): walk from wherever it is to the spot under your crosshair, with the
        // same route checks as roaming, and draw the route for you (admins only see the lines).
        private Timer pathDraw;

        private string PathToCrosshair(BasePlayer user)
        {
            if (user == null) return "Only works in game.";
            RaycastHit aim;
            if (!Physics.Raycast(user.eyes.HeadRay(), out aim, 400f, LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed"), QueryTriggerInteraction.Ignore))
                return "Point your crosshair at the ground (within 400 m).";
            Vector3 spot;
            if (!Walker.Nearest(aim.point, 6f, out spot)) return "That spot isn't walkable.";
            EndJob(null);
            walker.SetRoaming(false);
            var steep = walker.RejectedSteep;
            var blocked = walker.RejectedBlocked;
            if (!walker.GoTo(spot, Vector3.Distance(bot.transform.position, spot) > 25f))
            {
                var why = walker.lastPlanProblem != "" ? walker.lastPlanProblem : walker.RejectedSteep > steep ? "the only route climbs steeper than 45 degrees"
                    : walker.RejectedBlocked > blocked ? "the only route goes through a cliff, rock or wall it can't get past"
                    : "the map has no route there";
                return "No route for " + saved.Name + ": " + why + ".";
            }
            var route = walker.Route();
            DrawRoute(user, route);
            return saved.Name + " is walking there: " + RouteLength(route).ToString("0") + " m. Green line = its route, red dot = the end. It stops when it arrives; /bot roam to let it wander again.";
        }

        private void DrawRoute(BasePlayer user, List<Vector3> route)
        {
            pathDraw?.Destroy();
            var until = Time.time + 90f;
            Action draw = () =>
            {
                if (user == null || !user.IsConnected) return;
                var up = Vector3.up * 0.25f;
                for (var i = 1; i < route.Count; i++) user.SendConsoleCommand("ddraw.line", 3.2f, Color.green, route[i - 1] + up, route[i] + up);
                user.SendConsoleCommand("ddraw.sphere", 3.2f, Color.red, route[route.Count - 1] + up, 0.4f);
                if (Alive) user.SendConsoleCommand("ddraw.text", 3.2f, Color.white, bot.transform.position + Vector3.up * 2.2f, saved.Name + " " + walker.StateWord);
            };
            draw();
            pathDraw = timer.Every(3f, () => { if (Time.time > until || !Alive || !walker.Busy) { pathDraw?.Destroy(); return; } draw(); });
        }

        private static float RouteLength(List<Vector3> r)
        {
            var d = 0f;
            for (var i = 1; i < r.Count; i++) d += Vector3.Distance(r[i - 1], r[i]);
            return d;
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
        [ConsoleCommand("aibot.route")] private void ConRoute(ConsoleSystem.Arg arg) => FromConsole(arg, "route");
        [ConsoleCommand("aibot.unstuck")] private void ConUnstuck(ConsoleSystem.Arg arg) => FromConsole(arg, "unstuck");

        // Admin teleport to map coordinates: aibot.tp <x> <z>
        [ConsoleCommand("aibot.tp")]
        private void ConTp(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            if (!Alive) { arg.ReplyWith("No bot."); return; }
            var want = new Vector3(arg.GetFloat(0), 0f, arg.GetFloat(1));
            want.y = TerrainMeta.HeightMap.GetHeight(want);
            Vector3 spot;
            if (!Walker.Nearest(want, 10f, out spot)) { arg.ReplyWith("No walkable ground near there."); return; }
            EndJob(null);
            walker.TeleportTo(spot);
            Save();
            arg.ReplyWith(saved.Name + " moved to " + spot + " (" + MapHelper.PositionToString(spot) + ").");
        }

        // The game runs a bot's client commands on the server (BasePlayer.BotCommand). Gathering and
        // pickups send "note.inv" (the item popup), which the server doesn't know, so every hit
        // would log "Command 'note.inv' not found". This swallows it. Real clients are unaffected:
        // theirs goes over the network, not through the server's command list.
        [ConsoleCommand("note.inv")] private void BotNote(ConsoleSystem.Arg arg) { }

        #endregion

        #region Body

        // A player-sized Unity character controller on its own object: the collide-and-slide
        // body. Benched against every recorded player track: it reached 99.3% of 4,681 player
        // waypoints, and the server's no-clip check refused 0.16% of its moves (all at the
        // lighthouse). Step 0.5 m; slope limit 45 degrees (no recorded player climbed over 39).
        public class CharacterBody
        {
            private readonly GameObject go;
            private readonly CharacterController cc;
            public bool Bumped;
            public string BumpedInto = "";

            public CharacterBody(BasePlayer owner)
            {
                go = new GameObject("AiBot body");
                go.layer = LayerMask.NameToLayer("Player Movement");
                cc = go.AddComponent<CharacterController>();
                cc.radius = BasePlayer.GetRadius();
                cc.height = BasePlayer.GetHeight(false);
                cc.center = Vector3.up * (cc.height / 2f);
                cc.stepOffset = 0.5f;
                cc.slopeLimit = 50f; // the navigation map's own limit; steeper bits need a hop
                cc.skinWidth = 0.05f;
                cc.minMoveDistance = 0f;
                // Don't collide with the bot's own body.
                if (owner != null)
                    foreach (var c in owner.GetComponentsInChildren<Collider>(true))
                        if (c != null) Physics.IgnoreCollision(cc, c);
            }

            public Vector3 Position => go.transform.position;
            private static readonly int FootingMask = LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed", "Vehicle Large");
            public bool Grounded => cc.isGrounded;

            // On the ground and on something flat enough to stand on (within the slope limit),
            // i.e. somewhere a player could jump from. Touching a steep face doesn't count.
            public bool OnFooting
            {
                get
                {
                    if (!cc.isGrounded) return false;
                    RaycastHit hit;
                    return Physics.SphereCast(go.transform.position + Vector3.up * (cc.radius + 0.1f), cc.radius * 0.8f, Vector3.down, out hit, 0.4f, FootingMask, QueryTriggerInteraction.Ignore)
                        && Vector3.Angle(hit.normal, Vector3.up) <= cc.slopeLimit;
                }
            }

            public void Place(Vector3 pos)
            {
                if ((go.transform.position - pos).sqrMagnitude < 0.0004f) return;
                cc.enabled = false;
                go.transform.position = pos;
                cc.enabled = true;
            }

            public Vector3 Move(Vector3 motion)
            {
                var flags = cc.Move(motion);
                Bumped = (flags & CollisionFlags.Sides) != 0;
                if (Bumped)
                {
                    RaycastHit hit;
                    var flat = new Vector3(motion.x, 0f, motion.z);
                    BumpedInto = flat.sqrMagnitude > 0.000001f && Physics.SphereCast(go.transform.position + Vector3.up * 0.9f, cc.radius * 0.9f, flat.normalized, out hit, 0.6f, ~0, QueryTriggerInteraction.Ignore)
                        ? (hit.collider.GetComponentInParent<BaseEntity>()?.ShortPrefabName ?? hit.collider.transform.root.name) : "something";
                }
                return go.transform.position;
            }

            public void Park()
            {
                cc.enabled = false;
                go.transform.position = new Vector3(0f, -1000f, 0f);
            }

            public void Dispose()
            {
                if (go != null) UnityEngine.Object.Destroy(go);
            }
        }

        #endregion

        #region Player trails

        // Every movement recording (MoveLab) is a path a real player proved walkable, including
        // where they jumped. Where the bot's route is blocked and a player went through, the bot
        // follows the player's line there and jumps where they jumped. Loaded from
        // carbon\data\MoveLab at start, every 10 minutes, and on aibot.trails.
        public class TrailPoint
        {
            public Vector3 P;
            public bool Jump;  // the player jumped from here...
            public Vector3 Land; // ...and landed here
        }

        public static class Trails
        {
            public static readonly List<List<TrailPoint>> All = new List<List<TrailPoint>>();
            private static readonly Dictionary<long, List<KeyValuePair<int, int>>> grid = new Dictionary<long, List<KeyValuePair<int, int>>>();
            private const float GridCell = 2f;
            public static int Points, Jumps;

            private class Sample { public float X, Y, Z; public bool Ground, Jump; }
            private class Rec { public List<Sample> Samples; }

            private static string loadedSignature = "";

            // Reading the recordings takes about half a second, so it only happens when a
            // recording was added or changed.
            public static void Load()
            {
                string[] files;
                try { files = System.IO.Directory.GetFiles(System.IO.Path.Combine(Interface.Oxide.DataDirectory, "MoveLab"), "*.json"); }
                catch { return; }
                var sig = new StringBuilder();
                foreach (var file in files) sig.Append(file).Append(new System.IO.FileInfo(file).Length).Append('|');
                if (sig.ToString() == loadedSignature) return;
                loadedSignature = sig.ToString();
                All.Clear();
                grid.Clear();
                Points = Jumps = 0;
                foreach (var f in files)
                {
                    Rec rec;
                    try { rec = Interface.Oxide.DataFileSystem.ReadObject<Rec>("MoveLab/" + System.IO.Path.GetFileNameWithoutExtension(f)); }
                    catch { continue; }
                    if (rec?.Samples == null || rec.Samples.Count < 2) continue;
                    var trail = new List<TrailPoint>();
                    var s = rec.Samples;
                    for (var i = 0; i < s.Count; i++)
                    {
                        var p = new Vector3(s[i].X, s[i].Y, s[i].Z);
                        var jumpStart = s[i].Jump && (i == 0 || !s[i - 1].Jump) && s[i].Ground;
                        if (jumpStart)
                        {
                            // Where it came down: the first grounded sample after being in the air.
                            var air = false;
                            for (var k = i + 1; k < s.Count && k < i + 60; k++)
                            {
                                if (!s[k].Ground) air = true;
                                else if (air)
                                {
                                    trail.Add(new TrailPoint { P = p, Jump = true, Land = new Vector3(s[k].X, s[k].Y, s[k].Z) });
                                    Jumps++;
                                    break;
                                }
                            }
                            continue;
                        }
                        if (!s[i].Ground) continue;
                        if (trail.Count > 0 && !trail[trail.Count - 1].Jump && Vector3.Distance(trail[trail.Count - 1].P, p) < 0.4f) continue;
                        if (trail.Count > 0 && Vector3.Distance(trail[trail.Count - 1].P, p) > 4f && !trail[trail.Count - 1].Jump)
                        {
                            // A gap (teleport, respawn, lag): start a new trail.
                            AddTrail(trail);
                            trail = new List<TrailPoint>();
                        }
                        trail.Add(new TrailPoint { P = p });
                    }
                    AddTrail(trail);
                }
            }

            private static void AddTrail(List<TrailPoint> trail)
            {
                if (trail.Count < 3) return;
                var id = All.Count;
                All.Add(trail);
                for (var i = 0; i < trail.Count; i++)
                {
                    var key = Key(trail[i].P);
                    List<KeyValuePair<int, int>> list;
                    if (!grid.TryGetValue(key, out list)) grid[key] = list = new List<KeyValuePair<int, int>>();
                    list.Add(new KeyValuePair<int, int>(id, i));
                    Points++;
                }
            }

            private static long Key(Vector3 p) => ((long)Mathf.FloorToInt(p.x / GridCell) << 32) ^ (uint)Mathf.FloorToInt(p.z / GridCell);

            // Trail points within 'range' of a spot, as (trail, index).
            public static IEnumerable<KeyValuePair<int, int>> Near(Vector3 at, float range)
            {
                var r = Mathf.CeilToInt(range / GridCell);
                int cx = Mathf.FloorToInt(at.x / GridCell), cz = Mathf.FloorToInt(at.z / GridCell);
                for (var dx = -r; dx <= r; dx++)
                    for (var dz = -r; dz <= r; dz++)
                    {
                        List<KeyValuePair<int, int>> list;
                        if (!grid.TryGetValue(((long)(cx + dx) << 32) ^ (uint)(cz + dz), out list)) continue;
                        foreach (var kv in list)
                        {
                            var p = All[kv.Key][kv.Value].P;
                            if (new Vector2(p.x - at.x, p.z - at.z).magnitude <= range && Mathf.Abs(p.y - at.y) < 2f) yield return kv;
                        }
                    }
            }
        }

        [ConsoleCommand("aibot.trails")]
        private void ConTrails(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            Trails.Load();
            arg.ReplyWith("Player trails loaded: " + Trails.All.Count + " trails, " + Trails.Points + " points, " + Trails.Jumps + " jumps.");
        }

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
                        var refused = PickUp(drop);
                        if (refused != null) Puts(name + " could not pick up " + drop.ShortPrefabName + ": " + refused);
                        if (refused == "its inventory is full") { EndJob(name + "'s inventory is full."); return; }
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
                        var refusedOpen = OpenLoot(t);
                        if (refusedOpen != null) { EndJob(name + " could not open the crate: " + refusedOpen + "."); return; }
                        j.Next = Time.time + 0.6f;
                        return;
                    }
                    var items = sc.inventory.itemList;
                    if (items.Count > 0)
                    {
                        var refusedTake = TakeItem(items[0], t);
                        if (refusedTake != null) { EndJob(name + " stopped looting: " + refusedTake + "."); return; }
                        j.Taken++;
                        j.Next = Time.time + 0.35f;
                        return;
                    }
                    CloseLoot();
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

        #region Player messages

        // A player's client asks the server to do things with short messages (RPCs): "open this",
        // "pick this up", "move this item". The bot has no client, so it calls the same server
        // handlers with itself as the sender, after the same checks the server runs before a
        // handler (the [RPC_Server.IsVisible(3)] style rules: within 3 m and in plain sight).
        private const System.Reflection.BindingFlags AnyInstance = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic;
        private static readonly System.Reflection.MethodInfo CanMoveFrom = typeof(PlayerInventory).GetMethod("CanMoveItemsFrom", AnyInstance);

        // Private methods are not inherited for reflection, so look through the base classes too.
        private static System.Reflection.MethodInfo FindMethod(Type type, string name)
        {
            for (var t = type; t != null; t = t.BaseType)
            {
                var m = t.GetMethod(name, AnyInstance | System.Reflection.BindingFlags.DeclaredOnly);
                if (m != null) return m;
            }
            return null;
        }

        private BaseEntity.RPCMessage FromBot() => new BaseEntity.RPCMessage { player = bot, connection = null, read = null };

        // The crate's "open" handler (StorageContainer.RPC_OpenLoot, rule IsVisibleTwoWay(3)).
        // Returns null when the loot is open, otherwise why not.
        private string OpenLoot(BaseEntity box)
        {
            if (!BaseEntity.RPC_Server.IsVisibleTwoWay.Test(0u, "RPC_OpenLoot", box, bot, 3f)) return "it is not within 3 m in plain sight";
            var handler = FindMethod(box.GetType(), "RPC_OpenLoot");
            if (handler == null) return "it has no open handler";
            handler.Invoke(box, new object[] { FromBot() });
            return bot.inventory.loot.IsLooting() && bot.inventory.loot.entitySource == box ? null : "the game refused to open it";
        }

        // A quick-move out of the open loot into the bot's own inventory. That is the "move item"
        // handler (PlayerInventory.MoveItem) with no target container: the same refusals (locked
        // item or container, restrained, container's own move rule, not looting it), then the
        // same GiveItem. The handler itself reads its arguments from network bytes the bot can't
        // send, so its steps are repeated here. Returns null on success, otherwise why not.
        private string TakeItem(Item item, BaseEntity from)
        {
            if (item.IsLocked() || (item.parent != null && item.parent.IsLocked())) return "it is locked";
            if (bot.IsRestrainedOrSurrendering) return "it is restrained";
            if (!bot.inventory.loot.IsLooting() || bot.inventory.loot.entitySource != from) return "the loot is not open";
            if (CanMoveFrom != null)
            {
                var response = CanMoveFrom.Invoke(CanMoveFrom.IsStatic ? null : bot.inventory, new object[] { from, item });
                var allowed = response?.GetType().GetField("allowed");
                if (allowed != null && !(bool)allowed.GetValue(response)) return "the container does not allow it";
            }
            return bot.inventory.GiveItem(item) ? null : "its inventory is full";
        }

        // Closing the loot panel, which is what makes an empty crate or bag go away.
        private void CloseLoot()
        {
            if (bot.inventory.loot.IsLooting()) bot.inventory.loot.Clear();
        }

        // The pickup button: WorldItem.Pickup, rule IsVisible(3). A dropped bag is opened and
        // emptied instead, as a player would. Returns null on success, otherwise why not.
        private string PickUp(BaseEntity drop)
        {
            var w = drop as WorldItem;
            if (w != null)
            {
                if (w.item == null) return null;
                if (!BaseEntity.RPC_Server.IsVisible.Test(0u, "Pickup", w, bot, 3f)) return "it is not within 3 m in plain sight";
                w.Pickup(FromBot());
                if (w.item != null && !w.IsDestroyed) return "the game refused the pickup";
                job.Taken++;
                return null;
            }
            var bag = drop as DroppedItemContainer;
            if (bag == null || bag.inventory == null) return null;
            var why = OpenLoot(bag);
            if (why != null) return why;
            while (bag.inventory.itemList.Count > 0)
            {
                why = TakeItem(bag.inventory.itemList[0], bag);
                if (why != null) { CloseLoot(); return why; }
                job.Taken++;
            }
            CloseLoot();
            return null;
        }

        #endregion

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

            private static readonly int GroundMask = LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed", "Vehicle Large"); // Vehicle Large: the harbor bridge and other big things players stand on
            private static readonly int BlockMask = LayerMask.GetMask("World", "Default", "Construction", "Deployed", "Tree");

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
                Guard = new TickGuard(body);
                SetLook();
                Roaming = roam;
                waitUntil = Time.time + 2f;
            }

            public TickGuard Guard { get; private set; }

            public void SetRoaming(bool on)
            {
                if (on) Guard.Kicked = false;
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

            public List<Vector3> Route() => new List<Vector3>(corners);
            public string StateWord => state;

            // The route it's on, point by point: height compared with where it stands, which
            // points are jumps or from a player trail, and which one it's heading for.
            public string DumpRoute()
            {
                var pos = body.transform.position;
                var sb = new StringBuilder();
                sb.AppendLine("state: " + state + " | last stop: " + lastStop + (lastPlanProblem != "" ? " | last route turned down: " + lastPlanProblem : ""));
                if (corners.Count == 0) { sb.Append("no route right now"); return sb.ToString(); }
                sb.AppendLine("standing at " + pos.ToString("F1") + ", heading for point " + corner + " of " + (corners.Count - 1) + ", goal " + goal.ToString("F1") + " (" + (goal.y - pos.y).ToString("+0.0;-0.0") + " m)");
                var from = Mathf.Max(0, corner - 3);
                var to = Mathf.Min(corners.Count, corner + 25);
                for (var i = from; i < to; i++)
                {
                    var c = corners[i];
                    var prev = i > 0 ? corners[i - 1] : c;
                    var run = new Vector2(c.x - prev.x, c.z - prev.z).magnitude;
                    var slope = run > 0.05f ? Mathf.Atan2(c.y - prev.y, run) * Mathf.Rad2Deg : 0f;
                    sb.AppendLine((i == corner ? "-> " : "   ") + i + ": " + c.ToString("F1") + "  height " + (c.y - pos.y).ToString("+0.0;-0.0") + " m, step " + run.ToString("0.0") + " m at " + slope.ToString("0") + " deg"
                        + (cornerJumps.ContainsKey(i) ? "  [player jumped here]" : "") + (cornerTrusted.Contains(i) ? "  [player trail]" : "") + (c.y - prev.y > JumpReach && run < 1.5f ? "  !! higher than a jump" : ""));
                }
                if (to < corners.Count) sb.Append("   ... " + (corners.Count - to) + " more");
                return sb.ToString();
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
                corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
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

            // An admin teleport (/bot here): like the game's own teleport, it resets the
            // anti-cheat history instead of being checked.
            public void TeleportTo(Vector3 pos)
            {
                corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
                body.MovePosition(pos);
                Guard.Reset(pos);
                ResetStuck();
            }

            // Lag hunt: server frames slower than 100 ms, and the bot's own share of each frame.
            public int Hitches;
            public float WorstFrameMs, WorstBotMs, BotMsTotal;
            public int BotUpdates;
            private readonly System.Diagnostics.Stopwatch updateWatch = new System.Diagnostics.Stopwatch();

            private void Update()
            {
                var frameMs = Time.unscaledDeltaTime * 1000f;
                if (frameMs > 100f && Time.realtimeSinceStartup > 30f)
                {
                    Hitches++;
                    if (frameMs > WorstFrameMs) WorstFrameMs = frameMs;
                    Interface.Oxide.LogInfo("[AiBot] SERVER HITCH: a frame took " + frameMs.ToString("0") + " ms; the bot was " + state + "; its last update took " + lastUpdateMs.ToString("0.0") + " ms");
                }
                acc += Time.deltaTime;
                if (acc < Step) return;
                var dt = Mathf.Min(acc, 0.25f);
                acc = 0f;
                if (body == null || body.IsDestroyed || body.IsDead()) return;
                if (body.IsWounded() || body.isMounted) { ResetStuck(); return; }

                updateWatch.Reset();
                updateWatch.Start();
                if (jumping) Fly(dt);
                else if (corners.Count > 0) Walk(dt);
                else
                {
                    Settle(dt);
                    Idle();
                }

                if (corners.Count > 0 || !Working) lookPitch = 0f; // eyes ahead while walking or idle
                yaw = Mathf.MoveTowardsAngle(yaw, lookYaw, 300f * dt);
                pitch = Mathf.MoveTowards(pitch, lookPitch, 200f * dt);
                SetLook();
                updateWatch.Stop();
                lastUpdateMs = (float)updateWatch.Elapsed.TotalMilliseconds;
                BotUpdates++;
                BotMsTotal += lastUpdateMs;
                WorstBotMs = Mathf.Max(WorstBotMs, lastUpdateMs);
            }

            private float lastUpdateMs;

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
                var sw = System.Diagnostics.Stopwatch.StartNew();
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
                        LogPlan(sw, i + 1, true);
                        return;
                    }
                }
                LogPlan(sw, 8, false);
                noGoal++;
                lastDir = -lastDir;
                waitUntil = Time.time + 2f;
                // Off the navmesh, or boxed in: nothing can be reached from here.
                if (noGoal % 4 == 0) Hop();
            }

            // Lag hunt: how long picking a roam trip took (it all happens in one server frame).
            public float PlanMsTotal, PlanMsWorst;
            public int Plans;

            private void LogPlan(System.Diagnostics.Stopwatch sw, int tries, bool found)
            {
                var ms = (float)sw.Elapsed.TotalMilliseconds;
                Plans++;
                PlanMsTotal += ms;
                PlanMsWorst = Mathf.Max(PlanMsWorst, ms);
                if (ms > 20f) Interface.Oxide.LogInfo("[AiBot] SLOW route planning: " + ms.ToString("0") + " ms for " + tries + " tries (" + (found ? "found one" : "found none") + ")");
            }

            private bool SetPath(Vector3 to)
            {
                Vector3 from;
                corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
                if (!Nearest(body.transform.position, 3f, out from)) return false;
                // The map's routes never go off a ledge, but a player often just drops down. So
                // for anything within 60 m, first try a straight line with the body, drops
                // included (never more than SafeDrop); use the map's route only if that fails.
                if (Vector3.Distance(from, to) < 60f)
                {
                    var straight = new List<Vector3> { body.transform.position, to };
                    if (!Wet(straight))
                    {
                        var direct = Walkable(straight, to);
                        if (direct != null)
                        {
                            Straight++;
                            corners.AddRange(direct);
                            foreach (var kv in routeJumps) cornerJumps[kv.Key] = kv.Value;
                            foreach (var t in routeTrusted) cornerTrusted.Add(t);
                            corner = 1;
                            goal = to;
                            state = "travelling (straight)";
                            ResetStuck();
                            return true;
                        }
                    }
                }
                path.Reset();
                if (!RustNavMeshHelpers.CalculatePath(from, to, RustNavMeshHelpers.AllAreas, path, false)) return false;
                if (path.status != NavMeshPathStatus.PathComplete || path.corners.Count < 2) return false;
                var pts = new List<Vector3>();
                foreach (var c in path.corners) pts.Add(c.Value);
                if (Wet(pts)) return false;
                var walk = Walkable(pts, to);
                if (walk == null) return false;
                corners.AddRange(walk);
                foreach (var kv in routeJumps) cornerJumps[kv.Key] = kv.Value;
                foreach (var t in routeTrusted) cornerTrusted.Add(t);
                corner = 1;
                goal = to;
                state = "travelling";
                ResetStuck();
                return true;
            }

            // The game's navigation map is built for NPCs and is generous: it counts slopes up to
            // 50 degrees and anything under 0.75 m as walkable, and ignores the invisible walls
            // that stop players climbing cliffs and rocks. Recorded players never walked up
            // more than 39 degrees. So walk the route in thought first, every half metre,
            // and turn it down if it climbs steeper than that or crosses anything the game's
            // own no-clip check would refuse. The last few metres before the goal aren't
            // checked, so actions can still get right up to a tree or rock.
            // 1,758 recorded uphill stretches (m0j and Relyx): 99% under 30 degrees, none over 39.
            // The check samples the route, which reads a bit steeper than a player's smoothed path,
            // so the limit sits above the steepest real climb and is measured over 2 m.
            private const float MaxUphill = 45f, SlopeRun = 2f, GoalSlack = 3f;
            public int RejectedSteep, RejectedBlocked;

            // The map's routes hug walls (its edge sits about 0.3 m from them), closer than a
            // player's body fits. Where a step would touch something, slide that step sideways,
            // up to 0.8 m either way, like a player keeping off a wall. Only if no nudge works is
            // the route turned down. Returns the route to walk (a point every half metre), or null.
            public int Nudged;
            private static readonly float[] Nudges = { 0.3f, -0.3f, 0.55f, -0.55f, 0.8f, -0.8f };

            // Trail steps in the last route Walkable made: where to jump (route index -> landing)
            // and which points came from a player's trail (the walker trusts those).
            private readonly Dictionary<int, Vector3> routeJumps = new Dictionary<int, Vector3>();
            private readonly HashSet<int> routeTrusted = new HashSet<int>();
            private readonly Dictionary<int, Vector3> cornerJumps = new Dictionary<int, Vector3>();
            private readonly HashSet<int> cornerTrusted = new HashSet<int>();
            public int TrailsUsed, TrailJumps, Straight;

            private class Ahead { public int Seg, Step; public Vector3 P; }

            // From a blocked spot, find a player's trail that starts close by and comes back to
            // this route at least 2 m further on. Returns the trail points to walk, or null.
            private List<TrailPoint> TrailBridge(Vector3 from, List<Vector3> pts, int i, int k, int n, Vector3 offset, float radius, out int rejoinSeg, out int rejoinStep)
            {
                rejoinSeg = rejoinStep = -1;
                if (Trails.All.Count == 0) return null;
                // The route ahead, as half-metre points, up to 40 m.
                var ahead = new List<Ahead>();
                var dist = 0f;
                var lastP = from;
                for (int ci = i, ck = k; ci < pts.Count && dist < 40f; ci++, ck = 1)
                {
                    var nn = Mathf.Max(1, Mathf.CeilToInt(Vector3.Distance(pts[ci - 1], pts[ci]) / 0.5f));
                    for (; ck <= nn; ck++)
                    {
                        var p = Vector3.Lerp(pts[ci - 1], pts[ci], ck / (float)nn);
                        dist += Vector3.Distance(lastP, p);
                        lastP = p;
                        ahead.Add(new Ahead { Seg = ci, Step = ck, P = p });
                    }
                }
                // The nearest few trail points, one per trail.
                var starts = new List<KeyValuePair<int, int>>();
                var seenTrails = new HashSet<int>();
                var near = new List<KeyValuePair<int, int>>(Trails.Near(from, 2.5f));
                near.Sort((a, b) => Vector3.Distance(Trails.All[a.Key][a.Value].P, from).CompareTo(Vector3.Distance(Trails.All[b.Key][b.Value].P, from)));
                foreach (var kv in near)
                {
                    if (!seenTrails.Add(kv.Key)) continue;
                    starts.Add(kv);
                    if (starts.Count >= 6) break;
                }
                List<TrailPoint> best = null;
                var bestLen = float.MaxValue;
                foreach (var st in starts)
                {
                    var tr = Trails.All[st.Key];
                    if (Vector3.Distance(from, tr[st.Value].P) > 0.6f && Blocked(from, tr[st.Value].P, offset, radius)) continue;
                    foreach (var dirn in new[] { 1, -1 })
                    {
                        var len = 0f;
                        var prevP = tr[st.Value].P;
                        for (int m = st.Value, steps = 0; m >= 0 && m < tr.Count && steps < 120 && len < bestLen; m += dirn, steps++)
                        {
                            if (dirn < 0 && tr[m].Jump && m != st.Value) break; // a jump can't be done backwards
                            len += Vector3.Distance(prevP, tr[m].P);
                            prevP = tr[m].P;
                            Ahead hit = null;
                            for (var a = 4; a < ahead.Count; a++)
                            {
                                var q = ahead[a].P;
                                if (new Vector2(q.x - prevP.x, q.z - prevP.z).magnitude < 1.2f && Mathf.Abs(q.y - prevP.y) < 1.2f) { hit = ahead[a]; break; }
                            }
                            if (hit == null) continue;
                            var seg = new List<TrailPoint>();
                            for (var x = st.Value; x != m + dirn; x += dirn) seg.Add(tr[x]);
                            best = seg;
                            bestLen = len;
                            rejoinSeg = hit.Seg;
                            rejoinStep = hit.Step;
                            break;
                        }
                    }
                }
                return best;
            }

            // From where the body got stuck, find a player trail that starts within 2.5 m and comes
            // back to the route's waypoints at least 2 m further on (within 40 m). Returns the trail
            // points to walk and the waypoint it rejoins at, or null.
            private List<TrailPoint> TrailBridge(Vector3 from, List<Vector3> way, int w, out int rejoin)
            {
                rejoin = -1;
                if (Trails.All.Count == 0) return null;
                var near = new List<KeyValuePair<int, int>>(Trails.Near(from, 2.5f));
                near.Sort((a, b) => Vector3.Distance(Trails.All[a.Key][a.Value].P, from).CompareTo(Vector3.Distance(Trails.All[b.Key][b.Value].P, from)));
                var seen = new HashSet<int>();
                List<TrailPoint> best = null;
                var bestLen = float.MaxValue;
                foreach (var st in near)
                {
                    if (!seen.Add(st.Key)) continue;
                    if (seen.Count > 6) break;
                    var tr = Trails.All[st.Key];
                    foreach (var dirn in new[] { 1, -1 })
                    {
                        var len = 0f;
                        var prevP = tr[st.Value].P;
                        for (int m = st.Value, steps = 0; m >= 0 && m < tr.Count && steps < 120 && len < bestLen; m += dirn, steps++)
                        {
                            if (dirn < 0 && tr[m].Jump && m != st.Value) break; // a jump can't be done backwards
                            len += Vector3.Distance(prevP, tr[m].P);
                            prevP = tr[m].P;
                            var hit = -1;
                            for (var a = w + 1; a < way.Count; a++)
                            {
                                if (Vector3.Distance(way[a], way[w]) > 40f) break;
                                if (Vector3.Distance(way[a], from) < 2f) continue;
                                var q = way[a];
                                if (new Vector2(q.x - prevP.x, q.z - prevP.z).magnitude < 1.2f && Mathf.Abs(q.y - prevP.y) < 1.2f) { hit = a; break; }
                            }
                            if (hit < 0) continue;
                            var seg = new List<TrailPoint>();
                            for (var x = st.Value; x != m + dirn; x += dirn) seg.Add(tr[x]);
                            best = seg;
                            bestLen = len;
                            rejoin = hit;
                            break;
                        }
                    }
                }
                return best;
            }

            // The route check is a dry run of the same body along the map's route, a waypoint
            // every metre, with nothing moving in the world. Where the body can't get to the next
            // waypoint, a player trail through there is used; if there is none, the route is
            // turned down. Returns the route to walk, or null.
            private CharacterBody dryLegs;
            private Vector3 lastDry;

            // The route as points every half metre along the map's line.
            private static List<Vector3> Densify(List<Vector3> pts)
            {
                var dense = new List<Vector3> { pts[0] };
                for (var i = 1; i < pts.Count; i++)
                {
                    var n = Mathf.Max(1, Mathf.CeilToInt(Vector3.Distance(pts[i - 1], pts[i]) / 0.5f));
                    for (var k = 1; k <= n; k++) dense.Add(Vector3.Lerp(pts[i - 1], pts[i], k / (float)n));
                }
                return dense;
            }

            private List<Vector3> Walkable(List<Vector3> pts, Vector3 to)
            {
                try { return DryRun(pts, to); }
                finally { dryLegs?.Park(); } // out of the way, so the dry-run body never blocks anyone
            }

            private List<Vector3> DryRun(List<Vector3> pts, Vector3 to)
            {
                routeJumps.Clear();
                routeTrusted.Clear();
                lastPlanProblem = "";
                if (dryLegs == null) dryLegs = new CharacterBody(body);
                var dense = Densify(pts);
                var way = new List<Vector3> { dense[0] };
                for (var i = 1; i < dense.Count; i++)
                    if (Vector3.Distance(way[way.Count - 1], dense[i]) >= 1f || i == dense.Count - 1) way.Add(dense[i]);
                var route = new List<Vector3> { dense[0] };
                dryLegs.Place(dense[0]);
                var vy = -2f;
                const float dt = 0.1f;
                // A straight line's points are just a line through the air, so their height means
                // nothing; the map's route points sit on the ground, so there the body must also
                // be at their height, not just under them.
                var straightLine = pts.Count == 2;
                for (var w = 1; w < way.Count; w++)
                {
                    if (Vector3.Distance(way[w], to) < GoalSlack)
                    {
                        // Only for the straight-line shortcut: if the goal is well above where the
                        // body got to (on top of a rock, say), the straight line isn't a way up.
                        // Turn it down so the map's route, which can go round to the top, is used.
                        // The map's own routes keep climbing exactly as before.
                        if (straightLine && to.y - dryLegs.Position.y > 2f)
                        {
                            lastPlanProblem = "the straight line ends " + (to.y - dryLegs.Position.y).ToString("0.0") + " m below the goal; using the map's route instead";
                            return null;
                        }
                        for (var j = w; j < way.Count; j++) route.Add(way[j]);
                        return route;
                    }
                    var reached = false;
                    var dryHops = 0;
                    for (var t = 0; t < 16; t++)
                    {
                        var p = dryLegs.Position;
                        var f = new Vector3(way[w].x - p.x, 0f, way[w].z - p.z);
                        if (f.magnitude < 0.35f) { reached = true; break; }
                        if (dryLegs.Grounded && DropAhead(p, f.normalized) > SafeDrop) break; // a fall that would hurt
                        var hop = false;
                        if (dryLegs.OnFooting && t > 0 && dryHops < 3 && new Vector2(p.x - lastDry.x, p.z - lastDry.z).magnitude < 0.05f)
                        {
                            hop = true; // stalled: the walker would hop here, so the dry run does too
                            dryHops++;
                        }
                        lastDry = p;
                        vy = hop ? HopSpeed : dryLegs.Grounded ? -2f : vy + Physics.gravity.y * dt;
                        var d = f.normalized * Mathf.Min(WalkSpeed * 1.5f, f.magnitude / dt);
                        dryLegs.Move(new Vector3(d.x, vy, d.z) * dt);
                    }
                    if (reached)
                    {
                        route.Add(dryLegs.Position);
                        continue;
                    }
                    // The body can't get there: maybe a player did. Follow their trail.
                    int rejoin;
                    var trail = TrailBridge(dryLegs.Position, way, w, out rejoin);
                    if (trail == null) { RejectedBlocked++; return null; }
                    TrailsUsed++;
                    foreach (var tp in trail)
                    {
                        if (tp.Jump) routeJumps[route.Count] = tp.Land;
                        routeTrusted.Add(route.Count);
                        route.Add(tp.P);
                    }
                    dryLegs.Place(way[rejoin]);
                    route.Add(way[rejoin]);
                    w = rejoin;
                }
                return route;
            }

            // The route check uses the same tests the walker will meet on the way: its own
            // chest/knee check, then the game's no-clip test, so a route that passes can be walked.
            private bool Blocked(Vector3 a, Vector3 b, Vector3 offset, float radius)
            {
                var dir = b - a;
                dir.y = 0f;
                if (dir.sqrMagnitude > 0.0001f && Blocked(a, dir.normalized)) return true;
                if (ConVar.AntiHack.noclip_protection <= 0) return false;
                Collider hit;
                return AntiHack.TestNoClipping(body, a + offset, b + offset, radius, ConVar.AntiHack.noclip_backtracking, out hit, false, null, false, false, false);
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

            // The body: Unity's character controller, the same kind of collide-and-slide a game
            // client moves its player with. It stops at, slides along and steps up onto what's
            // in the way, so it doesn't try to walk into rocks in the first place. Every move it
            // makes still goes through the server's checks (TickGuard).
            private CharacterBody legs;
            private float fallSpeed;

            private void Walk(float dt)
            {
                var pos = body.transform.position;
                while (corner < corners.Count)
                {
                    var f = corners[corner] - pos;
                    var up = f.y;
                    f.y = 0f;
                    // Reached only when it's there, not under it on a lower level.
                    if (f.magnitude > 0.35f) break;
                    corner++;
                }
                if (corner >= corners.Count)
                {
                    EndTrip(Working ? "working" : "pausing");
                    waitUntil = Time.time + UnityEngine.Random.Range(1f, 7f);
                    return;
                }
                var flat = corners[corner] - pos;
                flat.y = 0f;
                var dir = flat.normalized;
                // A player jumped from here: jump too, heading for where they landed.
                Vector3 land;
                if (flat.magnitude < 0.8f && cornerJumps.TryGetValue(corner, out land) && Jump())
                {
                    TrailJumps++;
                    corner++;
                }
                var next = MoveBody(pos, dir, speed, dt);
                var progress = new Vector2(next.x - pos.x, next.z - pos.z).magnitude;
                if (progress < 0.25f * speed * dt)
                {
                    blocked++;
                    lastStop = legs.Bumped ? "its body bumped into " + legs.BumpedInto : "it couldn't get any further this step";
                    // Stalled going up, or against something: jump, like a player would. But not
                    // at something higher than a jump can reach: that's a wall, not a hop.
                    var rise = corners[corner].y - pos.y;
                    if (rise > -0.2f || legs.Bumped) Jump();
                    
                    if (Vector3.Distance(pos, goal) < 2f) { EndTrip(Working ? "working" : "pausing"); return; } // close enough
                }
                lastDir = dir;
                lookYaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
                if (Guard.Kicked) { Roaming = false; EndTrip("kicked by anti-cheat"); return; }
                CheckStuck();
            }

            // Standing still: gravity still applies (after /bot here, a jump, or ground that went away).
            private float settleCheck;

            private void Settle(float dt)
            {
                if (Time.time < settleCheck) return;
                var pos = body.transform.position;
                if (legs == null) legs = new CharacterBody(body);
                legs.Place(pos);
                MoveBody(pos, Vector3.zero, 0f, dt);
                if (legs.Grounded) settleCheck = Time.time + 0.5f; // on the ground: check twice a second
            }

            // One body move: the controller moves (with gravity), then the server's checks
            // decide whether it happens. Returns where the bot ends up.
            private Vector3 MoveBody(Vector3 pos, Vector3 dir, float spd, float dt)
            {
                if (legs == null) legs = new CharacterBody(body);
                legs.Place(pos);
                var wasGrounded = legs.Grounded;
                // Walking off a ledge is fine, but not one it would take fall damage from.
                if (wasGrounded && dir != Vector3.zero && DropAhead(pos, dir) > SafeDrop)
                {
                    lastStop = "a drop of more than " + SafeDrop + " m ahead (fall damage)";
                    dir = Vector3.zero;
                }
                if (hopNow && wasGrounded) { fallSpeed = HopSpeed; hopNow = false; }
                else fallSpeed = wasGrounded ? -2f : fallSpeed + Physics.gravity.y * dt;
                var next = legs.Move(new Vector3(dir.x * spd, fallSpeed, dir.z * spd) * dt);
                if (legs.Grounded && !wasGrounded && fallSpeed < -15f) body.ApplyFallDamageFromVelocity(fallSpeed); // what a player's landing report does
                if (!landedSinceHop && fallSpeed <= 0f && legs.OnFooting) landedSinceHop = true;
                if ((next - pos).sqrMagnitude < 0.000001f) return pos;
                if (!Guard.Receive(pos, next, spd > WalkSpeed))
                {
                    lastStop = "the anti-cheat refused the step (" + Guard.LastType + ")";
                    legs.Place(pos);
                    return pos;
                }
                travelled += Vector3.Distance(pos, next);
                deepest = Mathf.Max(deepest, WaterDepth(next));
                body.MovePosition(next);
                return next;
            }

            private void OnDestroy() { legs?.Dispose(); dryLegs?.Dispose(); }

            // A hop: the take-off speed for 1.4 m, just under the game's 1.5 m jump height
            // (BasePlayer.GetJumpHeight), so the fly check allows it as it does a player's jump.
            private static readonly float HopSpeed = Mathf.Sqrt(2f * -Physics.gravity.y * 1.4f);
            private const float HopCooldown = 0.7f;
            private const float JumpReach = 1.3f; // the highest a hop can land on
            public string lastPlanProblem = "";
            private bool hopNow, landedSinceHop = true;

            // The one jump: a real jump with the body (up off the ground with the take-off speed
            // for 1.4 m, carrying on in the direction it was going), used for steep bits, for
            // anything in the way, and where a recorded player jumped. Like a player: only from
            // proper footing, and only once it has landed from the last one. Returns true if it jumped.
            private bool Jump()
            {
                if (legs == null || !legs.OnFooting || !landedSinceHop || Time.time < nextHop) return false;
                hopNow = true;
                landedSinceHop = false;
                nextHop = Time.time + HopCooldown;
                hops++;
                return true;
            }
            private float nextHop;
            private int hops;
            public bool Airborne => jumping || (legs != null && !legs.Grounded);

            // Fall damage starts at a 15 m/s landing, about an 11.5 m fall. Stay under 10 m.
            private const float SafeDrop = 10f;

            // How far down the ground is just past the body's front edge (99 if no ground in 12 m).
            private static float DropAhead(Vector3 pos, Vector3 dir)
            {
                RaycastHit hit;
                var at = pos + dir * (BasePlayer.GetRadius() + 0.3f) + Vector3.up * 0.6f;
                if (Physics.Raycast(at, Vector3.down, out hit, 12.6f, GroundMask | LayerMask.GetMask("Water"), QueryTriggerInteraction.Collide)) return pos.y - hit.point.y;
                return 99f;
            }

            // Why the last step didn't happen, for the stuck report.
            private string lastStop = "nothing";

            private string WhyBlocked(Vector3 pos, Vector3 dir, float move)
            {
                RaycastHit hit;
                foreach (var h in new[] { 1.3f, 0.6f })
                    if (Physics.SphereCast(pos + Vector3.up * h - dir * 0.1f, 0.34f, dir, out hit, 0.5f, BlockMask, QueryTriggerInteraction.Ignore))
                        return (h > 1f ? "chest" : "knee") + "-height check hit " + Name(hit.collider) + " (" + LayerMask.LayerToName(hit.collider.gameObject.layer) + ", surface tilted " + Vector3.Angle(hit.normal, Vector3.up).ToString("0") + " deg, "
                            + (HeightAhead(pos, dir, 0.9f) > 50f ? "too tall to jump" : HeightAhead(pos, dir, 0.9f).ToString("0.0") + " m tall") + ")";
                var at = pos + dir * move;
                if (!Physics.Raycast(at + Vector3.up * MaxStepUp, Vector3.down, out hit, MaxStepUp + MaxDrop, GroundMask, QueryTriggerInteraction.Ignore))
                    return "no ground within 1 m up or 2 m down ahead (a drop or a hole)";
                return "water ahead too deep (" + WaterDepth(hit.point).ToString("0.0") + " m)";
            }

            private static string Name(Collider c)
            {
                var e = c.GetComponentInParent<BaseEntity>();
                var n = e != null ? e.ShortPrefabName : c.transform.root.name;
                var i = n.IndexOf(" (", StringComparison.Ordinal);
                return i > 0 ? n.Substring(0, i) : n;
            }

            private void ReportStuck()
            {
                var pos = body.transform.position;
                Interface.Oxide.LogInfo("[AiBot] STUCK #" + stucks + " at " + pos.ToString("F1") + " (" + MapHelper.PositionToString(pos) + "), " + state
                    + (corners.Count > 0 ? ", " + Vector3.Distance(pos, goal).ToString("0") + " m from its goal" : "") + ": " + lastStop);
            }

            #region Jump

            // From the recordings: players jump things between about 0.3 and 1.5 m tall in their
            // way, uphill or down, and walk off drops rather than jumping off them. The bot jumps
            // only when something sticks up in front that it can't step over, its head is clear,
            // and there's ground to land on 1 to 2.5 m on. The arc goes through the server's
            // checks like any other move, so the fly check limits it to a real jump's height.
            private const float JumpMin = 0.3f, JumpMax = 1.4f, JumpTime = 0.6f;
            private bool jumping;
            private float jumpT, jumpPeak;
            private Vector3 jumpFrom, jumpTo;
            private int jumps;

            private void StartTrailJump(Vector3 pos, Vector3 land)
            {
                jumping = true;
                jumpT = 0f;
                jumpFrom = pos;
                jumpTo = land;
                jumpPeak = Mathf.Clamp(Mathf.Max(0f, land.y - pos.y) + 0.6f, 0.6f, 1.45f);
                jumps++;
                TrailJumps++;
                state = "jumping (like a player did here)";
            }

            private bool TryJump(Vector3 pos, Vector3 dir)
            {
                var h = HeightAhead(pos, dir, 0.9f);
                if (h < JumpMin || h > JumpMax) return false;
                RaycastHit hit;
                // Room overhead and over the top.
                if (Physics.SphereCast(pos + Vector3.up * (h + 1.6f), 0.3f, dir, out hit, 1.5f, BlockMask, QueryTriggerInteraction.Ignore)) return false;
                if (Physics.Raycast(pos + Vector3.up * 1.6f, Vector3.up, h + 0.3f, BlockMask, QueryTriggerInteraction.Ignore)) return false;
                for (var d = 1.0f; d <= 2.5f; d += 0.3f)
                {
                    Vector3 land;
                    var at = pos + dir * d;
                    if (!Physics.Raycast(at + Vector3.up * (h + 1.2f), Vector3.down, out hit, h + 3.5f, GroundMask, QueryTriggerInteraction.Ignore)) continue;
                    land = hit.point;
                    if (land.y - pos.y > h + 0.2f || pos.y - land.y > MaxDrop) continue;      // still on the obstacle top is fine, a big drop isn't
                    if (WaterDepth(land) > MaxWater) continue;
                    if (Physics.CheckCapsule(land + Vector3.up * 0.6f, land + Vector3.up * 1.4f, 0.3f, BlockMask, QueryTriggerInteraction.Ignore)) continue; // landing spot is clear
                    jumping = true;
                    jumpT = 0f;
                    jumpFrom = pos;
                    jumpTo = land;
                    jumpPeak = Mathf.Min(1.45f, h + 0.25f);
                    jumps++;
                    state = "jumping";
                    return true;
                }
                return false;
            }

            private void Fly(float dt)
            {
                jumpT = Mathf.Min(1f, jumpT + dt / JumpTime);
                var start = body.transform.position;
                var p = Vector3.Lerp(jumpFrom, jumpTo, jumpT);
                p.y = Mathf.Lerp(jumpFrom.y, jumpTo.y, jumpT) + 4f * jumpPeak * jumpT * (1f - jumpT);
                if (Guard.Receive(start, p, speed > WalkSpeed)) body.MovePosition(p);
                else jumpT = 1f; // refused: drop back down where it is
                if (jumpT >= 1f)
                {
                    jumping = false;
                    state = corners.Count > 0 ? "travelling" : "pausing";
                    ResetStuck();
                }
            }

            // How tall the thing in front is: rays straight ahead at rising heights.
            private static float HeightAhead(Vector3 pos, Vector3 dir, float reach)
            {
                for (var h = 0.1f; h <= JumpMax + 0.3f; h += 0.1f)
                    if (!Physics.Raycast(pos + Vector3.up * h, dir, reach, BlockMask | GroundMask, QueryTriggerInteraction.Ignore))
                        return h - 0.1f;
                return 99f;
            }

            #endregion

            private static bool Blocked(Vector3 pos, Vector3 dir)
            {
                RaycastHit hit;
                // Chest and knee height, the same 0.34 m radius the no-clip check uses, so the
                // walker stops at logs and rocks instead of having the move refused. A gentle
                // rock surface at knee height (under MaxUphill) is ground to walk up, not a wall.
                if (Physics.SphereCast(pos + Vector3.up * 1.3f - dir * 0.1f, 0.34f, dir, out hit, 0.5f, BlockMask, QueryTriggerInteraction.Ignore)) return true;
                return Physics.SphereCast(pos + Vector3.up * 0.6f - dir * 0.1f, 0.34f, dir, out hit, 0.5f, BlockMask, QueryTriggerInteraction.Ignore)
                    && Vector3.Angle(hit.normal, Vector3.up) >= MaxUphill;
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
                ReportStuck();
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
            // Switched off at m0j's request (it hopped when it didn't need to). Flip to true to
            // bring the stuck-hop back.
            public static bool HopEnabled = false;

            private void Hop()
            {
                EndTrip("recovering");
                stuckLevel = 0;
                if (!HopEnabled) return;
                for (var i = 0; i < 20; i++)
                {
                    var r = UnityEngine.Random.insideUnitCircle.normalized * (2f + i * 0.5f);
                    Vector3 spot;
                    if (!Nearest(body.transform.position + new Vector3(r.x, 0f, r.y), 4f, out spot)) continue;
                    if (WaterDepth(spot) > MaxWater) continue;
                    if (Vector3.Distance(spot, body.transform.position) < 1f) continue;
                    // A hop is a move like any other, so the server's checks judge it too. A real
                    // player can't hop, so expect these to be refused unless they are tiny.
                    teleports++;
                    if (Guard.Receive(body.transform.position, spot, false)) { body.MovePosition(spot); ResetStuck(); }
                    return;
                }
            }

            private void EndTrip(string newState)
            {
                corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
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
                if (body.modelState.sprinting != running || body.modelState.onground == Airborne)
                {
                    body.modelState.sprinting = running;
                    body.modelState.onground = !Airborne;
                    body.SendModelState();
                }
            }

            public string Describe()
            {
                var mins = (Time.time - startedAt) / 60f;
                return "roaming " + Roaming + ", looking " + body.viewAngles.x.ToString("0") + "° down, " + state + (corners.Count > 0 ? " to " + goal + " at " + speed + " m/s, " + Vector3.Distance(goal, body.transform.position).ToString("0") + " m left" : "")
                    + "\nsince spawn (" + mins.ToString("0.0") + " min): " + travelled.ToString("0") + " m, " + trips + " trips, stuck " + stucks
                    + " (repath " + repaths + ", hop tries " + teleports + "), blocked steps " + blocked + ", no destination " + noGoal + ", deepest water " + deepest.ToString("0.0") + " m"
                    + "\nroutes turned down before walking: too steep " + RejectedSteep + ", through rock/cliff/wall " + RejectedBlocked + "; steps nudged off walls " + Nudged + "; straight-line routes " + Straight + "; player trails used " + TrailsUsed + " (" + Trails.All.Count + " trails loaded), jumps " + hops + " (" + TrailJumps + " of them where a recorded player jumped)" + "\nroute planning: " + Plans + " trips planned, average " + (Plans > 0 ? PlanMsTotal / Plans : 0f).ToString("0") + " ms, worst " + PlanMsWorst.ToString("0") + " ms (one server frame is 33 ms)" + "\nbot cost: " + BotUpdates + " updates, average " + (BotUpdates > 0 ? BotMsTotal / BotUpdates : 0f).ToString("0.00") + " ms, worst " + WorstBotMs.ToString("0.0") + " ms; server frames over 100 ms: " + Hitches + " (worst " + WorstFrameMs.ToString("0") + " ms)"
                    + "\n" + Guard.Describe();
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

        // The server's "receive a player tick" step, rebuilt for the bot. A real player's client
        // sends a tick with its new position; the server first checks the jump from the last tick
        // (BasePlayer.UpdatePositionFromTick), then its anti-cheat checks each move in this order:
        // no-clip, speed, fly (AntiHack.ValidateMoves), plus inside-terrain (ValidateAgainstTerrain).
        // A failed check adds violation points and, if that check is set to reject, the move is
        // refused and the player stays where it was. Too many points and the player is kicked.
        //
        // The server only runs this for connected players, so the bot never goes through it. Where
        // the game has a check we can call, it is called (AntiHack.TestNoClipping,
        // AntiHack.TestInsideTerrain, AntiHack.IsInsideMesh). Speed and fly only exist as batch
        // jobs for connected players (AntiHackJobs.*), so their maths is copied step for step.
        // All limits come from the server's own antihack.* settings. Matches Rust 2636.
        private class TickGuard
        {
            private readonly BasePlayer body;
            private float lastTick;

            // AntiHack.PlayerSpeedhackState / PlayerFlyhackState / PlayerState, one bot's worth.
            private float speedPause, speedDistance;
            private float flyPause, flyVertical, flyHorizontal;
            private bool inAir;
            private float violationLevel, lastViolationTime;
            private string lastViolationType = "none";

            public bool Kicked;
            public string LastType => lastViolationType;
            private int ticks, tickRejects, noclips, speeds, flies, terrains, kicks;

            public TickGuard(BasePlayer player)
            {
                body = player;
                lastTick = Time.time;
            }

            // What AntiHack.ResetTimer and an admin teleport do: forget the movement history.
            public void Reset(Vector3 pos)
            {
                speedDistance = 0f;
                flyVertical = flyHorizontal = 0f;
                inAir = false;
                lastTick = Time.time;
            }

            // AntiHack.ShouldIgnore, minus the parts that need a connection.
            private bool Ignored()
            {
                if (body.IsAdmin && ConVar.AntiHack.userlevel < 1) return true;
                if (body.IsDeveloper && ConVar.AntiHack.userlevel < 2) return true;
                return body.IsSpectating() || body.isInvisible;
            }

            // Returns true if the move from 'from' to 'to' is accepted.
            public bool Receive(Vector3 from, Vector3 to, bool running)
            {
                var dt = Mathf.Clamp(Time.time - lastTick, 0.001f, ConVar.AntiHack.maxdeltatime);
                lastTick = Time.time;
                ticks++;
                Fade(dt);
                if (Ignored()) return true;

                // BasePlayer.UpdatePositionFromTick: one tick may not jump too far.
                var maxTick = inAir ? ConVar.AntiHack.tick_max_distance_falling : ConVar.AntiHack.tick_max_distance;
                if (Vector3.Distance(from, to) > maxTick + ConVar.AntiHack.tick_distance_forgiveness)
                {
                    // The server snaps the player back and resets its anti-cheat timers.
                    tickRejects++;
                    Reset(from);
                    return false;
                }

                var accepted = true;

                // No-clip: the game's own capsule test along the move.
                if (ConVar.AntiHack.noclip_protection > 0)
                {
                    Collider hit;
                    var offset = BasePlayer.NoClipOffset();
                    if (AntiHack.TestNoClipping(body, from + offset, to + offset, BasePlayer.NoClipRadius(ConVar.AntiHack.noclip_margin), ConVar.AntiHack.noclip_backtracking, out hit, false, null, false, false, false))
                    {
                        noclips++;
                        if (noclips <= 5) Interface.Oxide.LogInfo("[AiBot] no-clip flag: " + (hit != null ? hit.name + " layer " + LayerMask.LayerToName(hit.gameObject.layer) : "null") + " from " + from + " to " + to + " offset " + offset + " r " + BasePlayer.NoClipRadius(ConVar.AntiHack.noclip_margin));
                        Violation("NoClip", ConVar.AntiHack.noclip_penalty);
                        if (ConVar.AntiHack.noclip_reject) accepted = false;
                    }
                }

                // Speed: AntiHackJobs.ProgressSpeedingStates, CalcSpeedHackSpeed, CalcDistAndBudget,
                // AdjustDistBasedOnNormals, TestAreSpeeding.
                if (accepted && ConVar.AntiHack.speedhack_protection > 0)
                {
                    speedPause = Mathf.Max(0f, speedPause - dt);
                    var ducking = body.modelState.ducked ? 1f : 0f;
                    var maxSpeed = Mathf.Lerp(Mathf.Lerp(2.8f, 5.5f, running ? 1f : 0f), 1.7f, ducking) * (1f - body.clothingMoveSpeedReduction);
                    var delta = to - from;
                    var dist = ConVar.AntiHack.speedhack_protection >= 3 ? delta.magnitude : new Vector2(delta.x, delta.z).magnitude;
                    var budget = maxSpeed * dt;
                    if (dist > budget && TerrainMeta.HeightMap != null)
                    {
                        // Running downhill is allowed to be a bit faster.
                        var n = TerrainMeta.HeightMap.GetNormal(from);
                        dist = Mathf.Max(0f, dist - Mathf.Max(0f, Vector3.Dot(new Vector3(n.x, 0f, n.z), new Vector3(delta.x, 0f, delta.z))) * ConVar.AntiHack.speedhack_slopespeed * dt);
                    }
                    var forgiveness = Mathf.Max(speedPause > 0f ? ConVar.AntiHack.speedhack_forgiveness_inertia : ConVar.AntiHack.speedhack_forgiveness, 0.1f);
                    var cap = forgiveness + Mathf.Max(ConVar.AntiHack.speedhack_forgiveness, 0.1f);
                    speedDistance = Mathf.Clamp(speedDistance, -cap, cap);
                    speedDistance = Mathf.Clamp(speedDistance - budget, -cap, cap);
                    var speeding = speedDistance > forgiveness;
                    if (!speeding)
                    {
                        speedDistance = Mathf.Clamp(speedDistance + dist, -cap, cap);
                        speeding = speedDistance > forgiveness;
                    }
                    if (speeding)
                    {
                        speeds++;
                        Violation("SpeedHack", ConVar.AntiHack.speedhack_penalty);
                        if (ConVar.AntiHack.speedhack_reject) accepted = false;
                    }
                }

                // Fly: TestAreFlying's ground test (a capsule under the feet, in the middle of the
                // move) and AntiHackJobs.TestAreFlyingJob's distance limits while in the air.
                if (accepted && ConVar.AntiHack.flyhack_protection > 0)
                {
                    flyPause = Mathf.Max(0f, flyPause - dt);
                    var mid = (from + to) * 0.5f;
                    var radius = 0.5f - ConVar.AntiHack.flyhack_margin;
                    var grounded = Physics.CheckCapsule(mid + new Vector3(0f, 0.5f - ConVar.AntiHack.flyhack_extrusion, 0f), mid + new Vector3(0f, 1.3f, 0f), radius, 1503895809, QueryTriggerInteraction.Ignore)
                        || WaterLevel.GetWaterDepth(mid, false, false) > 0.01f;
                    inAir = !grounded;
                    if (inAir)
                    {
                        var d = to - from;
                        var flat = new Vector2(d.x, d.z).magnitude;
                        if (d.y >= 0f) flyVertical += d.y;
                        if (Mathf.Abs(d.y) < flat) flyHorizontal += flat;
                        var fv = flyPause > 0f ? ConVar.AntiHack.flyhack_forgiveness_vertical_inertia : ConVar.AntiHack.flyhack_forgiveness_vertical;
                        var fh = flyPause > 0f ? ConVar.AntiHack.flyhack_forgiveness_horizontal_inertia : ConVar.AntiHack.flyhack_forgiveness_horizontal;
                        if (flyVertical > BasePlayer.GetJumpHeight() + fv || flyHorizontal > 5f + fh)
                        {
                            flies++;
                            Violation("FlyHack", ConVar.AntiHack.flyhack_penalty);
                            if (ConVar.AntiHack.flyhack_reject) accepted = false;
                        }
                    }
                    else flyVertical = flyHorizontal = 0f;
                }

                // Inside terrain or inside a rock: AntiHack.ValidateAgainstTerrain.
                if (accepted && ConVar.AntiHack.terrain_protection > 0)
                {
                    var inside = AntiHack.TestInsideTerrain(to) || (ConVar.AntiHack.terrain_check_geometry && AntiHack.IsInsideMesh(to));
                    if (inside)
                    {
                        terrains++;
                        Violation("InsideTerrain", ConVar.AntiHack.terrain_penalty);
                        accepted = false;
                    }
                }

                return accepted;
            }

            // AntiHack.AddViolation and EnforceViolations.
            private void Violation(string type, float amount)
            {
                violationLevel += amount;
                lastViolationTime = Time.realtimeSinceStartup;
                lastViolationType = type;
                if (violationLevel > ConVar.AntiHack.maxviolation && ConVar.AntiHack.enforcementlevel > 0 && !Kicked)
                {
                    // A real player would be kicked here. The bot stops moving until /bot roam.
                    Kicked = true;
                    kicks++;
                    Interface.Oxide.LogWarning("[AiBot] Anti-cheat would kick " + body.displayName + " (" + type + ", violation level " + violationLevel.ToString("0") + ")");
                    violationLevel = 0f;
                }
            }

            // AntiHack.FadeViolations.
            private void Fade(float dt)
            {
                if (Time.realtimeSinceStartup - lastViolationTime > ConVar.AntiHack.relaxationpause)
                    violationLevel = Mathf.Max(0f, violationLevel - ConVar.AntiHack.relaxationrate * dt);
            }

            public string Describe() =>
                "anti-cheat: " + ticks + " moves checked; flagged: tick jump " + tickRejects + ", no-clip " + noclips + ", speed " + speeds + ", fly " + flies + ", inside terrain " + terrains
                + "; violation level " + violationLevel.ToString("0.0") + "/" + ConVar.AntiHack.maxviolation + " (last " + lastViolationType + "), kicks " + kicks + (Kicked ? " [stopped: would have been kicked]" : "");
        }
    }
}

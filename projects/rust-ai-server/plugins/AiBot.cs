using System;
using System.Collections.Generic;
using System.Linq;
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
    [Info("AiBot", "mojolowjo", "0.5.0")]
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
            public bool Brain; // the brain decides what to do (replaces roaming)
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
            LoadOdds();
            Walker.DoorUse = (d, open) => UseDoor(d, open);
            if (Train().SelfPlay) timer.Once(10f, () => { if (Alive) ProbeLine("resuming after a reload: " + SelfPlayCommand("on")); });
            Walker.DoorOpenable = d => CanOpen(d, bot);
            jobTimer = timer.Every(0.2f, TickJob);
            brainTimer = timer.Every(0.5f, BrainTick);
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
            brainTimer?.Destroy();
            dangerTimer?.Destroy();
            // Self-play picks up again after a reload (the flag lives in the training file).
            selfPlayTimer?.Destroy(); chaserTimer?.Destroy(); probeTimer?.Destroy();
            RemoveChaser();
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
            RaycastHit under;
            var blockers = LayerMask.GetMask("World", "Default", "Construction", "Deployed", "Tree");
            // Back exactly where it was if a player could stand there (on a box, a wall top): the
            // navigation map leaves those out, and its nearest point can be inside the box.
            if (Physics.Raycast(near + Vector3.up * 0.5f, Vector3.down, out under, 1f, LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed"), QueryTriggerInteraction.Ignore)
                && !Physics.CheckCapsule(under.point + Vector3.up * 0.55f, under.point + Vector3.up * 1.45f, 0.4f, blockers, QueryTriggerInteraction.Ignore))
                pos = under.point;
            else if (!Walker.Nearest(near, 5f, out pos) && !Walker.Nearest(near, 30f, out pos))
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
            walker.Init(player, yaw, saved.Roaming && !saved.Brain);
            walker.LookAround = saved.Brain;
            mind = new Mind();
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
            EndChase(danger, "killed", true);
            if (danger != null) Puts("[danger] " + saved?.Name + " was killed by " + (danger.Attacker != null ? danger.Attacker.displayName : "?") + " after " + (Time.time - danger.Started).ToString("0") + " s on the run (" + danger.Picks + " runs, broke line of sight " + danger.LosBreaks + " times).");
            danger = null;
            EndJob(saved?.Name + " died.");
            if (walker != null) UnityEngine.Object.Destroy(walker);
            bot = null;
            walker = null;
            saved.Health = 0f;
            saved.Roaming = false; // m0j: after respawning it stands still until told to roam (/bot roam)
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
                case "roam": BrainOff(); EndJob(null); walker.SetRoaming(true); Save(); return saved.Name + " is roaming.";
                case "stop": BrainOff(); EndJob(null); walker.SetRoaming(false); Save(); return saved.Name + " stopped.";
                case "brain": return BrainOn();
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
                case "hide": return ShowHiding(user);
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
            return "Use spawn, info, brain, roam, stop, here, unstuck, kill, chop, mine, barrel, loot or inv.";
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
            // The exact spot you point at, if a player could stand there (flat enough, room
            // for the body). The navigation map leaves out thin things like the top of a half
            // wall, so its nearest point would be the ground beside it.
            var standable = Vector3.Angle(aim.normal, Vector3.up) <= 50f
                && !Physics.CheckCapsule(aim.point + Vector3.up * 0.55f, aim.point + Vector3.up * 1.4f, 0.4f, LayerMask.GetMask("World", "Default", "Construction", "Deployed", "Tree"), QueryTriggerInteraction.Ignore);
            if (standable) spot = aim.point;
            else if (!Walker.Nearest(aim.point, 6f, out spot)) return "That spot isn't walkable.";
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
            sb.AppendLine(saved.Brain ? "brain: " + mind.Describe() : "brain: off");
            if (danger != null) sb.AppendLine("DANGER from " + (danger.Attacker != null ? danger.Attacker.displayName : "?") + ": " + (danger.Seen ? "in sight" : "hidden " + (Time.time - danger.HiddenSince).ToString("0") + " s") + ", " + danger.Picks + " runs, " + danger.LosBreaks + " line-of-sight breaks");
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
            var verb = args.Length > 0 ? args[0].ToLowerInvariant() : "";
            if (verb == "odds") { SendReply(player, ShowOdds()); return; }
            if (verb == "train") { SendReply(player, TrainCommand(args.Length > 1 ? args[1].ToLowerInvariant() : "")); return; }
            if (verb == "selfplay") { SendReply(player, SelfPlayCommand(args.Length > 1 ? args[1].ToLowerInvariant() : "")); return; }
            if (verb == "set") { SendReply(player, SetOdd(args.Skip(1).ToArray())); return; }
            SendReply(player, Run(verb, player));
        }

        [ConsoleCommand("aibot.selfplay")]
        private void ConSelfPlay(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            arg.ReplyWith(SelfPlayCommand((arg.GetString(0) ?? "").ToLowerInvariant()));
        }

        [ConsoleCommand("aibot.train")]
        private void ConTrain(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            arg.ReplyWith(TrainCommand((arg.GetString(0) ?? "").ToLowerInvariant()));
        }

        [ConsoleCommand("aibot.odds")]
        private void ConOdds(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            arg.ReplyWith(ShowOdds());
        }

        [ConsoleCommand("aibot.set")]
        private void ConSet(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            var a = new string[arg.Args?.Length ?? 0];
            for (var i = 0; i < a.Length; i++) a[i] = arg.GetString(i);
            arg.ReplyWith(SetOdd(a));
        }

        // /bot odds: the brain's numbers. /bot set <choice> <field> <value>, or /bot set <field> <value>
        // for the general ones. Saved to AiBotBrain.json, which the bot re-reads at once.
        private string ShowOdds()
        {
            LoadOdds();
            var sb = new StringBuilder("Brain odds (" + odds.Source + "):\n");
            foreach (var kv in odds.Options)
            {
                var o = kv.Value;
                sb.Append(kv.Key + ": base " + o.Base + (o.NearBoost != 1f ? ", x" + o.NearBoost + " if one within " + o.NearRadius + " m" : "")
                    + (!string.IsNullOrEmpty(o.Want) ? ", up to x" + (1f + o.NeedBoost) + " when short of " + o.WantAmount + " " + o.Want : "") + "\n");
            }
            sb.Append("stops: median " + odds.StopMedian + " s, spread " + odds.StopSpread + ", max " + odds.StopMax + " s; rest " + odds.RestMin + "-" + odds.RestMax + " s\n");
            sb.Append("sprint share " + odds.RunShare + "; sticks with a choice " + odds.StickMin + "-" + odds.StickMax + " s\n");
            sb.Append("running for cover (within " + odds.FleeRadius + " m): score = cover depth x " + odds.FleeDepth + " - run seconds x " + odds.FleeTime + " - seconds in view x " + odds.FleeExposed
                + " + metres from attacker x " + odds.FleeDistance + " - metres of climb x " + odds.FleeClimb + " (fields fleeradius, fleedepth, fleetime, fleeexposed, fleedistance, fleeclimb)\n");
            sb.Append("running-away routes: uphill at most " + odds.FleeMaxSlope + " deg (fleemaxslope), steps up at most " + odds.FleeMaxStep + " m (fleemaxstep), cover at most " + odds.FleeMaxRise
                + " m above it (fleemaxrise), jumps " + (odds.FleeJumps >= 0.5f ? "allowed" : "not allowed") + " (fleejumps 0/1); normal walking: 50 deg, 0.5 m, jumps allowed\n");
            sb.Append("edges: stands on an edge only with ground within " + odds.PerchRadius + " m of its middle, otherwise slides off (perchradius; 0.5 = never)"
                + (walker != null ? ", " + walker.PerchSlides + " slides off and " + walker.PerchBacks + " steps back so far" : "") + "\n");
            sb.Append("Change one: /bot set chop base 2  |  /bot set barrel nearboost 8  |  /bot set runshare 0.5");
            return sb.ToString();
        }

        private string SetOdd(string[] a)
        {
            LoadOdds();
            object target = odds;
            var i = 0;
            if (a.Length == 3)
            {
                BrainOption o;
                if (!odds.Options.TryGetValue(a[0].ToLowerInvariant(), out o)) return "No choice called " + a[0] + ". Choices: " + string.Join(", ", odds.Options.Keys);
                target = o;
                i = 1;
            }
            else if (a.Length != 2) return "Use /bot set <choice> <field> <value> (e.g. /bot set chop base 2) or /bot set <field> <value> (e.g. /bot set runshare 0.5). /bot odds lists them.";
            var field = target.GetType().GetFields().FirstOrDefault(f => string.Equals(f.Name, a[i], StringComparison.OrdinalIgnoreCase));
            if (field == null || field.Name == "Options") return "No field " + a[i] + ". Fields: " + string.Join(", ", target.GetType().GetFields().Where(f => f.Name != "Options").Select(f => f.Name.ToLowerInvariant()));
            try
            {
                var value = field.FieldType == typeof(string) ? (object)a[i + 1] : Convert.ChangeType(a[i + 1], field.FieldType, System.Globalization.CultureInfo.InvariantCulture);
                field.SetValue(target, value);
            }
            catch { return a[i + 1] + " isn't a valid value for " + field.Name + "."; }
            if (odds.Source.IndexOf("edited", StringComparison.Ordinal) < 0) odds.Source += ", edited in game";
            Interface.Oxide.DataFileSystem.WriteObject(OddsFile, odds);
            Walker.PerchRadius = odds.PerchRadius;
            Walker.DodgeAngle = odds.FleeZigzag;
            Puts("Brain odds changed: " + string.Join(" ", a));
            return "Set " + (i == 1 ? a[0] + " " : "") + field.Name + " = " + a[i + 1] + ". The bot uses it from its next decision.";
        }

        private void FromConsole(ConsoleSystem.Arg arg, string verb)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            arg.ReplyWith(Run(verb, arg.Player()));
        }

        // Test: aibot.goto <x> <z> [run] - walk there with the normal route checks.
        [ConsoleCommand("aibot.goto")]
        private void ConGoto(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            if (!Alive) { arg.ReplyWith("No bot."); return; }
            var want = new Vector3(arg.GetFloat(0), 0f, arg.GetFloat(1));
            want.y = TerrainMeta.HeightMap.GetHeight(want);
            Vector3 spot;
            if (!Walker.Nearest(want, 6f, out spot)) { arg.ReplyWith("Not walkable there."); return; }
            BrainOff(); EndJob(null); walker.SetRoaming(false);
            arg.ReplyWith(walker.GoTo(spot, arg.GetBool(2)) ? saved.Name + " is going to " + spot.ToString("F1") + ", " + Vector3.Distance(spot, bot.transform.position).ToString("0") + " m." : "No route: " + walker.lastPlanProblem);
        }

        // Test: aibot.tpxyz <x> <y> <z> - admin teleport to that exact point (onto a box, say).
        [ConsoleCommand("aibot.tpxyz")]
        private void ConTpXyz(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            if (!Alive) { arg.ReplyWith("No bot."); return; }
            var spot = new Vector3(arg.GetFloat(0), arg.GetFloat(1), arg.GetFloat(2));
            EndJob(null);
            walker.TeleportTo(spot);
            arg.ReplyWith(saved.Name + " moved to " + spot.ToString("F2") + ".");
        }

        // Test: aibot.gotoxyz <x> <y> <z> - walk to that exact point (like /bot path on a standable spot).
        [ConsoleCommand("aibot.gotoxyz")]
        private void ConGotoXyz(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            if (!Alive) { arg.ReplyWith("No bot."); return; }
            var spot = new Vector3(arg.GetFloat(0), arg.GetFloat(1), arg.GetFloat(2));
            BrainOff(); EndJob(null); walker.SetRoaming(false);
            var ok = walker.GoTo(spot, false);
            arg.ReplyWith(ok ? saved.Name + " is going to " + spot.ToString("F1") + " (" + walker.StateWord + "): " + string.Join(" ", walker.Route().Select(p => p.ToString("F1")).ToArray()) : "No route: " + walker.lastPlanProblem);
        }

        [ConsoleCommand("aibot.spawn")] private void ConSpawn(ConsoleSystem.Arg arg) => FromConsole(arg, "spawn");
        [ConsoleCommand("aibot.info")] private void ConInfo(ConsoleSystem.Arg arg) => FromConsole(arg, "info");
        [ConsoleCommand("aibot.roam")] private void ConRoam(ConsoleSystem.Arg arg) => FromConsole(arg, "roam");
        [ConsoleCommand("aibot.brain")] private void ConBrain(ConsoleSystem.Arg arg) => FromConsole(arg, "brain");
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

        #region Danger

        // Danger v1 (m0j's spec): when a player hurts it, after a human reaction time it sprints
        // for the nearest cover that blocks the attacker's line of sight, re-picking as the
        // attacker moves. Once the attacker hasn't been able to see it for 10 s, it calms down
        // and goes back to what it was doing.
        private const float MinReaction = 0.15f, MaxReaction = 0.4f, CalmAfter = 10f, CoverSearch = 35f;
        private static readonly int SightMask = LayerMask.GetMask("World", "Terrain", "Construction", "Tree", "Default", "Deployed");

        private class Danger
        {
            public BasePlayer Attacker;
            public float Started, ReactAt, HiddenSince = -1f, NextPick, LastHealth;
            public bool Reacted, Seen = true;
            public Vector3 Cover;
            public bool HasCover;
            public int Picks, LosBreaks, Hits;
            public float Closest = float.MaxValue, Damage;
            public bool WasRoaming;
            public float SeenTime, LastTick; // seconds the attacker could see it since it reacted
            public bool SelfPlay; // a self-play round (chased by the chaser bot)
            public int StartStucks, StartFlags; // to tell whether it got stuck or flagged during this chase
            public string Spoiled; // set by the self-play watchdog when something went wrong
            public Dictionary<string, float> Trial; // the settings tried in this chase (training mode)
            public bool Skip; // /bot train skip: don't count this chase
        }

        #region Training

        // Training (/bot train on): every chase tries a variation of the running-away settings
        // around the best so far. After the chase it's scored (lower is better): the share of the
        // first 30 s the attacker could see it, plus 0.1 per hit after it reacted, plus 1 if it
        // died. Each setting keeps a running average of its chases; a variation that beats the
        // best average over 2+ chases becomes the new best and is saved to the odds file.
        private static readonly string[] TrainedFields = { "FleeDepth", "FleeTime", "FleeExposed", "FleeDistance", "FleeRetreat", "FleeRadius", "FleeZigzag" };

        private class Training
        {
            public bool On;
            public bool SelfPlay; // self-play running (resumed after a reload)
            public Dictionary<string, float> Best;
            public float BestScore = float.MaxValue;
            public int BestChases;
            public List<Chase> Chases = new List<Chase>();
            public Dictionary<string, float> Pending; // a promising variation waiting for a second chase
            public float PendingScore;
        }

        private class Chase
        {
            public string When, Attacker, Ended, Source, Reason;
            public float Seconds, SeenSeconds, Score, Closest;
            public int Hits;
            public bool Excluded; // left out of the averages (a bug spoiled it, say)
            public Dictionary<string, float> Settings;
        }

        private Training training;
        private const string TrainingFile = "AiBotTraining";

        private Training Train()
        {
            if (training != null) return training;
            try { training = Interface.Oxide.DataFileSystem.ReadObject<Training>(TrainingFile); } catch { training = null; }
            if (training == null) training = new Training();
            if (training.Chases == null) training.Chases = new List<Chase>();
            // Scores are always worked out from the raw numbers saved with each chase, so the
            // formula can change and every past chase is re-scored the same way.
            foreach (var c in training.Chases) c.Score = (float)Math.Round(ScoreOf(c.SeenSeconds, c.Seconds, c.Hits, c.Ended == "killed"), 3);
            return training;
        }

        // The score (lower is better), after m0j: mostly how much of the chase it was in view;
        // hits count a little and are capped (being in view is what gets you shot anyway);
        // dying is a clear penalty.
        private static float ScoreOf(float seenSeconds, float seconds, int hits, bool died)
        {
            var share = Mathf.Clamp01(seenSeconds / Mathf.Max(seconds, 1f));
            return share + Mathf.Min(0.02f * Mathf.Max(0, hits - 1), 0.5f) + (died ? 1f : 0f);
        }

        private Dictionary<string, float> CurrentFlee()
        {
            var d = new Dictionary<string, float>();
            foreach (var f in TrainedFields) d[f] = (float)typeof(Odds).GetField(f).GetValue(odds);
            return d;
        }

        private void ApplyFlee(Dictionary<string, float> s)
        {
            foreach (var kv in s) typeof(Odds).GetField(kv.Key)?.SetValue(odds, kv.Value);
            Walker.DodgeAngle = odds.FleeZigzag;
        }

        // At the start of a chase in training mode: the pending variation if one needs a second
        // look, otherwise a new random variation (each setting x0.7 to x1.4) around the best.
        private Dictionary<string, float> NextTrial()
        {
            var t = Train();
            if (t.Best == null) t.Best = CurrentFlee();
            foreach (var kv in CurrentFlee()) if (!t.Best.ContainsKey(kv.Key)) t.Best[kv.Key] = kv.Value; // settings added since training started
            // The best needs its own score first (2 chases), and gets re-checked every 4th chase,
            // since people chase differently from one go to the next.
            if (t.BestChases < 2 || t.Chases.Count % 4 == 3) return new Dictionary<string, float>(t.Best);
            if (t.Pending != null) return new Dictionary<string, float>(t.Pending);
            var trial = new Dictionary<string, float>();
            foreach (var kv in t.Best)
            {
                var v = kv.Value * UnityEngine.Random.Range(0.7f, 1.4f);
                if (kv.Key == "FleeRadius") v = Mathf.Clamp(v, 15f, 60f);
                trial[kv.Key] = (float)Math.Round(v, 3);
            }
            return trial;
        }

        private void EndChase(Danger d, string ended, bool died)
        {
            if (d == null || !d.Reacted) return;
            var secs = Time.time - d.ReactAt;
            if (d.SelfPlay) selfPlayChaseEnded = true;
            // Every chase is saved; only clean ones count for training. Why one doesn't count:
            string invalid = null;
            if (d.Skip) invalid = "skipped by hand";
            else if (secs < (d.SelfPlay ? 8f : 3f) && !died) invalid = "too short (" + secs.ToString("0") + " s)";
            else if (d.Closest > 30f && !died) invalid = "the attacker never came within 30 m";
            else if (walker != null && walker.Stucks - d.StartStucks > 3) invalid = "Kestrel got stuck " + (walker.Stucks - d.StartStucks) + " times";
            else if (walker != null && walker.Guard.Flags - d.StartFlags > 10) invalid = "anti-cheat flagged " + (walker.Guard.Flags - d.StartFlags) + " moves";
            else if (d.Spoiled != null) invalid = d.Spoiled;
            var window = Mathf.Min(secs, 30f);
            var score = ScoreOf(d.SeenTime, secs, d.Hits, died);
            var t = Train();
            var chase = new Chase
            {
                When = DateTime.UtcNow.ToString("u"), Attacker = d.Attacker != null ? d.Attacker.displayName : "?", Ended = ended,
                Seconds = (float)Math.Round(secs, 1), SeenSeconds = (float)Math.Round(d.SeenTime, 1), Score = (float)Math.Round(score, 3),
                Closest = d.Closest < float.MaxValue ? (float)Math.Round(d.Closest, 1) : -1f, Hits = d.Hits, Settings = d.Trial ?? CurrentFlee(), Excluded = invalid != null,
                Source = d.SelfPlay ? "selfplay" : "player", Reason = invalid,
            };
            t.Chases.Add(chase);
            var msg = "[train] chase " + t.Chases.Count + (d.SelfPlay ? " (self-play)" : "") + ": in view " + chase.SeenSeconds + " of " + chase.Seconds + " s, " + d.Hits + " hits" + (died ? ", died" : "") + " -> score " + chase.Score.ToString("0.00")
                + (invalid != null ? "; NOT COUNTED: " + invalid : "");
            if (d.SelfPlay) { selfPlayRounds++; if (invalid == null) selfPlayValid++; else { int n; invalidReasons.TryGetValue(invalid.Split('(')[0].Trim(), out n); invalidReasons[invalid.Split('(')[0].Trim()] = n + 1; } }
            if (invalid != null && t.On && t.Best != null) { ApplyFlee(t.Best); Interface.Oxide.DataFileSystem.WriteObject(TrainingFile, t); Puts(msg); return; }
            if (t.On && d.Trial != null)
            {
                msg += Judge(t, d.Trial, score);
                // Back to the best settings between chases, saved for good.
                ApplyFlee(t.Best);
                Interface.Oxide.DataFileSystem.WriteObject(OddsFile, odds);
            }
            Interface.Oxide.DataFileSystem.WriteObject(TrainingFile, t);
            Puts(msg);
            if (d.Attacker != null && d.Attacker.IsConnected) SendReply(d.Attacker, msg.Replace("[train] ", ""));
        }

        // Every set of settings is judged by the average of all its counted chases, worked out
        // from the full chase history each time (so nothing drifts or gets lost on a reload).
        // Best = lowest average among settings with 2+ chases. A new variation with one good
        // chase gets a second go before it can win.
        private static string Key(Dictionary<string, float> s) =>
            s == null ? "" : string.Join(";", s.OrderBy(kv => kv.Key).Select(kv => kv.Key + "=" + kv.Value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)).ToArray());

        private string Judge(Training t, Dictionary<string, float> trial, float score)
        {
            // Self-play and real chases are judged separately (a bot chaser isn't a person).
            var source = selfPlayOn ? "selfplay" : "player";
            var groups = t.Chases.Where(c => !c.Excluded && c.Settings != null && (c.Source ?? "player") == source).GroupBy(c => Key(c.Settings))
                .Select(g =>
                {
                    var avg = g.Average(c => c.Score);
                    var n = g.Count();
                    // Rounds vary a lot (0.2 to 6.4), so two lucky rounds shouldn't crown a
                    // setting: judge by a cautious estimate, the average plus its uncertainty.
                    var sd = n > 1 ? Mathf.Sqrt(g.Sum(c => (c.Score - avg) * (c.Score - avg)) / (n - 1)) : 0.8f;
                    return new { Key = g.Key, Settings = g.First().Settings, Avg = avg, N = n, Cautious = avg + Mathf.Max(sd, 0.2f) / Mathf.Sqrt(n) };
                }).ToList();
            var bestKey = Key(t.Best);
            var bestGroup = groups.FirstOrDefault(g => g.Key == bestKey);
            var bestAvg = bestGroup != null ? bestGroup.Avg : float.MaxValue;
            var bestCautious = bestGroup != null ? bestGroup.Cautious : float.MaxValue;
            var winner = groups.Where(g => g.N >= 3).OrderBy(g => g.Cautious).FirstOrDefault();
            var note = "";
            if (winner != null && winner.Key != bestKey && winner.Cautious < bestCautious)
            {
                t.Best = new Dictionary<string, float>(winner.Settings);
                note = "; NEW BEST (avg " + winner.Avg.ToString("0.00") + " over " + winner.N + " chases, was " + (bestAvg < float.MaxValue ? bestAvg.ToString("0.00") : "unscored") + ")";
                bestAvg = winner.Avg;
                bestKey = winner.Key;
            }
            t.BestScore = bestAvg;
            t.BestChases = groups.Where(g => g.Key == bestKey).Select(g => g.N).FirstOrDefault();
            var mine = groups.FirstOrDefault(g => g.Key == Key(trial));
            t.Pending = null;
            if (mine != null && mine.Key != bestKey && mine.N < 3 && mine.Avg < bestAvg)
            {
                t.Pending = new Dictionary<string, float>(trial);
                note += "; looks better than the best (" + bestAvg.ToString("0.00") + "), trying it again to be sure (" + mine.N + " of 3)";
            }
            else if (mine != null && mine.Key == bestKey) note += "; that was the best settings, now avg " + mine.Avg.ToString("0.00") + " over " + mine.N;
            else if (note == "") note = "; not better than the best (" + (bestAvg < float.MaxValue ? bestAvg.ToString("0.00") : "unscored") + ")";
            return note;
        }

        private static bool SameSettings(Dictionary<string, float> a, Dictionary<string, float> b) =>
            a != null && b != null && a.Count == b.Count && a.All(kv => b.ContainsKey(kv.Key) && Mathf.Abs(b[kv.Key] - kv.Value) < 0.0005f);

        private string TrainCommand(string arg)
        {
            var t = Train();
            if (arg == "on") { t.On = true; if (t.Best == null) { t.Best = CurrentFlee(); t.BestScore = float.MaxValue; t.BestChases = 0; } Interface.Oxide.DataFileSystem.WriteObject(TrainingFile, t); return "Training on: every chase tries slightly different running-away settings and keeps what makes it harder to see. Hit it and chase it; each chase reports its score."; }
            if (arg == "skip")
            {
                // Leave a chase out of the averages: the one running now, or else the last one.
                if (danger != null) { danger.Skip = true; return "This chase won't count for training."; }
                var last = t.Chases.LastOrDefault();
                if (last == null) return "No chases to skip.";
                last.Excluded = true;
                if (t.On && t.Best != null) Judge(t, t.Best, 0f);
                Interface.Oxide.DataFileSystem.WriteObject(TrainingFile, t);
                return "Left out the last chase (" + last.When.Substring(11, 5) + ", score " + last.Score.ToString("0.00") + ").";
            }
            if (arg == "off") { t.On = false; if (t.Best != null) { ApplyFlee(t.Best); Interface.Oxide.DataFileSystem.WriteObject(OddsFile, odds); } Interface.Oxide.DataFileSystem.WriteObject(TrainingFile, t); return "Training off; keeping the best settings found."; }
            var sb = new StringBuilder("Training " + (t.On ? "ON" : "off") + ", " + t.Chases.Count + " chases recorded.\n");
            if (t.Best != null) sb.AppendLine("Best so far (score " + (t.BestScore < 1e30f ? t.BestScore.ToString("0.00") : "not scored yet") + " over " + t.BestChases + " chases): " + string.Join(", ", t.Best.Select(kv => kv.Key.Replace("Flee", "").ToLowerInvariant() + " " + kv.Value.ToString("0.###")).ToArray()));
            foreach (var c in t.Chases.Skip(Math.Max(0, t.Chases.Count - 5))) sb.AppendLine("  " + c.When.Substring(11, 5) + " in view " + c.SeenSeconds + "/" + c.Seconds + " s, hits " + c.Hits + ", score " + c.Score.ToString("0.00"));
            sb.Append("Score = share of the whole chase in view, +0.02 per extra hit (at most +0.5), +1 if it died; lower is better. /bot train on|off|skip");
            return sb.ToString();
        }

        #endregion

        private Danger danger;
        private Timer dangerTimer;

        private void OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (!Alive || entity != bot || info == null) return;
            var attacker = info.InitiatorPlayer;
            if (attacker == null || attacker == bot || (attacker.IsNpc && attacker != chaser)) return;
            if (danger != null && danger.Attacker == attacker) { danger.Hits++; return; }
            var wasRoaming = danger != null ? danger.WasRoaming : walker.Roaming;
            danger = new Danger
            {
                Attacker = attacker, Started = Time.time, Hits = 1, LastHealth = bot.health, WasRoaming = wasRoaming,
                SelfPlay = attacker == chaser, StartStucks = walker.Stucks, StartFlags = walker.Guard.Flags,
                ReactAt = Time.time + UnityEngine.Random.Range(MinReaction, MaxReaction), // never faster than 150 ms
            };
            if (dangerTimer == null) dangerTimer = timer.Every(0.1f, DangerTick); // tracks the attacker 10 times a second
        }

        private void DangerTick()
        {
            var d = danger;
            if (d == null) return;
            if (!Alive) { danger = null; return; }
            var now = Time.time;
            if (now < d.ReactAt) return;
            if (!d.Reacted)
            {
                d.Reacted = true;
                EndJob(null);
                walker.SetRoaming(false);
                walker.Working = false;
                Puts("[danger] " + saved.Name + " was hit by " + d.Attacker.displayName + ", reacted after " + ((d.ReactAt - d.Started) * 1000f).ToString("0") + " ms; running for cover.");
                d.LastTick = now;
                if (Train().On) { d.Trial = NextTrial(); ApplyFlee(d.Trial); }
            }
            if (bot.health < d.LastHealth) d.Damage += d.LastHealth - bot.health;
            d.LastHealth = bot.health;

            var a = d.Attacker;
            var gone = a == null || a.IsDestroyed || a.IsDead() || (!a.IsConnected && a != chaser);
            var dist = gone ? float.MaxValue : Vector3.Distance(a.transform.position, bot.transform.position);
            if (!gone) d.Closest = Mathf.Min(d.Closest, dist);
            var seen = !gone && dist < 300f && CanSee(a.eyes.position, bot.transform.position);
            walker.Dodge = seen; // weave while it can be seen, run straight once hidden
            walker.CloseDoorsBehind = true;
            if (seen) d.SeenTime += now - d.LastTick;
            d.LastTick = now;
            if (d.Seen && !seen) d.LosBreaks++;
            d.Seen = seen;
            if (seen) d.HiddenSince = -1f;
            else if (d.HiddenSince < 0f) d.HiddenSince = now;

            if (!seen && now - d.HiddenSince >= CalmAfter) { CalmDown(gone ? "the attacker is gone" : "out of sight for " + CalmAfter + " s"); return; }

            // Re-pick cover twice a second while it can be seen, or when it got where it was going.
            if (now < d.NextPick) return;
            d.NextPick = now + 0.5f;
            if (gone) return;
            var coverStillGood = d.HasCover && !CanSee(a.eyes.position, d.Cover);
            if (coverStillGood && walker.Busy) return;
            if (!seen && !walker.Busy)
            {
                // Hidden and standing: keep getting further away while staying out of sight,
                // like a player slipping away behind cover. Checked every 1.5 s.
                d.NextPick = now + 1.5f;
                PickCover(d, a, true);
                return;
            }
            PickCover(d, a);
        }

        // Test: aibot.hurt <player name> - 5 damage "from" that player, as if they shot it.
        [ConsoleCommand("aibot.hurt")]
        private void ConHurt(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            if (!Alive) { arg.ReplyWith("No bot."); return; }
            var name = arg.GetString(0);
            var who = BasePlayer.activePlayerList.FirstOrDefault(p => p.displayName.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0);
            if (who == null) { arg.ReplyWith("No online player matching '" + name + "'."); return; }
            bot.Hurt(new HitInfo(who, bot, Rust.DamageType.Bullet, 5f));
            arg.ReplyWith(saved.Name + " took 5 damage from " + who.displayName + " (" + Vector3.Distance(who.transform.position, bot.transform.position).ToString("0") + " m away).");
        }

        // The stricter route rules for running away. Null when the route is fine.
        private static string TooSteep(List<Vector3> route, Odds o)
        {
            for (var i = 1; i < route.Count; i++)
            {
                var rise = route[i].y - route[i - 1].y;
                if (rise <= 0f) continue;
                var run = new Vector2(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z).magnitude;
                if (run < 1f && rise > o.FleeMaxStep) return "a " + rise.ToString("0.0") + " m step up";
                if (run >= 0.3f && Mathf.Atan2(rise, run) * Mathf.Rad2Deg > o.FleeMaxSlope) return "a " + (Mathf.Atan2(rise, run) * Mathf.Rad2Deg).ToString("0") + " deg slope";
            }
            return null;
        }

        private class Cand { public Vector3 Spot; public float Depth, Time, Exposed, Away, Climb, Gain, Score; public bool Routed; }

        private static readonly int FloorMask = LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed");

        // A hiding spot is somewhere with something solid right next to it on the attacker's side
        // (a rock, tree, wall, or ground rising towards them), not the top of something where it
        // is only hidden because the slope falls away. Two checks:
        //  - the top of something: the ground 2.5 m around is lower on (nearly) every side
        //  - nothing solid within CoverReach towards the attacker at chest height
        private const float CoverReach = 6f;
        private static int CoverProblem(Vector3 spot, Vector3 attacker)
        {
            var lower = 0;
            for (var ang = 0; ang < 360; ang += 45)
            {
                var p = spot + Quaternion.Euler(0f, ang, 0f) * Vector3.forward * 2.5f;
                RaycastHit hit;
                if (!Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out hit, 8f, FloorMask, QueryTriggerInteraction.Ignore) || hit.point.y < spot.y - 0.5f) lower++;
            }
            if (lower >= 6) return 1;
            var toward = attacker - spot; toward.y = 0f;
            var chest = spot + Vector3.up * 1.2f;
            return Physics.Raycast(chest, toward.normalized, CoverReach, SightMask, QueryTriggerInteraction.Ignore) ? 0 : 2;
        }

        private static bool SeesHead(Vector3 eyes, Vector3 feet) => !Physics.Linecast(eyes, feet + Vector3.up * 1.5f, SightMask, QueryTriggerInteraction.Ignore);
        private static bool SeesChest(Vector3 eyes, Vector3 feet) => !Physics.Linecast(eyes, feet + Vector3.up * 0.9f, SightMask, QueryTriggerInteraction.Ignore);

        private bool CanSee(Vector3 eyes, Vector3 feet)
        {
            // The attacker can see it if a line reaches its head or its chest.
            return !Physics.Linecast(eyes, feet + Vector3.up * 1.5f, SightMask, QueryTriggerInteraction.Ignore)
                || !Physics.Linecast(eyes, feet + Vector3.up * 0.9f, SightMask, QueryTriggerInteraction.Ignore);
        }

        // Every candidate hiding spot around "me" from an attacker at "them" looking from "eyes",
        // with its cheap score (no route yet). Rejected spots go into "rejected" with the reason,
        // for /bot hide. Retreat: it's already hidden, so only spots well further away count,
        // and every metre gained is worth extra (keep the distance growing while out of sight).
        private List<Cand> CoverCandidates(Vector3 me, Vector3 them, Vector3 eyes, bool retreat, out int tops, out int open, List<KeyValuePair<Vector3, string>> rejected = null)
        {
            var away = me - them; away.y = 0f;
            if (away.sqrMagnitude < 0.01f) away = Vector3.forward;
            away.Normalize();
            // Where the attacker could see from in a moment: here, a step left or right, a step closer.
            var side = Vector3.Cross(Vector3.up, away);
            var views = new[] { eyes, eyes + side * 4f, eyes - side * 4f, eyes + away * 4f };
            var myDist = Vector3.Distance(me, them);
            var o = odds;
            var cands = new List<Cand>();
            tops = 0; open = 0;
            for (var r = 3f; r <= o.FleeRadius; r += 3f)
                for (var ang = 0; ang < 360; ang += 15)
                {
                    var dir = Quaternion.Euler(0f, ang, 0f) * away;
                    Vector3 spot;
                    if (!Walker.Nearest(me + dir * r, 1.5f, out spot)) continue;
                    Action<string> no = why => { if (rejected != null) rejected.Add(new KeyValuePair<Vector3, string>(spot, why)); };
                    if (Walker.WaterDepth(spot) > Walker.MaxWater) { no("water"); continue; }
                    if (spot.y - me.y > o.FleeMaxRise) { no("too high"); continue; }
                    var awayFrom = Vector3.Distance(spot, them);
                    // Hiding from someone: never towards them; once hidden, each hop must gain 3 m.
                    if (awayFrom < myDist + (retreat ? 3f : 0f)) { no(retreat ? "not further away" : "towards them"); continue; }
                    if (CanSee(eyes, spot)) { no("seen"); continue; }
                    var why2 = CoverProblem(spot, them);
                    if (why2 == 1) { tops++; no("top"); continue; }
                    if (why2 == 2) { open++; no("open"); continue; }
                    var hidden = 0;
                    foreach (var v in views) { if (!SeesHead(v, spot)) hidden++; if (!SeesChest(v, spot)) hidden++; }
                    var c = new Cand { Spot = spot, Depth = hidden / (views.Length * 2f), Away = awayFrom, Climb = Mathf.Max(0f, spot.y - me.y) };
                    c.Time = Vector3.Distance(me, spot) / Walker.SprintSpeed;
                    c.Gain = awayFrom - myDist;
                    c.Score = CoverScore(c, retreat);
                    cands.Add(c);
                }
            cands.Sort((x, y) => y.Score.CompareTo(x.Score));
            return cands;
        }

        private float CoverScore(Cand c, bool retreat)
        {
            var o = odds;
            return c.Depth * o.FleeDepth - c.Time * o.FleeTime - c.Exposed * o.FleeExposed + c.Away * o.FleeDistance - c.Climb * o.FleeClimb
                + (retreat ? c.Gain * o.FleeRetreat : 0f);
        }

        private void PickCover(Danger d, BasePlayer a, bool retreat = false)
        {
            var me = bot.transform.position;
            var them = a.transform.position;
            var eyes = a.eyes.position;
            var o = odds;
            int tops, open, steep = 0;
            string lastSteep = null;
            var cands = CoverCandidates(me, them, eyes, retreat, out tops, out open);
            // Real routes for the best few: travel time along the route and time spent in view on the way.
            Cand best = null;
            // Routes for up to 8 candidates, until 3 have passed the stricter danger route rules.
            var routed = 0;
            foreach (var c in cands.Take(8))
            {
                if (routed >= 3) break;
                if (!walker.GoTo(c.Spot, true)) continue;
                var route = walker.Route();
                var tooSteep = TooSteep(route, o);
                if (tooSteep == null && o.FleeJumps < 0.5f && walker.RouteJumps > 0) tooSteep = "needs a jump";
                if (tooSteep != null) { steep++; lastSteep = tooSteep; continue; }
                routed++;
                float length = 0f, seen = 0f, climb = 0f;
                for (var i = 1; i < route.Count; i++)
                {
                    var seg = Vector3.Distance(route[i - 1], route[i]);
                    climb += Mathf.Max(0f, route[i].y - route[i - 1].y);
                    for (var t = 0f; t < seg; t += 2f)
                        if (CanSee(eyes, Vector3.Lerp(route[i - 1], route[i], t / seg))) seen += Mathf.Min(2f, seg - t);
                    length += seg;
                }
                c.Time = length / Walker.SprintSpeed;
                c.Exposed = seen / Walker.SprintSpeed;
                c.Climb = climb;
                if (retreat && c.Exposed > o.FleeRetreatMaxView) { steep++; lastSteep = "would be seen on the way"; continue; } // already hidden: don't step out
                c.Score = CoverScore(c, retreat);
                c.Routed = true;
                if (best == null || c.Score > best.Score) best = c;
            }
            if (best != null)
            {
                if (!walker.GoTo(best.Spot, true)) best = null; // the last route planned may not be the best one
            }
            if (best != null)
            {
                var moved = !d.HasCover || Vector3.Distance(d.Cover, best.Spot) > 3f;
                d.Cover = best.Spot; d.HasCover = true; d.Picks++;
                if (moved) Puts("[danger] cover " + Vector3.Distance(me, best.Spot).ToString("0") + " m away, score " + best.Score.ToString("0.0") + " (depth " + best.Depth.ToString("0.00")
                    + ", " + best.Time.ToString("0.0") + " s run, " + best.Exposed.ToString("0.0") + " s in view, ends " + best.Away.ToString("0") + " m from them, climb " + best.Climb.ToString("0.0") + " m; " + cands.Count + " hidden spots found, " + tops + " tops and " + open + " open spots skipped, " + steep + " routes too steep" + (lastSteep != null ? " (last: " + lastSteep + ")" : "") + ")");
                if (a.IsAdmin)
                {
                    // Show the attacker (admins only see debug drawing) where it's heading.
                    a.SendConsoleCommand("ddraw.sphere", 3f, Color.cyan, best.Spot + Vector3.up * 0.5f, 0.5f);
                    a.SendConsoleCommand("ddraw.text", 3f, Color.white, best.Spot + Vector3.up * 2f, "cover " + best.Score.ToString("0.0"));
                }
                return;
            }
            // Already hidden with nowhere better: stay put rather than step into view.
            if (retreat) { walker.Halt(); return; }
            // No cover within reach: just sprint straight away from them.
            d.HasCover = false;
            var away = me - them; away.y = 0f;
            if (away.sqrMagnitude < 0.01f) away = Vector3.forward;
            away.Normalize();
            // Straight away first, then fanning out to the sides, so it doesn't just stand there
            // when the line straight away is blocked (water, a cliff).
            foreach (var turn in new[] { 0f, 35f, -35f, 70f, -70f, 100f, -100f })
                for (var r = 30f; r >= 10f; r -= 10f)
                {
                    Vector3 spot;
                    var dirAway = Quaternion.Euler(0f, turn, 0f) * away;
                    if (Walker.Nearest(me + dirAway * r, 4f, out spot) && Walker.WaterDepth(spot) <= Walker.MaxWater && walker.GoTo(spot, true)) { d.Picks++; return; }
                }
        }

        // /bot hide: the hiding spots around you, scored exactly as the bot scores them when it
        // runs, with the bot as the attacker (or the spot you look at, if the bot is far away).
        // Drawn for 20 s: green = its top 3, yellow = other hiding spots, red = rejected, with why.
        private string ShowHiding(BasePlayer user)
        {
            if (user == null) return "Only works in game.";
            Vector3 them, eyes;
            string from;
            if (Alive && Vector3.Distance(bot.transform.position, user.transform.position) < 100f)
            {
                them = bot.transform.position;
                eyes = bot.eyes.position;
                from = saved.Name;
            }
            else
            {
                RaycastHit aim;
                if (!Physics.Raycast(user.eyes.HeadRay(), out aim, 200f, FloorMask, QueryTriggerInteraction.Ignore)) return "The bot is far away: look at the spot the attacker should be at.";
                them = aim.point;
                eyes = aim.point + Vector3.up * 1.5f;
                from = "the spot you're looking at";
            }
            LoadOdds();
            var rejected = new List<KeyValuePair<Vector3, string>>();
            int tops, open;
            var cands = CoverCandidates(user.transform.position, them, eyes, false, out tops, out open, rejected);
            const float secs = 20f;
            user.SendConsoleCommand("ddraw.sphere", secs, Color.magenta, eyes, 0.4f);
            user.SendConsoleCommand("ddraw.text", secs, Color.magenta, eyes + Vector3.up * 0.6f, "attacker");
            for (var i = 0; i < cands.Count; i++)
            {
                var c = cands[i];
                var top3 = i < 3;
                user.SendConsoleCommand("ddraw.sphere", secs, top3 ? Color.green : Color.yellow, c.Spot + Vector3.up * 0.3f, top3 ? 0.45f : 0.25f);
                if (top3 || i < 10)
                    user.SendConsoleCommand("ddraw.text", secs, Color.white, c.Spot + Vector3.up * (top3 ? 1.6f : 1f),
                        (top3 ? "#" + (i + 1) + " " : "") + c.Score.ToString("0.0") + (top3 ? " (cover " + c.Depth.ToString("0.00") + ", " + c.Time.ToString("0.0") + " s run, " + c.Away.ToString("0") + " m away)" : ""));
            }
            var shown = 0;
            foreach (var r in rejected)
            {
                if (r.Value == "seen" || r.Value == "towards them") continue; // too many to draw; the rest say something
                if (++shown > 60) break;
                user.SendConsoleCommand("ddraw.sphere", secs, Color.red, r.Key + Vector3.up * 0.3f, 0.2f);
                user.SendConsoleCommand("ddraw.text", secs, Color.red, r.Key + Vector3.up * 0.8f, r.Value);
            }
            var seen = rejected.Count(r => r.Value == "seen");
            return "Hiding spots around you from " + from + " (" + Vector3.Distance(them, user.transform.position).ToString("0") + " m): " + cands.Count + " good (green = best 3, yellow = rest), "
                + seen + " in their view, " + tops + " on top of something, " + open + " with nothing to hide behind (red, labelled). Scores are before routes; the bot then also counts time in view on the way. Shown for 20 s.";
        }

        private void CalmDown(string why)
        {
            var d = danger;
            danger = null;
            if (d == null || !Alive) return;
            Puts("[danger] " + saved.Name + " calmed down (" + why + ") after " + (Time.time - d.Started).ToString("0") + " s: hit " + d.Hits + " times for " + d.Damage.ToString("0")
                + " damage, closest " + (d.Closest < float.MaxValue ? d.Closest.ToString("0") + " m" : "?") + ", broke line of sight " + d.LosBreaks + " times, " + d.Picks + " runs, health " + bot.health.ToString("0") + ".");
            EndChase(d, why, false);
            walker.Dodge = false;
            walker.CloseDoorsBehind = false;
            walker.Halt();
            if (saved.Brain) mind.Until = Time.time + StopLength();
            else if (d.WasRoaming) walker.SetRoaming(true);
        }

        #endregion

        #region Self-play

        // Self-play (/bot selfplay on|off|status): a second bot, Dusty, chases Kestrel round after
        // round so the running-away settings can train without a person. Each round: Kestrel is put
        // somewhere random with full health, Dusty 20-30 m away with sight of it. Dusty runs at it,
        // shoots when it can see it (4 damage, better odds close up, every 0.6 s), and when it
        // loses sight runs to where it last saw it, then on in the direction it was going. The
        // round ends when Kestrel calms down, dies, or after 2 minutes. Every round is saved with
        // the rest of the training chases; rounds that went wrong are kept but not counted.
        // A health line goes to carbon\data\AiBotSelfplay.log every minute; a watchdog resets
        // rounds that hang.
        private const ulong ChaserId = 9000001; // "Dusty"
        private BasePlayer chaser;
        private Walker chaserWalker;
        private bool selfPlayOn, selfPlayChaseEnded;
        private Timer selfPlayTimer, chaserTimer, probeTimer;
        private string roundState = "off";
        private float roundAt, nextShot, lastSeenAt, chaserMovedAt, kestrelMovedAt, nextChaserPlan;
        private Vector3 lastSeen, prevSeen, chaserLastPos, kestrelLastPos;
        private int selfPlayRounds, selfPlayValid, roundResets, chaserShots, chaserHits;
        private readonly Dictionary<string, int> invalidReasons = new Dictionary<string, int>();
        private bool roundHadChase;

        private string SelfPlayCommand(string arg)
        {
            if (arg == "on")
            {
                if (!Alive) return "Kestrel isn't alive; /bot spawn first.";
                var t = Train();
                if (!t.On) { t.On = true; if (t.Best == null) t.Best = CurrentFlee(); }
                t.SelfPlay = true;
                Interface.Oxide.DataFileSystem.WriteObject(TrainingFile, t);
                selfPlayOn = true;
                roundState = "setup";
                roundAt = Time.time + 1f;
                selfPlayTimer?.Destroy();
                selfPlayTimer = timer.Every(1f, SelfPlayTick);
                chaserTimer?.Destroy();
                chaserTimer = timer.Every(0.25f, ChaserTick);
                probeTimer?.Destroy();
                probeTimer = timer.Every(60f, Probe);
                Probe();
                return "Self-play on: Dusty will chase Kestrel round after round; training is on. Health log: carbon\\data\\AiBotSelfplay.log. /bot selfplay off to stop.";
            }
            if (arg == "off") { var tt = Train(); tt.SelfPlay = false; Interface.Oxide.DataFileSystem.WriteObject(TrainingFile, tt); SelfPlayOff("turned off"); return "Self-play off; Dusty removed. Training keeps the best settings found."; }
            return "Self-play " + (selfPlayOn ? "ON (" + roundState + ")" : "off") + ": " + selfPlayRounds + " rounds, " + selfPlayValid + " counted, " + roundResets + " reset by the watchdog; Dusty shot " + chaserShots + " times, hit " + chaserHits
                + (invalidReasons.Count > 0 ? "; not counted: " + string.Join(", ", invalidReasons.Select(kv => kv.Key + " x" + kv.Value).ToArray()) : "");
        }

        private void SelfPlayOff(string why)
        {
            selfPlayOn = false;
            roundState = "off";
            selfPlayTimer?.Destroy(); chaserTimer?.Destroy(); probeTimer?.Destroy();
            selfPlayTimer = chaserTimer = probeTimer = null;
            RemoveChaser();
            ProbeLine("self-play stopped: " + why);
        }

        private void RemoveChaser()
        {
            if (chaserWalker != null) UnityEngine.Object.Destroy(chaserWalker);
            chaserWalker = null;
            if (chaser != null && !chaser.IsDestroyed) chaser.Kill();
            chaser = null;
        }

        private bool ChaserAlive => chaser != null && !chaser.IsDestroyed && chaser.IsAlive();

        private bool SpawnChaser(Vector3 pos)
        {
            RemoveChaser();
            KeepIdsReserved();
            var p = GameManager.server.CreateEntity(PlayerPrefab, pos, Quaternion.identity) as BasePlayer;
            if (p == null) return false;
            p.enableSaving = false;
            p.userID = ChaserId;
            p.UserIDString = ChaserId.ToString();
            p.Spawn();
            if (!BasePlayer.bots.Contains(p)) BasePlayer.bots.Add(p);
            BasePlayer.botColliderWorkQueue.Add(p);
            p.displayName = "Dusty";
            p.InitializeHealth(100f, 100f);
            foreach (var item in Clothes) Give(p, item, p.inventory.containerWear);
            chaser = p;
            chaserWalker = p.gameObject.AddComponent<Walker>();
            chaserWalker.Init(p, 0f, false);
            chaserWalker.RunShare = 1f;
            p.SendNetworkUpdateImmediate();
            return true;
        }

        private void SelfPlayTick()
        {
            if (!selfPlayOn) return;
            var now = Time.time;
            if (!Alive) { roundState = "waiting for Kestrel to respawn"; return; }
            switch (roundState)
            {
                case "setup":
                case "waiting for Kestrel to respawn":
                    if (now < roundAt) return;
                    if (!SetupRound()) { roundAt = now + 5f; roundState = "setup"; return; }
                    roundState = "running";
                    roundAt = now;
                    roundHadChase = false;
                    selfPlayChaseEnded = false;
                    chaserMovedAt = kestrelMovedAt = now;
                    chaserLastPos = chaser.transform.position;
                    kestrelLastPos = bot.transform.position;
                    return;
                case "running":
                    if (danger != null && danger.SelfPlay) roundHadChase = true;
                    if (selfPlayChaseEnded || (roundHadChase && danger == null)) { EndRound(null); return; }
                    if (!roundHadChase && now - roundAt > 20f) { EndRound("Dusty never got a hit in to start the chase"); return; }
                    if (now - roundAt > 120f && danger != null)
                    {
                        CalmDown("round time limit (2 min)");
                        EndRound(null);
                        return;
                    }
                    // Watchdog: someone hasn't moved for 25 s.
                    if (ChaserAlive && Vector3.Distance(chaser.transform.position, chaserLastPos) > 1f) { chaserLastPos = chaser.transform.position; chaserMovedAt = now; }
                    if (Vector3.Distance(bot.transform.position, kestrelLastPos) > 1f) { kestrelLastPos = bot.transform.position; kestrelMovedAt = now; }
                    if (!ChaserAlive) { Spoil("Dusty died or vanished"); return; }
                    if (now - chaserMovedAt > 25f) { Spoil("Dusty stood still for 25 s"); return; }
                    if (danger != null && danger.Seen && now - kestrelMovedAt > 25f) { Spoil("Kestrel stood still in view for 25 s"); return; }
                    return;
                case "cooldown":
                    if (now >= roundAt) roundState = "setup";
                    return;
            }
        }

        private void Spoil(string why)
        {
            roundResets++;
            ProbeLine("watchdog reset: " + why);
            if (danger != null && danger.SelfPlay) { danger.Spoiled = why; CalmDown("watchdog: " + why); }
            EndRound(null);
        }

        private void EndRound(string noChase)
        {
            if (noChase != null)
            {
                selfPlayRounds++;
                int n; invalidReasons.TryGetValue(noChase, out n); invalidReasons[noChase] = n + 1;
                ProbeLine("round without a chase: " + noChase);
            }
            if (chaserWalker != null) chaserWalker.Halt();
            roundState = "cooldown";
            roundAt = Time.time + 3f;
        }

        // Kestrel somewhere random with full health; Dusty 20-30 m away, with sight of it if possible.
        private bool SetupRound()
        {
            if (danger != null) CalmDown("new round");
            BrainOff();
            EndJob(null);
            walker.SetRoaming(false);
            Vector3 spot = Vector3.zero;
            var found = false;
            // Random places inland (spawn points are all on beaches, with nothing to hide behind).
            var half = World.Size / 2f - 150f;
            for (var i = 0; i < 30 && !found; i++)
            {
                var p = new Vector3(UnityEngine.Random.Range(-half, half), 0f, UnityEngine.Random.Range(-half, half));
                p.y = TerrainMeta.HeightMap.GetHeight(p);
                if (p.y < 4f) continue; // beach or sea
                Vector3 s;
                if (Walker.Nearest(p, 6f, out s) && Walker.WaterDepth(s) <= Walker.MaxWater) { spot = s; found = true; }
            }
            if (!found) return false;
            walker.TeleportTo(spot);
            bot.health = bot.MaxHealth();
            bot.metabolism.calories.value = bot.metabolism.calories.max;
            bot.metabolism.hydration.value = bot.metabolism.hydration.max;
            Vector3 best = Vector3.zero;
            var haveBest = false;
            for (var i = 0; i < 16; i++)
            {
                var dir = Quaternion.Euler(0f, UnityEngine.Random.Range(0f, 360f), 0f) * Vector3.forward;
                Vector3 c;
                if (!Walker.Nearest(spot + dir * UnityEngine.Random.Range(20f, 30f), 4f, out c) || Walker.WaterDepth(c) > Walker.MaxWater) continue;
                if (!haveBest) { best = c; haveBest = true; }
                if (CanSee(c + Vector3.up * 1.5f, spot)) { best = c; break; }
            }
            if (!haveBest) return false;
            if (!ChaserAlive) { if (!SpawnChaser(best)) return false; }
            else { chaserWalker.TeleportTo(best); chaser.health = chaser.MaxHealth(); }
            lastSeen = prevSeen = spot;
            lastSeenAt = Time.time;
            nextShot = Time.time + 1f;
            nextChaserPlan = 0f;
            firstShot = true;
            return true;
        }

        private bool firstShot;

        // Dusty: chase what it sees, shoot when close enough, hunt the last seen spot when it doesn't.
        private void ChaserTick()
        {
            if (!selfPlayOn || roundState != "running" || !ChaserAlive || !Alive) return;
            var now = Time.time;
            var me = chaser.transform.position;
            var them = bot.transform.position;
            var dist = Vector3.Distance(me, them);
            var visible = dist < 80f && CanSee(chaser.eyes.position, them);
            if (visible)
            {
                if (Vector3.Distance(them, lastSeen) > 2f) prevSeen = lastSeen;
                lastSeen = them;
                lastSeenAt = now;
                chaserWalker.Face(them + Vector3.up * 1.2f);
                if (dist < 35f && now >= nextShot)
                {
                    // Tuned so a chase lasts: about 50 damage over 40 s in plain view.
                    nextShot = now + 0.8f;
                    chaserShots++;
                    var chance = firstShot ? 1f : Mathf.Lerp(0.45f, 0.2f, Mathf.InverseLerp(5f, 35f, dist));
                    firstShot = false;
                    if (UnityEngine.Random.value < chance) { chaserHits++; bot.Hurt(new HitInfo(chaser, bot, Rust.DamageType.Bullet, 2.5f)); }
                }
            }
            if (now < nextChaserPlan) return;
            nextChaserPlan = now + 1f;
            Vector3 goal;
            if (visible) { if (dist < 5f) { chaserWalker.Halt(); return; } goal = them; }
            else if (Vector3.Distance(me, lastSeen) > 3f) goal = lastSeen;
            else
            {
                // At the last seen spot and nothing: carry on the way it was going.
                var way = lastSeen - prevSeen; way.y = 0f;
                if (way.sqrMagnitude < 0.01f) way = (lastSeen - me);
                way.y = 0f;
                goal = lastSeen + (way.sqrMagnitude > 0.01f ? way.normalized : Vector3.forward) * 15f;
                prevSeen = lastSeen;
                lastSeen = goal;
            }
            Vector3 g;
            if (!Walker.Nearest(goal, 4f, out g)) return;
            if (chaserWalker.Busy && Vector3.Distance(chaserWalker.Route().LastOrDefault(), g) < 2f) return;
            chaserWalker.GoTo(g, true);
        }

        // The health log: one line a minute while self-play runs.
        private void Probe()
        {
            if (!selfPlayOn) return;
            var t = Train();
            var counted = t.Chases.Where(c => c.Source == "selfplay" && !c.Excluded).ToList();
            var last10 = counted.Skip(Math.Max(0, counted.Count - 10)).ToList();
            long ramMb = 0;
            try { ramMb = System.Diagnostics.Process.GetCurrentProcess().WorkingSet64 / (1024 * 1024); } catch { }
            ProbeLine("state " + roundState + " | rounds " + selfPlayRounds + ", counted " + selfPlayValid + ", resets " + roundResets
                + " | last 10 counted avg score " + (last10.Count > 0 ? last10.Average(c => c.Score).ToString("0.00") : "-")
                + " | best avg " + (t.BestScore < 1e30f ? t.BestScore.ToString("0.00") : "-") + " over " + t.BestChases
                + " | fps " + Performance.current.frameRate + ", Kestrel hitches " + (walker != null ? walker.Hitches : 0) + " (worst " + (walker != null ? walker.WorstFrameMs.ToString("0") : "0") + " ms)"
                + " | stucks K " + (walker != null ? walker.Stucks : 0) + " D " + (chaserWalker != null ? chaserWalker.Stucks : 0)
                + " | anti-cheat flags K " + (walker != null ? walker.Guard.Flags : 0) + " D " + (chaserWalker != null ? chaserWalker.Guard.Flags : 0)
                + " | server RAM " + ramMb + " MB | shots " + chaserShots + " hits " + chaserHits
                + (invalidReasons.Count > 0 ? " | not counted: " + string.Join(", ", invalidReasons.Select(kv => kv.Key + " x" + kv.Value).ToArray()) : ""));
        }

        private void ProbeLine(string line)
        {
            try { System.IO.File.AppendAllText(System.IO.Path.Combine(Interface.Oxide.DataDirectory, "AiBotSelfplay.log"), DateTime.UtcNow.ToString("u") + " " + line + Environment.NewLine); } catch { }
            Puts("[selfplay] " + line);
        }

        #endregion

        #region Brain

        // The brain only decides; the body (walker + jobs) does. Every choice is a weighted
        // random pick between options, with the weights read from carbon\data\AiBotBrain.json.
        // The file starts with hand guesses; tools/odds.py replaces them with how often real
        // players made each choice in similar situations (from MoveLab recordings). The file is
        // re-read whenever it changes, so new odds apply without a reload.
        private class Odds
        {
            public string Source = "hand guesses";
            // How long it stands between things it does, as a log-normal: median and spread
            // (Relyx baseline: median 2.1 s, 1 in 10 over 15 s), capped.
            public float StopMedian = 2.1f, StopSpread = 1.56f, StopMax = 50f;
            public float RestMin = 8f, RestMax = 30f; // a deliberate "rest" stop
            public float RunShare = 0.72f; // share of moving spent sprinting (baseline 72%)
            public float StickMin = 10f, StickMax = 60f; // how long it sticks with a choice
            // Running for cover: score = depth x FleeDepth - run seconds x FleeTime - seconds in
            // the attacker's view x FleeExposed + metres from them x FleeDistance - climb x FleeClimb.
            public float FleeRadius = 35f, FleeDepth = 10f, FleeTime = 0.3f, FleeExposed = 1f, FleeDistance = 0.05f, FleeClimb = 1f;
            // Stricter routes while running away (normal walking allows 50 deg slopes, 0.5 m steps
            // and jumps): steepest uphill slope, biggest single step up, highest cover spot above
            // where it stands, and whether a route may need a jump (0 = no, 1 = yes).
            public float FleeMaxSlope = 45f, FleeMaxStep = 0.5f, FleeMaxRise = 1f, FleeJumps = 0f;
            // Once hidden it keeps going: to spots at least 4 m further away, still hidden, with
            // at most FleeRetreatMaxView seconds in view on the way; each metre gained is worth FleeRetreat.
            public float FleeRetreat = 0.3f, FleeRetreatMaxView = 0.3f;
            // Weaving while it can be seen: up to this many degrees off its line (0 = run straight).
            public float FleeZigzag = 35f;
            // Standing on an edge: ground must be within this many metres of its middle, or it
            // slides off (0.5 = never slide, like the plain character controller).
            public float PerchRadius = 0.25f;
            public Dictionary<string, BrainOption> Options = new Dictionary<string, BrainOption>
            {
                { "chop", new BrainOption { Base = 1f, NearBoost = 3f, Want = "wood", WantAmount = 1000, NeedBoost = 2f } },
                { "mine", new BrainOption { Base = 0.8f, NearBoost = 3f, Want = "stones", WantAmount = 1000, NeedBoost = 2f } },
                { "barrel", new BrainOption { Base = 0.6f, NearBoost = 5f } },
                { "loot", new BrainOption { Base = 0.4f, NearBoost = 5f } },
                { "wander", new BrainOption { Base = 1.5f } },
                { "rest", new BrainOption { Base = 0.3f } },
            };
        }

        private class BrainOption
        {
            public float Base = 1f;     // how much it likes this on its own
            public float NearBoost = 1f; // times this when one is within NearRadius
            public float NearRadius = 30f;
            public string Want;         // item it's after, and how many feels like enough
            public int WantAmount;
            public float NeedBoost;     // up to (1 + this) times when it has none of Want
        }

        // What the brain is doing, for /bot info.
        private class Mind
        {
            public string Choice = "", Last = "", Weights = "";
            public float Until, StickUntil;
            public bool Acting;
            public int Decisions;
            public readonly Dictionary<string, float> Unavailable = new Dictionary<string, float>();

            public string Describe() =>
                (Acting ? "doing " + Choice : Time.time < Until ? "standing (" + (Until - Time.time).ToString("0") + " s more)" : "deciding")
                + (Choice != "" && Time.time < StickUntil ? ", in the mood for " + Choice + " " + (StickUntil - Time.time).ToString("0") + " s more" : "")
                + "; " + Decisions + " decisions; last weights " + Weights;
        }

        private Mind mind = new Mind();
        private Odds odds = new Odds();
        private DateTime oddsTime;
        private Timer brainTimer;
        private const string OddsFile = "AiBotBrain";

        private void LoadOdds()
        {
            var path = System.IO.Path.Combine(Interface.Oxide.DataDirectory, OddsFile + ".json");
            if (!System.IO.File.Exists(path)) { Interface.Oxide.DataFileSystem.WriteObject(OddsFile, new Odds()); }
            var t = System.IO.File.GetLastWriteTimeUtc(path);
            if (t == oddsTime) return;
            oddsTime = t;
            try { odds = Interface.Oxide.DataFileSystem.ReadObject<Odds>(OddsFile) ?? new Odds(); Walker.PerchRadius = odds.PerchRadius; Walker.DodgeAngle = odds.FleeZigzag; Puts("Brain odds loaded (" + odds.Source + ")."); }
            catch (Exception e) { Puts("Brain odds file is broken, keeping the old odds: " + e.Message); }
        }

        private string BrainOn()
        {
            LoadOdds();
            EndJob(null);
            saved.Brain = true;
            walker.SetRoaming(false);
            walker.LookAround = true;
            mind = new Mind { Until = Time.time + 1f };
            Save();
            return saved.Name + " is thinking for itself now (odds: " + odds.Source + "). /bot stop or /bot roam turns it off.";
        }

        private void BrainOff()
        {
            if (saved == null) return;
            saved.Brain = false;
            if (walker != null) walker.LookAround = false;
        }

        private void BrainTick()
        {
            if (saved == null || !saved.Brain || !Alive || danger != null) return;
            var now = Time.time;
            if (mind.Acting)
            {
                if (job != null || walker.Busy) return;
                // Just finished something: stand a moment, like a player deciding what's next.
                mind.Acting = false;
                mind.Until = now + (mind.Choice == "rest" ? UnityEngine.Random.Range(odds.RestMin, odds.RestMax) : StopLength());
                return;
            }
            if (now < mind.Until) return;
            LoadOdds();
            walker.RunShare = odds.RunShare;
            Decide();
        }

        // Log-normal stop length around the baseline's median.
        private float StopLength()
        {
            var g = Mathf.Sqrt(-2f * Mathf.Log(Mathf.Max(1e-6f, UnityEngine.Random.value))) * Mathf.Cos(2f * Mathf.PI * UnityEngine.Random.value);
            return Mathf.Clamp(odds.StopMedian * Mathf.Exp(odds.StopSpread * g), 0.3f, odds.StopMax);
        }

        private void Decide()
        {
            var now = Time.time;
            mind.Decisions++;
            var weights = new Dictionary<string, float>();
            var full = bot.inventory.containerMain.IsFull() && bot.inventory.containerBelt.IsFull();
            var near = new List<BaseEntity>();
            Vis.Entities(bot.transform.position, 30f, near);
            foreach (var kv in odds.Options)
            {
                var o = kv.Value;
                float blockedUntil;
                if (mind.Unavailable.TryGetValue(kv.Key, out blockedUntil) && now < blockedUntil) continue;
                if (full && kv.Key != "wander" && kv.Key != "rest") continue;
                var w = o.Base;
                if (o.NearBoost != 1f)
                {
                    var r2 = o.NearRadius * o.NearRadius;
                    if (near.Any(e => e != null && !e.IsDestroyed && (e.transform.position - bot.transform.position).sqrMagnitude <= r2 && Matches(kv.Key, e))) w *= o.NearBoost;
                }
                if (!string.IsNullOrEmpty(o.Want) && o.WantAmount > 0)
                {
                    var def = ItemManager.FindItemDefinition(o.Want);
                    var have = def != null ? bot.inventory.GetAmount(def.itemid) : 0;
                    w *= 1f + o.NeedBoost * Mathf.Max(0f, 1f - (float)have / o.WantAmount);
                }
                if (w > 0f) weights[kv.Key] = w;
            }
            // In the mood for something: keep at it while it's still possible.
            if (mind.Choice != "" && now < mind.StickUntil && weights.ContainsKey(mind.Choice) && mind.Choice != "rest" && mind.Choice != "wander")
            {
                Act(mind.Choice, weights, true);
                return;
            }
            if (weights.Count == 0) { mind.Until = now + 5f; return; }
            var pick = UnityEngine.Random.value * weights.Values.Sum();
            var choice = weights.Keys.Last();
            foreach (var kv in weights) { pick -= kv.Value; if (pick <= 0f) { choice = kv.Key; break; } }
            mind.StickUntil = now + UnityEngine.Random.Range(odds.StickMin, odds.StickMax);
            Act(choice, weights, false);
        }

        private void Act(string choice, Dictionary<string, float> weights, bool sticking)
        {
            mind.Weights = string.Join(", ", weights.Select(kv => kv.Key + " " + kv.Value.ToString("0.0")));
            mind.Last = mind.Choice;
            mind.Choice = choice;
            string result;
            switch (choice)
            {
                case "wander":
                    walker.WanderOnce();
                    result = walker.Busy ? "wandering" : "nowhere to wander";
                    mind.Acting = walker.Busy;
                    break;
                case "rest":
                    result = "resting and looking around";
                    mind.Acting = true;
                    break;
                default:
                    result = StartJob(choice, null);
                    mind.Acting = job != null;
                    if (job == null) mind.Unavailable[choice] = Time.time + 60f; // nothing reachable: forget it for a minute
                    break;
            }
            if (!mind.Acting) mind.Until = Time.time + 2f;
            Puts("[brain] " + (sticking ? "still in the mood for " : "chose ") + choice + " (" + mind.Weights + "): " + result);
        }

        #endregion

        private const float SearchRadius = 120f, Reach = 2.4f;
        private readonly Dictionary<BaseEntity, float> badTargets = new Dictionary<BaseEntity, float>();

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
                float badUntil;
                if (badTargets.TryGetValue(e, out badUntil) && Time.time < badUntil) continue;
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
            // Got nothing and the target is still there: it couldn't reach or work it. Leave that
            // one alone for a few minutes rather than walking at it again and again.
            if (gained.Count == 0 && j.Target != null && !j.Target.IsDestroyed)
            {
                badTargets[j.Target] = Time.time + 300f;
                if (badTargets.Count > 200) foreach (var k in badTargets.Where(kv => kv.Key == null || Time.time > kv.Value).Select(kv => kv.Key).ToList()) badTargets.Remove(k);
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

        // Doors: opened and closed through the game's own handlers (RPC_OpenDoor/RPC_CloseDoor,
        // the same ones a player's "use" key calls, 3 m reach, lock checks included).
        private string UseDoor(Door door, bool open)
        {
            if (!Alive || door == null || door.IsDestroyed) return "no door";
            if (door.IsOpen() == open) return null;
            if (Vector3.Distance(bot.eyes.position, door.ClosestPoint(bot.eyes.position)) > 3f) return "out of reach";
            var handler = FindMethod(door.GetType(), open ? "RPC_OpenDoor" : "RPC_CloseDoor");
            if (handler == null) return "no handler";
            handler.Invoke(door, new object[] { FromBot() });
            return door.IsOpen() == open ? null : "the game refused";
        }

        // Whether the bot could open this door: no lock, or a lock that lets it through.
        private static bool CanOpen(Door door, BasePlayer who)
        {
            if (door == null || door.IsDestroyed) return false;
            var lk = door.GetSlot(BaseEntity.Slot.Lock) as BaseLock;
            return lk == null || !lk.IsLocked() || (who != null && lk.OnTryToOpen(who));
        }

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
            public const float SprintSpeed = RunSpeed;
            private const float Step = 0.05f;
            private const float StuckSeconds = 3f, StuckDistance = 0.6f;
            private const float MaxStepUp = 1f, MaxDrop = 2f;

            private static readonly int GroundMask = LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed", "Vehicle Large"); // Vehicle Large: the harbor bridge and other big things players stand on
            // Transparent: chain-link fences and the like. Players can't walk through them (though
            // they can see through, so they're not in the sight checks).
            private static readonly int BlockMask = LayerMask.GetMask("World", "Default", "Construction", "Deployed", "Tree", "Transparent");

            public bool Roaming { get; private set; }
            public bool Working; // an action is running: no wandering or looking around
            public bool LookAround; // glance around while standing, without wandering off (the brain decides when to move)
            public float RunShare = 0.4f; // share of wander trips run rather than walked
            public bool Dodge; // being watched while running away: weave
            public static float DodgeAngle = 35f;
            private float dodgeSwitch, dodgeSide, dodgeNow;

            // One wander trip, chosen by the brain rather than by roaming.
            public void WanderOnce() => PickTrip();
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
            public int Stucks => stucks;

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
            public int RouteJumps => cornerJumps.Count;
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

            // Route points come from the map or from a line through the air, and can sit up to
            // a metre or so above the real ground (on rocks, near the goal). Aiming at a point in
            // the air made it jump at nothing. Each point is put on the ground right under it.
            private static void SnapToGround(List<Vector3> pts)
            {
                for (var i = 1; i < pts.Count; i++)
                {
                    RaycastHit hit;
                    if (Physics.Raycast(pts[i] + Vector3.up * 0.5f, Vector3.down, out hit, 2.5f, GroundMask, QueryTriggerInteraction.Ignore))
                        pts[i] = hit.point;
                }
            }

            // An admin teleport (/bot here): like the game's own teleport, it resets the
            // anti-cheat history instead of being checked.
            public void TeleportTo(Vector3 pos)
            {
                corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
                body.MovePosition(pos);
                Guard.Reset(pos);
                lastStandY = float.MaxValue;
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
                    if (Roaming || LookAround) lookYaw += UnityEngine.Random.Range(-70f, 70f);
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
                        speed = UnityEngine.Random.value < RunShare ? RunSpeed : WalkSpeed;
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

            // allowStraight false: after its body bumped into something on a straight line,
            // don't try that same straight line again; use the map's route.
            #region Local map

            // The game's navigation map is built for NPCs and leaves out small things a player
            // stands on (crates, cardboard boxes, half-wall tops). For short trips the bot builds
            // its own map of the area: every half metre it probes all the surfaces stacked there,
            // keeps the ones a player could stand on, links neighbours it can walk, step, drop or
            // jump between, and searches that (A*). The result still gets the usual test walk.
            private const float Cell = 0.5f, MapMargin = 6f, MapMaxSize = 44f;
            private static readonly RaycastHit[] probeHits = new RaycastHit[24];
            public int LocalRoutes, LocalTries;
            public float LocalMsWorst;

            private class Node { public int X, Z; public float Y; public int Id; }
            private HashSet<int> gapJumps = new HashSet<int>(); // segments of the last local route that are jumps across a gap

            private List<Vector3> LocalRoute(Vector3 start, Vector3 goal, out string why)
            {
                why = "";
                LocalTries++;
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var min = new Vector3(Mathf.Min(start.x, goal.x) - MapMargin, 0f, Mathf.Min(start.z, goal.z) - MapMargin);
                var max = new Vector3(Mathf.Max(start.x, goal.x) + MapMargin, 0f, Mathf.Max(start.z, goal.z) + MapMargin);
                if (max.x - min.x > MapMaxSize || max.z - min.z > MapMaxSize) { why = "too far for the local map"; return null; }
                int nx = Mathf.CeilToInt((max.x - min.x) / Cell) + 1, nz = Mathf.CeilToInt((max.z - min.z) / Cell) + 1;
                var top = Mathf.Max(start.y, goal.y) + 5f;
                var bottom = Mathf.Min(start.y, goal.y) - SafeDrop - 1f;
                var cols = new List<Node>[nx, nz];
                var nodes = new List<Node>();
                for (var ix = 0; ix < nx; ix++)
                    for (var iz = 0; iz < nz; iz++)
                    {
                        var x = min.x + ix * Cell;
                        var z = min.z + iz * Cell;
                        var n = Physics.RaycastNonAlloc(new Vector3(x, top, z), Vector3.down, probeHits, top - bottom, GroundMask, QueryTriggerInteraction.Ignore);
                        for (var k = 0; k < n; k++)
                        {
                            var h = probeHits[k];
                            if (Vector3.Angle(h.normal, Vector3.up) > 50f) continue;
                            var p = h.point;
                            if (WaterDepth(p) > MaxWater) continue;
                            if (Physics.CheckCapsule(p + Vector3.up * 0.55f, p + Vector3.up * 1.45f, 0.4f, BlockMask, QueryTriggerInteraction.Ignore)) continue; // no room for a player here
                            var list = cols[ix, iz] ?? (cols[ix, iz] = new List<Node>());
                            if (list.Any(o => Mathf.Abs(o.Y - p.y) < 0.3f)) continue;
                            var node = new Node { X = ix, Z = iz, Y = p.y, Id = nodes.Count };
                            list.Add(node);
                            nodes.Add(node);
                        }
                        if (sw.ElapsedMilliseconds > 40) { why = "the local map took too long to build"; return null; }
                    }
                Func<Vector3, Node> nearest = v =>
                {
                    int ix = Mathf.RoundToInt((v.x - min.x) / Cell), iz = Mathf.RoundToInt((v.z - min.z) / Cell);
                    Node best = null;
                    for (var dx = -1; dx <= 1; dx++)
                        for (var dz = -1; dz <= 1; dz++)
                        {
                            int cx = ix + dx, cz = iz + dz;
                            if (cx < 0 || cz < 0 || cx >= nx || cz >= nz || cols[cx, cz] == null) continue;
                            foreach (var o in cols[cx, cz])
                                if (Mathf.Abs(o.Y - v.y) < 1f && (best == null || Mathf.Abs(o.Y - v.y) + (dx != 0 || dz != 0 ? 0.3f : 0f) < Mathf.Abs(best.Y - v.y))) best = o;
                        }
                    return best;
                };
                var a = nearest(start);
                var b = nearest(goal);
                if (a == null) { why = "no surface under the bot on the local map"; return null; }
                if (b == null) { why = "nowhere to stand at the goal"; return null; }
                Func<Node, Vector3> pos = o => new Vector3(min.x + o.X * Cell, o.Y, min.z + o.Z * Cell);

                // A* over the surfaces.
                var g = new Dictionary<int, float> { { a.Id, 0f } };
                var from = new Dictionary<int, int>();
                var jumpEdge = new HashSet<int>();
                var goalPos = pos(b);
                // Open list as a sorted set of (estimate, id); the estimate leans on the distance
                // left (x1.5) so it heads for the goal instead of fanning out.
                var open = new SortedSet<KeyValuePair<float, int>>(Comparer<KeyValuePair<float, int>>.Create((p, q) => p.Key != q.Key ? p.Key.CompareTo(q.Key) : p.Value.CompareTo(q.Value)));
                open.Add(new KeyValuePair<float, int>(0f, a.Id));
                var closed = new HashSet<int>();
                while (open.Count > 0)
                {
                    if (sw.ElapsedMilliseconds > 60) { why = "the local map search took too long"; return null; }
                    var first = open.Min;
                    open.Remove(first);
                    var cur = nodes[first.Value];
                    if (cur == b) break;
                    if (!closed.Add(cur.Id)) continue;
                    var cp = pos(cur);
                    for (var dx = -1; dx <= 1; dx++)
                        for (var dz = -1; dz <= 1; dz++)
                        {
                            if (dx == 0 && dz == 0) continue;
                            int cx = cur.X + dx, cz = cur.Z + dz;
                            if (cx < 0 || cz < 0 || cx >= nx || cz >= nz || cols[cx, cz] == null) continue;
                            foreach (var nb in cols[cx, cz])
                            {
                                if (closed.Contains(nb.Id)) continue;
                                var dy = nb.Y - cur.Y;
                                if (dy > JumpReach || -dy > SafeDrop) continue;
                                var np = pos(nb);
                                // Nothing solid between them at the height the body passes.
                                var passY = Mathf.Max(cur.Y, nb.Y);
                                if (Physics.Linecast(new Vector3(cp.x, passY + 0.9f, cp.z), new Vector3(np.x, passY + 0.9f, np.z), BlockMask, QueryTriggerInteraction.Ignore)) continue;
                                var step = Vector3.Distance(cp, np);
                                var cost = step + (dy > 0.5f ? 1.5f : 0f) + (dy < -1f ? 0.5f : 0f);
                                var ng = g[cur.Id] + cost;
                                float old;
                                if (g.TryGetValue(nb.Id, out old) && old <= ng) continue;
                                g[nb.Id] = ng;
                                from[nb.Id] = cur.Id;
                                jumpEdge.Remove(nb.Id);
                                open.Add(new KeyValuePair<float, int>(ng + 1.5f * Vector3.Distance(np, goalPos), nb.Id));
                            }
                        }
                    // Jumping across a gap (box to wall): from an edge of what it stands on to
                    // something 1 to 3 m away and at most 1 m higher (less the further it is),
                    // with room for the arc.
                    var sameLevel = 0;
                    for (var dx = -1; dx <= 1; dx++)
                        for (var dz = -1; dz <= 1; dz++)
                        {
                            int cx = cur.X + dx, cz = cur.Z + dz;
                            if ((dx != 0 || dz != 0) && cx >= 0 && cz >= 0 && cx < nx && cz < nz && cols[cx, cz] != null && cols[cx, cz].Any(o => Mathf.Abs(o.Y - cur.Y) < 0.5f)) sameLevel++;
                        }
                    if (sameLevel < 8)
                        for (var dx = -8; dx <= 8; dx++)
                            for (var dz = -8; dz <= 8; dz++)
                            {
                                var flat = Mathf.Sqrt(dx * dx + dz * dz) * Cell;
                                if (flat < 1f || flat > 4f) continue;
                                int cx = cur.X + dx, cz = cur.Z + dz;
                                if (cx < 0 || cz < 0 || cx >= nx || cz >= nz || cols[cx, cz] == null) continue;
                                foreach (var nb in cols[cx, cz])
                                {
                                    if (closed.Contains(nb.Id)) continue;
                                    var dy = nb.Y - cur.Y;
                                    // How far a sprint jump carries before coming down to that height
                                    // (take-off speed for 1.4 m, sprint speed), with a safety margin.
                                    if (dy > JumpReach || dy < -0.5f) continue; // lower things it can walk off to instead
                                    var air = (HopSpeed + Mathf.Sqrt(Mathf.Max(0f, HopSpeed * HopSpeed + 2f * Physics.gravity.y * dy))) / -Physics.gravity.y;
                                    if (flat > 0.9f * RunSpeed * air) continue;
                                    var np = pos(nb);
                                    var arc = Mathf.Max(cur.Y, nb.Y);
                                    if (Physics.Linecast(new Vector3(cp.x, arc + 1f, cp.z), new Vector3(np.x, arc + 1f, np.z), BlockMask, QueryTriggerInteraction.Ignore)) continue;
                                    if (Physics.Linecast(new Vector3(cp.x, arc + 1.7f, cp.z), new Vector3(np.x, arc + 1.7f, np.z), BlockMask, QueryTriggerInteraction.Ignore)) continue;
                                    // The body follows a real jump arc: at each point along the way
                                    // its whole body (feet to head) must be clear. A box taller than
                                    // the jump between take-off and landing blocks it.
                                    var arcClear = true;
                                    for (var t = 0.15f; t < 0.9f && arcClear; t += 0.15f)
                                    {
                                        var time = t * flat / (0.9f * RunSpeed);
                                        var feetY = cur.Y + HopSpeed * time + 0.5f * Physics.gravity.y * time * time;
                                        var at = Vector3.Lerp(cp, np, t);
                                        if (Physics.CheckCapsule(new Vector3(at.x, feetY + 0.45f, at.z), new Vector3(at.x, feetY + 1.4f, at.z), 0.35f, BlockMask | GroundMask, QueryTriggerInteraction.Ignore)) arcClear = false;
                                    }
                                    if (!arcClear) continue;
                                    var ng = g[cur.Id] + flat + 2.5f;
                                    float old;
                                    if (g.TryGetValue(nb.Id, out old) && old <= ng) continue;
                                    g[nb.Id] = ng;
                                    from[nb.Id] = cur.Id;
                                    jumpEdge.Add(nb.Id);
                                    open.Add(new KeyValuePair<float, int>(ng + 1.5f * Vector3.Distance(np, goalPos), nb.Id));
                                }
                            }
                }
                if (!from.ContainsKey(b.Id) && a != b) { why = "the local map has no way there (" + nodes.Count + " spots, from " + pos(a).ToString("F1") + " to " + pos(b).ToString("F1") + ", searched " + closed.Count + ")"; return null; }
                var chain = new List<Vector3> { pos(b) };
                var chainJump = new List<bool> { jumpEdge.Contains(b.Id) }; // chainJump[i]: reached chain[i] by a gap jump
                var id = b.Id;
                while (from.ContainsKey(id)) { id = from[id]; chain.Add(pos(nodes[id])); chainJump.Add(jumpEdge.Contains(id)); }
                chain.Reverse();
                chainJump.Reverse();
                chain[0] = start;
                // Keep only the corners: points where the direction or the height changes, and
                // both ends of every gap jump.
                var pts = new List<Vector3> { chain[0] };
                gapJumps = new HashSet<int>();
                for (var i = 1; i < chain.Count; i++)
                {
                    var last = i == chain.Count - 1;
                    var jumpTo = chainJump[i];
                    var jumpFrom = !last && chainJump[i + 1];
                    var keep = last || jumpTo || jumpFrom;
                    if (!keep)
                    {
                        var d1 = chain[i] - chain[i - 1];
                        var d2 = chain[i + 1] - chain[i];
                        keep = Mathf.Abs(d1.y) > 0.3f || Mathf.Abs(d2.y) > 0.3f || Vector3.Angle(new Vector3(d1.x, 0f, d1.z), new Vector3(d2.x, 0f, d2.z)) > 10f;
                    }
                    if (!keep) continue;
                    if (jumpTo) gapJumps.Add(pts.Count - 1); // the segment from the previous kept point to this one is a jump
                    pts.Add(last && !jumpTo ? goal : chain[i]);
                }
                LocalMsWorst = Mathf.Max(LocalMsWorst, (float)sw.Elapsed.TotalMilliseconds);
                return pts;
            }

            #endregion

            private bool SetPath(Vector3 to, bool allowStraight = true)
            {
                doorsToShut.Clear();
                if (SetPathCore(to, allowStraight)) return true;
                // No way with the open doors where they are: try again as if it may shut them
                // (only if there's an open door it could use near where it's going).
                var doors = new List<Door>();
                Vis.Entities(to, 8f, doors);
                if (!doors.Any(d => d != null && d.IsOpen() && DoorOpenable != null && DoorOpenable(d))) return false;
                planThroughOpenDoors = true;
                openDoorsPlanned.Clear();
                try
                {
                    if (!SetPathCore(to, allowStraight)) return false;
                    foreach (var d in openDoorsPlanned) doorsToShut.Add(d);
                    return true;
                }
                finally { planThroughOpenDoors = false; }
            }

            private bool SetPathCore(Vector3 to, bool allowStraight)
            {
                if (SetPathDirect(to, allowStraight)) return true;
                // The bot's own map of the area: boxes, crates and wall tops the game's map leaves out.
                string localWhy = "";
                var from0 = body.transform.position;
                var local = WithDoorsOpen(from0, to, () => { string w; var lr = LocalRoute(from0, to, out w); localWhy = w; return lr; });
                if (local != null && !Wet(local))
                {
                    // Walk legs get the usual test walk; jumps across a gap were checked by the map
                    // (room for the arc, somewhere to land) and are jumped like a player trail jump.
                    var walk = new List<Vector3> { body.transform.position };
                    var lj = new Dictionary<int, Vector3>();
                    var lt = new HashSet<int>();
                    var jumpsHere = new HashSet<int>(gapJumps);
                    for (var i = 0; i < local.Count - 1 && walk != null; i++)
                    {
                        var b = local[i + 1];
                        if (jumpsHere.Contains(i))
                        {
                            lj[walk.Count - 1] = b;
                            walk.Add(b);
                            continue;
                        }
                        var leg = Walkable(new List<Vector3> { walk[walk.Count - 1], b }, b);
                        if (leg == null) { walk = null; break; }
                        var offset = walk.Count - 1;
                        foreach (var kv in routeJumps) lj[kv.Key + offset] = kv.Value;
                        foreach (var t in routeTrusted) lt.Add(t + offset);
                        walk.AddRange(leg.Skip(1));
                    }
                    if (walk != null)
                    {
                        corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
                        corners.AddRange(walk); SnapToGround(corners);
                        foreach (var kv in lj) cornerJumps[kv.Key] = kv.Value;
                        foreach (var t in lt) cornerTrusted.Add(t);
                        corner = 1;
                        goal = to;
                        state = "travelling (own map)";
                        LocalRoutes++;
                        ResetStuck();
                        return true;
                    }
                    localWhy = "its own map found a way but the test walk failed (" + lastPlanProblem + ")";
                }
                if (localWhy != "") lastPlanProblem = localWhy;
                // Too high to get to directly (on a box, say): look for stepping stones.
                if (to.y - body.transform.position.y <= 1f) return false;
                var jumps = new Dictionary<int, Vector3>();
                var trusted = new HashSet<int>();
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var route = ViaStep(body.transform.position, to, 2, jumps, trusted, sw);
                if (route == null) return false;
                corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
                corners.AddRange(route); SnapToGround(corners);
                foreach (var kv in jumps) cornerJumps[kv.Key] = kv.Value;
                foreach (var t in trusted) cornerTrusted.Add(t);
                corner = 1;
                goal = to;
                state = "travelling (via a stepping stone)";
                SteppingRoutes++;
                ResetStuck();
                return true;
            }

            public int SteppingRoutes;

            // The ground right under a point (the point itself if nothing within 4 m below).
            private static float GroundY(Vector3 p)
            {
                RaycastHit hit;
                return Physics.Raycast(p + Vector3.up * 0.5f, Vector3.down, out hit, 4.5f, GroundMask, QueryTriggerInteraction.Ignore) ? hit.point.y : p.y;
            }

            // One leg with the normal checks (straight line first, then the map's route), without
            // touching the walker's current route. Jump/trail marks go into the given sets, offset
            // by where this leg will start in the full route.
            private List<Vector3> PlanLeg(Vector3 start, Vector3 to, int offset, Dictionary<int, Vector3> jumps, HashSet<int> trusted)
            {
                List<Vector3> r = null;
                if (Vector3.Distance(start, to) < 60f)
                {
                    var straight = new List<Vector3> { start, to };
                    if (!Wet(straight)) r = Walkable(straight, to);
                }
                if (r == null)
                {
                    Vector3 from;
                    if (!Nearest(start, 3f, out from)) return null;
                    path.Reset();
                    if (!RustNavMeshHelpers.CalculatePath(from, to, RustNavMeshHelpers.AllAreas, path, false)) return null;
                    if (path.status != NavMeshPathStatus.PathComplete || path.corners.Count < 2) return null;
                    var pts = new List<Vector3>();
                    foreach (var c in path.corners) pts.Add(c.Value);
                    if (Wet(pts)) return null;
                    r = Walkable(pts, to);
                    if (r == null) return null;
                }
                foreach (var kv in routeJumps) jumps[kv.Key + offset] = kv.Value;
                foreach (var t in routeTrusted) trusted.Add(t + offset);
                return r;
            }

            // A spot near the goal it can stand on, from which the goal is a jump up (at most
            // JumpReach higher), and which it can get to itself, perhaps by another stepping stone.
            private List<Vector3> ViaStep(Vector3 start, Vector3 to, int depth, Dictionary<int, Vector3> jumps, HashSet<int> trusted, System.Diagnostics.Stopwatch sw)
            {
                var stones = new List<Vector3>();
                for (var dx = -2.5f; dx <= 2.5f; dx += 0.5f)
                    for (var dz = -2.5f; dz <= 2.5f; dz += 0.5f)
                    {
                        var p = to + new Vector3(dx, 0f, dz);
                        RaycastHit hit;
                        if (!Physics.Raycast(p + Vector3.up * 1.5f, Vector3.down, out hit, 6f, GroundMask, QueryTriggerInteraction.Ignore)) continue;
                        var s = hit.point;
                        var up = to.y - s.y;
                        if (up < 0.3f || up > JumpReach) continue;
                        if (Vector3.Angle(hit.normal, Vector3.up) > 50f) continue;
                        if (Physics.CheckCapsule(s + Vector3.up * 0.55f, s + Vector3.up * 1.4f, 0.4f, BlockMask, QueryTriggerInteraction.Ignore)) continue;
                        if (WaterDepth(s) > MaxWater) continue;
                        if (stones.Any(o => (o - s).sqrMagnitude < 1f)) continue; // one per square metre
                        stones.Add(s);
                    }
                stones.Sort((a, b) => Vector3.Distance(start, a).CompareTo(Vector3.Distance(start, b)));
                foreach (var s in stones.Take(5))
                {
                    if (sw.ElapsedMilliseconds > 60) break; // planning happens inside one server frame: keep it short
                    var j = new Dictionary<int, Vector3>();
                    var tr = new HashSet<int>();
                    var leg1 = PlanLeg(start, s, 0, j, tr);
                    if (leg1 == null && depth > 1 && s.y - start.y > 1f) leg1 = ViaStep(start, s, depth - 1, j, tr, sw);
                    if (leg1 == null) continue;
                    var leg2 = PlanLeg(leg1[leg1.Count - 1], to, leg1.Count - 1, j, tr);
                    if (leg2 == null) continue;
                    if (leg2.Any(q => GroundY(q) < s.y - 0.5f)) continue; // it has to go up from the stone, not step down off it first
                    var all = new List<Vector3>(leg1);
                    all.AddRange(leg2.Skip(1));
                    foreach (var kv in j) jumps[kv.Key] = kv.Value;
                    foreach (var t in tr) trusted.Add(t);
                    return all;
                }
                return null;
            }

            private bool SetPathDirect(Vector3 to, bool allowStraight)
            {
                Vector3 from;
                corners.Clear(); cornerJumps.Clear(); cornerTrusted.Clear();
                if (!Nearest(body.transform.position, 3f, out from)) return false;
                // The map's routes never go off a ledge, but a player often just drops down. So
                // for anything within 60 m, first try a straight line with the body, drops
                // included (never more than SafeDrop); use the map's route only if that fails.
                if (allowStraight && Vector3.Distance(from, to) < 60f)
                {
                    var straight = new List<Vector3> { body.transform.position, to };
                    if (!Wet(straight))
                    {
                        var direct = Walkable(straight, to);
                        if (direct != null)
                        {
                            Straight++;
                            corners.AddRange(direct); SnapToGround(corners);
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
                corners.AddRange(walk); SnapToGround(corners);
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
                            if (ThroughClosedDoor(prevP, tr[m].P)) break; // the player went through a door that's shut now
                            // Nor through anything solid (a fence, a wall): a recording can cut a
                            // corner or slip through a gap the bot's body doesn't fit.
                            if (m != st.Value && Physics.Linecast(prevP + Vector3.up * 0.9f, tr[m].P + Vector3.up * 0.9f, BlockMask, QueryTriggerInteraction.Ignore)) break;
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
            // A recorded trail can pass through a door. Fine if the door is open or the bot can
            // open it; not if it's locked against it.
            private static bool ThroughClosedDoor(Vector3 a, Vector3 b)
            {
                if ((a - b).sqrMagnitude < 0.0001f) return false;
                var hits = Physics.RaycastAll(a + Vector3.up * 1f, (b - a).normalized, Vector3.Distance(a, b) + 0.3f, ~0, QueryTriggerInteraction.Ignore);
                foreach (var h in hits)
                {
                    var door = h.collider.GetComponentInParent<Door>();
                    if (door == null) continue;
                    // Open: what the ray hit is the swung-open door leaf, standing in the way.
                    // Closed: fine if the bot can open it.
                    if (door.IsOpen() || DoorOpenable == null || !DoorOpenable(door)) return true;
                }
                return false;
            }

            #region Doors

            public static Func<Door, bool, string> DoorUse;
            public static Func<Door, bool> DoorOpenable;
            public bool CloseDoorsBehind; // running away: shut doors after going through
            private readonly List<KeyValuePair<Door, float>> openedDoors = new List<KeyValuePair<Door, float>>(); // door, which side it was on
            private float nextDoorTry, replanAt;
            private bool planThroughOpenDoors; // planning: open doors it can shut count as passable too
            private readonly List<Door> openDoorsPlanned = new List<Door>(); // open doors a plan treated as passable
            private readonly HashSet<Door> doorsToShut = new HashSet<Door>(); // ...which the current route needs shut
            private readonly Dictionary<Door, float> doorCooldown = new Dictionary<Door, float>();
            private Door lastOpened;
            private Vector3 tripGoal;
            private bool backingOff;
            public int DoorsOpened, DoorsClosed;

            private static float Side(Door d, Vector3 p) => Mathf.Sign(Vector3.Dot(p - d.transform.position, d.transform.forward));

            // Planning treats doors the bot can open as open: their colliders are switched off for
            // the length of the check (server physics only, same frame, nothing is sent to players).
            private T WithDoorsOpen<T>(Vector3 a, Vector3 b, Func<T> plan)
            {
                var centre = (a + b) / 2f;
                var radius = Mathf.Min(45f, Vector3.Distance(a, b) / 2f + 8f);
                var doors = new List<Door>();
                Vis.Entities(centre, radius, doors);
                var off = new List<Collider>();
                foreach (var d in doors)
                {
                    if (d == null || DoorOpenable == null || !DoorOpenable(d)) continue;
                    if (d.IsOpen() && !planThroughOpenDoors) continue; // an open door's leaf is an obstacle, unless it may shut it
                    if (d.IsOpen() && !openDoorsPlanned.Contains(d)) openDoorsPlanned.Add(d);
                    foreach (var c in d.GetComponentsInChildren<Collider>())
                        if (c.enabled && !c.isTrigger) { c.enabled = false; off.Add(c); }
                }
                try { return plan(); }
                finally { foreach (var c in off) if (c != null) c.enabled = true; }
            }

            // Walking: a closed door right ahead gets opened, like a player pressing use on it.
            // Running away: once through, it's closed again behind (harder to chase).
            private bool HandleDoors(Vector3 pos, Vector3 dir)
            {
                for (var i = openedDoors.Count - 1; i >= 0; i--)
                {
                    var d = openedDoors[i].Key;
                    if (d == null || d.IsDestroyed) { openedDoors.RemoveAt(i); continue; }
                    var dist = Vector3.Distance(pos, d.transform.position);
                    if (dist > 8f) { openedDoors.RemoveAt(i); continue; }
                    if (CloseDoorsBehind && dist > 1.4f && dist < 3f && Side(d, pos) != openedDoors[i].Value && d.IsOpen())
                    {
                        if (DoorUse?.Invoke(d, false) == null) DoorsClosed++;
                        openedDoors.RemoveAt(i);
                    }
                }
                if (Time.time < nextDoorTry || dir == Vector3.zero) return false;
                // All hits, since the first one is its own body (the cast starts inside it).
                Door door = null;
                foreach (var h in Physics.SphereCastAll(pos + Vector3.up * 1f, 0.3f, dir, 1.6f, ~0, QueryTriggerInteraction.Ignore))
                {
                    var dd = h.collider.GetComponentInParent<Door>();
                    if (dd != null) { door = dd; break; }
                }
                if (door == null) return false;
                if (door.IsOpen())
                {
                    // An open door's leaf right in front: shut it, like a player swinging it out
                    // of the way. At most once every 3 s per door, so it can't flap.
                    // Only doors its current plan needs shut (planned "through" an open door's
                    // leaf). An open doorway it's walking through stays open.
                    if (!doorsToShut.Contains(door)) return false;
                    float until;
                    if (doorCooldown.TryGetValue(door, out until) && Time.time < until) return false;
                    var leaf = door.ClosestPoint(pos + Vector3.up * 1f);
                    if (new Vector2(leaf.x - pos.x, leaf.z - pos.z).magnitude > 1.1f) return false;
                    doorCooldown[door] = Time.time + 3f;
                    nextDoorTry = Time.time + 0.6f;
                    if (DoorUse?.Invoke(door, false) == null) { DoorsClosed++; doorsToShut.Remove(door); replanAt = Time.time + 0.5f; return true; }
                    return false;
                }
                doorCooldown[door] = Time.time + 3f;
                nextDoorTry = Time.time + 0.6f;
                lookYaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
                var why = DoorUse?.Invoke(door, true);
                if (why == null)
                {
                    DoorsOpened++;
                    lastOpened = door;
                    openedDoors.Add(new KeyValuePair<Door, float>(door, Side(door, pos)));
                    // The open door leaf now stands somewhere: once it has swung, plan again
                    // around it (it may swing towards the bot, into the old line).
                    replanAt = Time.time + 0.5f;
                    return true;
                }
                Interface.Oxide.LogInfo("[AiBot] couldn't open " + door.ShortPrefabName + ": " + why);
                return false;
            }

            #endregion

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
                    if (Physics.Linecast(from + Vector3.up * 0.9f, Trails.All[st.Key][st.Value].P + Vector3.up * 0.9f, BlockMask, QueryTriggerInteraction.Ignore)) continue; // the trail is on the other side of a fence or wall
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
                            if (ThroughClosedDoor(prevP, tr[m].P)) break; // the player went through a door that's shut now
                            // Nor through anything solid (a fence, a wall): a recording can cut a
                            // corner or slip through a gap the bot's body doesn't fit.
                            if (m != st.Value && Physics.Linecast(prevP + Vector3.up * 0.9f, tr[m].P + Vector3.up * 0.9f, BlockMask, QueryTriggerInteraction.Ignore)) break;
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
                try
                {
                    var r = WithDoorsOpen(pts[0], to, () => DryRun(pts, to));
                    // A route has to end at the goal's height, not under it: the map snaps a goal
                    // that's off the map (the top of a box) to the ground beside it.
                    if (r != null && to.y - r[r.Count - 1].y > 0.6f)
                    {
                        lastPlanProblem = "the route ends " + (to.y - r[r.Count - 1].y).ToString("0.0") + " m below the goal";
                        return null;
                    }
                    // Last word on the finished route: no point more than a jump's height above
                    // the one before it over a short distance (the top of a tall box, say).
                    if (r != null)
                        for (var i = 1; i < r.Count; i++)
                        {
                            var rise = GroundY(r[i]) - GroundY(r[i - 1]); // where it would stand, not where it was mid-jump
                            var run = new Vector2(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z).magnitude;
                            if (rise > MaxJumpUp && run < 2f)
                            {
                                lastPlanProblem = "a point " + rise.ToString("0.0") + " m up in " + run.ToString("0.0") + " m, higher than a player can jump";
                                RejectedBlocked++;
                                return null;
                            }
                        }
                    return r;
                }
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
                var dryStandY = dense[0].y;
                var dryWasGrounded = true;
                var vy = -2f;
                const float dt = 0.1f;
                // A straight line's points are just a line through the air, so their height means
                // nothing; the map's route points sit on the ground, so there the body must also
                // be at their height, not just under them.
                var straightLine = pts.Count == 2;
                for (var w = 1; w < way.Count; w++)
                {
                    // The last few metres used to count as reached without being checked, so a short
                    // route straight through a wall passed. Now only when nothing solid stands
                    // between where the dry-run body got to and the goal.
                    // And never when the goal is higher than a jump can get it (on top of a box).
                    if (Vector3.Distance(way[w], to) < GoalSlack
                        && to.y - dryLegs.Position.y <= MaxJumpUp
                        && !Physics.Linecast(dryLegs.Position + Vector3.up * 1f, to + Vector3.up * 1f, BlockMask, QueryTriggerInteraction.Ignore)
                        && !Physics.Linecast(dryLegs.Position + Vector3.up * 0.4f, to + Vector3.up * 0.4f, BlockMask, QueryTriggerInteraction.Ignore))
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
                        // The goal counts as reached only at its height too, not standing under it
                        // (the ground beside a box is not the top of the box).
                        // And standing there, not passing through it mid-jump.
                        if (f.magnitude < 0.35f && (w < way.Count - 1 || (to.y - p.y < 0.6f && dryLegs.Grounded))) { reached = true; break; }
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
                        // Same limit as the real body: never standing more than a jump's height
                        // above where it last stood.
                        if (dryLegs.Grounded)
                        {
                            if (!dryWasGrounded && dryLegs.Position.y - dryStandY > MaxJumpUp) { dryLegs.Place(p); break; }
                            dryStandY = dryLegs.Position.y;
                        }
                        dryWasGrounded = dryLegs.Grounded;
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
                    dryStandY = way[rejoin].y; // a player walked this way, so trust where the trail rejoins
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
                    if (f.magnitude > 0.35f || up > 0.6f || cornerJumps.ContainsKey(corner)) break; // a take-off point is left by jumping, not by walking past it
                    corner++;
                }
                if (corner >= corners.Count)
                {
                    // Stepped back from a door that swung into it: now go round to where it was going.
                    if (backingOff)
                    {
                        backingOff = false;
                        var keep = speed;
                        if (SetPath(tripGoal, false)) { speed = keep; return; }
                    }
                    EndTrip(Working ? "working" : "pausing");
                    waitUntil = Time.time + UnityEngine.Random.Range(1f, 7f);
                    return;
                }
                var flat = corners[corner] - pos;
                flat.y = 0f;
                var dir = flat.normalized;
                // A player jumped from here: jump too, heading for where they landed.
                Vector3 land;
                // Take off close to the edge, and only once it has found its feet after the last
                // landing (it used to jump again straight away, before it was steady on the box).
                if (flat.magnitude < 0.45f && cornerJumps.TryGetValue(corner, out land))
                {
                    if (Time.time - landedAt >= SteadyAfterLanding && Jump())
                    {
                        TrailJumps++;
                        corner++;
                        var toLand = corners[corner] - pos;
                        toLand.y = 0f;
                        dir = toLand.normalized;
                    }
                    else
                    {
                        // At the edge but not steady yet: stand and face the jump, like a player lining it up.
                        var look = land - pos;
                        lookYaw = Mathf.Atan2(look.x, look.z) * Mathf.Rad2Deg;
                        MoveBody(pos, Vector3.zero, 0f, dt);
                        ResetStuck();
                        return;
                    }
                }
                // A door in the way: open it (and wait a moment while it swings), then re-plan.
                if (replanAt > 0f && Time.time >= replanAt)
                {
                    replanAt = 0f;
                    var keepSpeed = speed;
                    // The door swung towards it, into where it's standing: step back out of the
                    // way first (like a player would), then go round it.
                    if (lastOpened != null && !lastOpened.IsDestroyed)
                    {
                        var near = lastOpened.ClosestPoint(pos + Vector3.up * 1f);
                        var off = pos - near; off.y = 0f;
                        if (off.magnitude < 1f)
                        {
                            tripGoal = goal;
                            backingOff = true;
                            WalkStraight(pos + (off.sqrMagnitude > 0.0001f ? off.normalized : -dir) * 1.3f);
                            return;
                        }
                    }
                    if (SetPath(goal, false)) { speed = keepSpeed; return; }
                }
                if (replanAt > 0f) { ResetStuck(); return; }
                if (HandleDoors(pos, dir)) { ResetStuck(); return; }
                // Dodging while being watched: zigzag off the line by up to DodgeAngle, switching
                // sides every 0.5 to 1.2 s, the way players weave when they're being shot at. Not
                // close to a corner (it would miss it) or on a planned jump.
                if (Dodge && DodgeAngle > 0f && flat.magnitude > 1.5f && !cornerJumps.ContainsKey(corner) && landedSinceHop)
                {
                    if (Time.time >= dodgeSwitch)
                    {
                        dodgeSide = dodgeSide >= 0f ? -1f : 1f;
                        dodgeNow = dodgeSide * UnityEngine.Random.Range(0.5f, 1f) * DodgeAngle;
                        dodgeSwitch = Time.time + UnityEngine.Random.Range(0.5f, 1.2f);
                    }
                    dir = Quaternion.Euler(0f, dodgeNow, 0f) * dir;
                }
                // In the air after a planned jump (a gap, or where a player jumped): carry the
                // speed of a sprint jump, as a player would take it.
                var next = MoveBody(pos, dir, !landedSinceHop && cornerJumps.Count > 0 ? Mathf.Max(speed, RunSpeed) : speed, dt);
                var progress = new Vector2(next.x - pos.x, next.z - pos.z).magnitude;
                if (progress < 0.25f * speed * dt)
                {
                    blocked++;
                    lastStop = legs.Bumped ? "its body bumped into " + legs.BumpedInto : "it couldn't get any further this step";
                    // Stalled going up, or against something: jump, like a player would. But not
                    // at something higher than a jump can reach: that's a wall, not a hop.
                    var rise = corners[corner].y - pos.y;
                    // How tall is what's in front (the highest thing it would have to clear)? A
                    // door, wall or anything over a jump's reach isn't worth jumping at.
                    var tall = legs.Bumped && AheadHeight(pos, dir) > JumpReach + 0.2f;
                    var jumped = !tall && (rise > -0.2f || legs.Bumped) && Jump();
                    // Close enough - but not while jumping: ending the trip mid-jump took away its
                    // forward movement, so it went straight up and down in front of half walls.
                    if (!jumped && landedSinceHop && Vector3.Distance(pos, goal) < 2f && goal.y - pos.y < 0.6f) { EndTrip(Working ? "working" : "pausing"); return; } // close enough
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
                if (hopNow && wasGrounded) { fallSpeed = HopSpeed; hopNow = false; hopFrom = pos; hopPeak = pos.y; hopWhy = legs.Bumped ? legs.BumpedInto : lastStop; hopLogged = false; }
                else if (hopNow && !wasGrounded) { hopNow = false; Interface.Oxide.LogInfo("[AiBot] JUMP skipped at " + pos.ToString("F2") + ": not on the ground when it tried"); }
                else fallSpeed = wasGrounded ? -2f : fallSpeed + Physics.gravity.y * dt;
                var next = legs.Move(new Vector3(dir.x * spd, fallSpeed, dir.z * spd) * dt);
                next = OffTheEdge(next, dt, dir);
                // The body's round bottom lets it slide up onto an edge as high as its middle, so
                // at the top of a jump it could climb onto things taller than a player (a box
                // over 1.8 m). A player's jump only gets their feet about 1.5 m up (the game's
                // jump height), so anything it would end up standing on higher than that is refused.
                var refusedLanding = false;
                // Any way up counts (a jump, or sliding up an edge): it may never end up standing
                // more than a jump's height above where it last stood. Walking up a slope is fine,
                // since that raises where it last stood a little at a time.
                // The reference only moves while it isn't in a jump: during a jump the controller
                // can count as "standing" on the box's edge it's sliding up, which used to let the
                // reference ride up with it. Now it stays at the take-off height until it lands.
                if (legs.Grounded && next.y - lastStandY <= MaxJumpUp)
                {
                    if (landedSinceHop && !hopNow) lastStandY = next.y;
                }
                else if (legs.Grounded)
                {
                    // Back off the edge a little and keep falling. This must not count as landing,
                    // or it could jump again from mid-air (that was a double jump).
                    var back = -new Vector3(dir.x, 0f, dir.z);
                    legs.Place(pos + (back.sqrMagnitude > 0.01f ? back.normalized * 0.15f : Vector3.zero));
                    next = legs.Position;
                    fallSpeed = Mathf.Min(fallSpeed, -1f);
                    TooHighLandings++;
                    refusedLanding = true;
                }
                if (legs.Grounded && !wasGrounded && fallSpeed < -15f) body.ApplyFallDamageFromVelocity(fallSpeed); // what a player's landing report does
                if (!landedSinceHop) hopPeak = Mathf.Max(hopPeak, next.y);
                if (!landedSinceHop && !refusedLanding && fallSpeed <= 0f && legs.OnFooting)
                {
                    landedSinceHop = true;
                    landedAt = Time.time;
                    if (!hopLogged && next.y - hopFrom.y < 0.3f && new Vector2(next.x - hopFrom.x, next.z - hopFrom.z).magnitude < 0.5f)
                    {
                        // Only jumps that went nowhere are logged.
                        // Every jump: how high its feet got and where it came down, to find why
                        // some don't get over things (a half wall, say).
                        hopLogged = true;
                        var flatGain = new Vector2(next.x - hopFrom.x, next.z - hopFrom.z).magnitude;
                        Interface.Oxide.LogInfo("[AiBot] JUMP at " + hopFrom.ToString("F2") + " (" + MapHelper.PositionToString(hopFrom) + "), because " + hopWhy + ": feet peaked "
                            + (hopPeak - hopFrom.y).ToString("0.00") + " m up, landed " + (next.y - hopFrom.y).ToString("+0.00;-0.00") + " m and " + flatGain.ToString("0.00") + " m on"
                            + (next.y - hopFrom.y < 0.3f && flatGain < 0.5f ? " -> DIDN'T GET OVER (thing ahead is " + AheadHeight(hopFrom, lastDir).ToString("0.00") + " m tall)" : ""));
                    }
                }
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

            // The character controller counts as standing while any part of its round bottom
            // touches something, so it could rest on a ledge's corner with its middle up to half a
            // metre out over the air. Players slide off once their middle passes the edge (Rust
            // fixed the same thing for players, devblog 71; Unreal calls it the perch radius).
            // So: standing needs ground within PerchRadius of its middle. If it's only on the
            // corner, it slides off that edge, or steps back onto it if the drop would hurt.
            public static float PerchRadius = 0.25f;
            public const float MaxJumpUp = 1.5f; // BasePlayer jump height: the highest a player's feet can land after a jump
            private float lastStandY = float.MaxValue; // height of the last ground it stood on (MaxValue: not known yet)
            public int TooHighLandings;
            public int PerchSlides, PerchBacks;

            private Vector3 OffTheEdge(Vector3 feet, float dt, Vector3 dir)
            {
                if (!legs.Grounded || PerchRadius >= 0.49f) return feet;
                RaycastHit hit;
                // Ground under the middle: a thin sphere down to 0.3 m below the feet.
                if (Physics.SphereCast(feet + Vector3.up * 0.6f, PerchRadius, Vector3.down, out hit, 0.35f + 0.3f, GroundMask, QueryTriggerInteraction.Ignore)) return feet;
                // Only on the corner: find what it's resting on.
                if (!Physics.SphereCast(feet + Vector3.up * 0.6f, 0.49f, Vector3.down, out hit, 0.11f + 0.3f, GroundMask, QueryTriggerInteraction.Ignore)) return feet;
                var off = feet - hit.point;
                off.y = 0f;
                if (off.sqrMagnitude < 0.0001f) return feet;
                // Heading onto what it's resting on (landing on a half wall): carry on, don't
                // slide back off. Only perched with nowhere to go, or heading away, slides off.
                if (new Vector3(dir.x, 0f, dir.z).sqrMagnitude > 0.01f && Vector3.Dot(new Vector3(dir.x, 0f, dir.z), -off) > 0f) return feet;
                off.Normalize();
                if (DropAhead(feet, off) > SafeDrop || WaterDepth(feet + off * 0.8f) > MaxWater)
                {
                    off = -off; // a fall that would hurt, or into deep water: back onto the ledge instead
                    PerchBacks++;
                }
                else PerchSlides++;
                return legs.Move(off * 2.5f * dt + Vector3.down * 1f * dt);
            }

            private void OnDestroy() { legs?.Dispose(); dryLegs?.Dispose(); }

            // A hop: the take-off speed for 1.4 m, just under the game's 1.5 m jump height
            // (BasePlayer.GetJumpHeight), so the fly check allows it as it does a player's jump.
            private static readonly float HopSpeed = Mathf.Sqrt(2f * -Physics.gravity.y * 1.4f);
            private const float HopCooldown = 0.7f;
            private const float JumpReach = 1.3f; // the highest a hop can land on
            public string lastPlanProblem = "";
            private bool hopNow, landedSinceHop = true;
            private float landedAt = -99f;
            public static float SteadyAfterLanding = 0.5f; // seconds on its feet before a planned jump

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
            private Vector3 hopFrom;
            private float hopPeak;
            private string hopWhy = "";
            private bool hopLogged = true;

            // The top of what's ahead: the highest of the rays (every 5 cm up to 2.5 m) that hits
            // something, not the first one that doesn't. A door with a gap under it used to read
            // as 0.1 m tall because the lowest ray went under the door.
            private static float AheadHeight(Vector3 pos, Vector3 dir)
            {
                var top = 0f;
                var any = false;
                for (var h = 0.1f; h <= 2.5f; h += 0.05f)
                    if (Physics.Raycast(pos + Vector3.up * h, dir, 1.2f, BlockMask | GroundMask, QueryTriggerInteraction.Ignore)) { top = h; any = true; }
                if (!any) return 0f;
                return top >= 2.45f ? 99f : top + 0.05f;
            }
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
                    if (SetPath(goal, false)) return; // the straight line just failed, so take the map's route
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
            public int Flags => tickRejects + noclips + speeds + flies + terrains;

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

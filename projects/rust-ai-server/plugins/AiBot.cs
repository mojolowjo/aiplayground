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
    // Chat (admins): /bot spawn|info|roam|stop|here|kill      Console/RCON: aibot.<same>
    [Info("AiBot", "mojolowjo", "0.3.0")]
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
        }

        private Saved saved;
        private BasePlayer bot;
        private Walker walker;
        private Timer respawnTimer;

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
            Save();
            respawnTimer?.Destroy();
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

            foreach (var item in Clothes) Give(player, item, player.inventory.containerWear);
            foreach (var item in Belt) Give(player, item, player.inventory.containerBelt);
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

        private void RemoveBody()
        {
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
            if (walker != null) UnityEngine.Object.Destroy(walker);
            bot = null;
            walker = null;
            saved.Health = 0f;
            saved.Roaming = true;
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
                case "roam": walker.SetRoaming(true); Save(); return saved.Name + " is roaming.";
                case "stop": walker.SetRoaming(false); Save(); return saved.Name + " stopped.";
                case "here":
                    if (user == null) return "Only works in game.";
                    Vector3 to;
                    if (!Walker.Nearest(InFrontOf(user), 10f, out to)) return "No walkable ground in front of you.";
                    walker.SetRoaming(false);
                    walker.TeleportTo(to);
                    walker.Face(user.transform.position);
                    Save();
                    return saved.Name + " is here, standing still.";
            }
            return "Use spawn, info, roam, stop, here or kill.";
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

            private BasePlayer body;
            private readonly RustNavMeshPath path = new RustNavMeshPath();
            private readonly List<Vector3> corners = new List<Vector3>();
            private int corner;
            private Vector3 goal, lastDir = Vector3.forward;
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
            }

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

                yaw = Mathf.MoveTowardsAngle(yaw, lookYaw, 300f * dt);
                SetLook();
            }

            private void Idle()
            {
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
                    EndTrip("pausing");
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
                    if (Roaming) PickTrip();
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
                var rot = Quaternion.Euler(0f, yaw, 0f);
                if (Mathf.Abs(Mathf.DeltaAngle(body.viewAngles.y, yaw)) > 0.5f)
                {
                    body.OverrideViewAngles(new Vector3(0f, yaw, 0f));
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
                return "roaming " + Roaming + ", " + state + (corners.Count > 0 ? " to " + goal + " at " + speed + " m/s, " + Vector3.Distance(goal, body.transform.position).ToString("0") + " m left" : "")
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

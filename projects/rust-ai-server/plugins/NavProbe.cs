using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Oxide.Core;
using Rust.Ai.Gen2;
using Rust.Ai.Gen2.Nav;
using UnityEngine;
using UnityEngine.AI;

namespace Oxide.Plugins
{
    // Read-only test of the game's AI navigation map against player-style collision.
    // Picks random short routes on the map and walks each one in thought (no entity moves),
    // checking with a player-sized body where the map says "walkable" but something real is
    // in the way, and what it is. Doesn't touch AiBot or the world.
    //   navprobe.params            the map's build settings
    //   navprobe.run [routes]      test that many random routes (default 2000), results in
    //                              carbon\data\NavProbe.json and a summary in the console
    [Info("NavProbe", "mojolowjo", "0.1.0")]
    public class NavProbe : RustPlugin
    {
        private const float Radius = 0.5f, Height = 1.8f, Step = 0.25f, SampleEvery = 0.5f;
        private const int CollisionMask = 1503731969; // what the no-clip check treats as solid
        private int GroundMask;

        private class Problem
        {
            public string Kind, Object, Layer, Grid;
            public float X, Y, Z, Height, Slope;
        }

        private readonly List<Problem> problems = new List<Problem>();
        private readonly RustNavMeshPath path = new RustNavMeshPath();
        private Timer runner;
        private int wanted, done, noPath, clean;
        private float metres, metresBad;
        private ConsoleSystem.Arg asker;

        private void Init() => GroundMask = CollisionMask | LayerMask.GetMask("Terrain");

        private void Unload() => runner?.Destroy();

        [ConsoleCommand("navprobe.params")]
        private void Params(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            var nav = RustNavigation.Instance;
            if (nav == null) { arg.ReplyWith("No navigation instance."); return; }
            var sb = new StringBuilder();
            sb.AppendLine("Navigation map build settings (a player is radius " + BasePlayer.GetRadius() + " m, height " + BasePlayer.GetHeight(false) + " m, jump " + BasePlayer.GetJumpHeight().ToString("0.00") + " m):");
            sb.AppendLine("  normal:  " + Describe(nav.BuildParams));
            sb.AppendLine("  hi-res:  " + Describe(nav.BuildParamsHiRes));
            var mesh = nav.DefaultNavmesh;
            if (mesh != null) sb.Append("  built tiles " + mesh.NumBuiltTiles + "/" + mesh.TotalTiles + ", bakes terrain " + mesh.BakesTerrain + ", last full build " + mesh.lastFullBuildSeconds.ToString("0.0") + " s");
            arg.ReplyWith(sb.ToString());
        }

        private static string Describe(NavMeshBuildParams p) =>
            "agent radius " + p.agentRadius + " m, height " + p.agentHeight + " m, max climb " + p.agentMaxClimb + " m, max slope " + p.agentMaxSlope + " deg, cell " + p.cellSize + "/" + p.cellHeight
            + " m, filter low-hanging " + p.filterLowHangingObstacles + ", ledges " + p.filterLedgeSpans + ", low-height " + p.filterWalkableLowHeightSpans;

        [ConsoleCommand("navprobe.run")]
        private void Run(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;
            runner?.Destroy();
            problems.Clear();
            wanted = Mathf.Clamp(arg.GetInt(0, 2000), 1, 20000);
            done = noPath = clean = 0;
            metres = metresBad = 0f;
            asker = arg;
            runner = timer.Every(0.1f, () => { for (var i = 0; i < 40 && done < wanted; i++) TestOne(); if (done >= wanted) Finish(); });
            arg.ReplyWith("Testing " + wanted + " random routes, about " + (wanted / 400f).ToString("0") + " s. Results go to the console and carbon\\data\\NavProbe.json.");
        }

        // One random route of 10 to 30 m somewhere on land.
        private void TestOne()
        {
            done++;
            var size = TerrainMeta.Size.x * 0.48f;
            var a = new Vector3(UnityEngine.Random.Range(-size, size), 0f, UnityEngine.Random.Range(-size, size));
            a.y = TerrainMeta.HeightMap.GetHeight(a);
            NavMeshHit hit;
            if (!RustNavMeshHelpers.SamplePosition(a, out hit, 5f, RustNavMeshHelpers.AllAreas, false)) { noPath++; return; }
            var start = hit.position;
            var b = start + Quaternion.Euler(0f, UnityEngine.Random.Range(0f, 360f), 0f) * Vector3.forward * UnityEngine.Random.Range(10f, 30f);
            b.y = TerrainMeta.HeightMap.GetHeight(b);
            if (!RustNavMeshHelpers.SamplePosition(b, out hit, 5f, RustNavMeshHelpers.AllAreas, false)) { noPath++; return; }
            path.Reset();
            if (!RustNavMeshHelpers.CalculatePath(start, hit.position, RustNavMeshHelpers.AllAreas, path, false) || path.status != NavMeshPathStatus.PathComplete || path.corners.Count < 2) { noPath++; return; }
            var corners = new List<Vector3>();
            foreach (var c in path.corners) corners.Add(c.Value);
            if (WalkRoute(corners)) clean++;
        }

        // Steps along the route every 0.5 m like a player-sized body. Returns true if nothing
        // got in the way. Records only the first problem per route.
        private bool WalkRoute(List<Vector3> corners)
        {
            Vector3 prev;
            if (!Ground(corners[0], out prev)) return true; // nothing to stand on: not our question
            for (var i = 1; i < corners.Count; i++)
            {
                var from = corners[i - 1];
                var to = corners[i];
                var n = Mathf.Max(1, Mathf.CeilToInt(Vector3.Distance(from, to) / SampleEvery));
                for (var k = 1; k <= n; k++)
                {
                    var want = Vector3.Lerp(from, to, k / (float)n);
                    Vector3 next;
                    var d = Vector3.Distance(prev, want);
                    metres += d;
                    if (!Ground(want, out next)) { Record("no ground under the map", null, want, 0f, 0f); metresBad += d; return false; }
                    var flat = new Vector2(next.x - prev.x, next.z - prev.z).magnitude;
                    var rise = next.y - prev.y;
                    var slope = Mathf.Atan2(Mathf.Abs(rise), Mathf.Max(flat, 0.01f)) * Mathf.Rad2Deg;

                    // 1. Something in the way at body height (above step height): a player's own collision.
                    RaycastHit block;
                    if (BodyBlocked(prev, next, out block))
                    {
                        var top = TopAbove(block.point, next.y);
                        Record(top <= Step ? "low bump (step-able)" : top <= BasePlayer.GetJumpHeight() ? "obstacle, jumpable height" : "obstacle, too tall to jump", block.collider, block.point, top, slope);
                        metresBad += d;
                        return false;
                    }
                    // 2. The game's no-clip test would refuse this move.
                    Collider nc;
                    var off = BasePlayer.NoClipOffset();
                    if (AntiHack.TestNoClipping(Someone(), prev + off, next + off, BasePlayer.NoClipRadius(ConVar.AntiHack.noclip_margin), ConVar.AntiHack.noclip_backtracking, out nc, false, null, false, false, false))
                    {
                        Record("no-clip check would refuse", nc, next, TopAbove(next, next.y), slope);
                        metresBad += d;
                        return false;
                    }
                    // 3. A step up or slope steeper than the map's own limit.
                    if (rise > Step && slope > 60f)
                    {
                        Record(rise <= BasePlayer.GetJumpHeight() ? "step up, jumpable height" : "step up, too tall", null, next, rise, slope);
                        metresBad += d;
                        return false;
                    }
                    prev = next;
                }
            }
            return true;
        }

        // The no-clip test wants a player to ignore the colliders of; any will do far away.
        private static BasePlayer Someone() =>
            BasePlayer.bots.Count > 0 ? BasePlayer.bots[0] : BasePlayer.activePlayerList.Count > 0 ? BasePlayer.activePlayerList[0] : null;

        private bool Ground(Vector3 near, out Vector3 ground)
        {
            RaycastHit hit;
            ground = near;
            if (!Physics.Raycast(near + Vector3.up * 1.5f, Vector3.down, out hit, 3.5f, GroundMask, QueryTriggerInteraction.Ignore)) return false;
            ground = hit.point;
            return true;
        }

        // A player's capsule from step height to the head, swept from one step to the next.
        private static bool BodyBlocked(Vector3 a, Vector3 b, out RaycastHit block)
        {
            var bottom = Vector3.up * (Radius + Step + 0.02f);
            var top = Vector3.up * (Height - Radius);
            var move = new Vector3(b.x - a.x, 0f, b.z - a.z);
            block = default(RaycastHit);
            if (move.sqrMagnitude < 0.0001f) return false;
            var start = new Vector3(a.x, Mathf.Max(a.y, b.y), a.z);
            foreach (var hit in Physics.CapsuleCastAll(start + bottom, start + top, Radius * 0.9f, move.normalized, move.magnitude, CollisionMask, QueryTriggerInteraction.Ignore))
            {
                if (hit.distance <= 0f) continue;
                if (hit.normal.y > 0.5f) continue; // walkable surface, not a wall
                if (block.collider == null || hit.distance < block.distance) block = hit;
            }
            return block.collider != null;
        }

        // How high the thing at this spot sticks up above the ground the player stands on.
        private float TopAbove(Vector3 at, float groundY)
        {
            RaycastHit hit;
            if (Physics.Raycast(new Vector3(at.x, groundY + 4f, at.z), Vector3.down, out hit, 6f, CollisionMask, QueryTriggerInteraction.Ignore))
                return Mathf.Max(0f, hit.point.y - groundY);
            return 0f;
        }

        private void Record(string kind, Collider c, Vector3 at, float height, float slope)
        {
            var name = c == null ? "(terrain shape)" : (c.GetComponentInParent<BaseEntity>()?.ShortPrefabName ?? c.transform.root.name ?? c.name);
            problems.Add(new Problem
            {
                Kind = kind, Object = Clean(name), Layer = c == null ? "" : LayerMask.LayerToName(c.gameObject.layer),
                Grid = MapHelper.PositionToString(at), X = at.x, Y = at.y, Z = at.z, Height = height, Slope = slope,
            });
        }

        // "rock_formation_small_a (12)" -> "rock_formation_small_a"
        private static string Clean(string s)
        {
            var i = s.IndexOf(" (", StringComparison.Ordinal);
            s = i > 0 ? s.Substring(0, i) : s;
            var slash = s.LastIndexOf('/');
            if (slash >= 0) s = s.Substring(slash + 1);
            return s.Replace(".prefab", "");
        }

        private void Finish()
        {
            runner?.Destroy();
            runner = null;
            var tested = done - noPath;
            var sb = new StringBuilder();
            sb.AppendLine("NavProbe: " + tested + " routes tested (" + noPath + " skipped, no route), " + metres.ToString("0") + " m walked in thought.");
            sb.AppendLine("  clean: " + clean + " (" + (tested > 0 ? 100f * clean / tested : 0f).ToString("0") + "%), with a problem: " + (tested - clean) + ". Problems per km of route: " + (metres > 0 ? (tested - clean) / (metres / 1000f) : 0f).ToString("0.0"));
            sb.AppendLine("  by kind:");
            foreach (var g in problems.GroupBy(p => p.Kind).OrderByDescending(g => g.Count()))
                sb.AppendLine("    " + g.Count() + "  " + g.Key + (g.Any(p => p.Height > 0) ? "  (median height " + Median(g.Select(p => p.Height)).ToString("0.00") + " m)" : ""));
            sb.AppendLine("  by object (top 15):");
            foreach (var g in problems.GroupBy(p => p.Object).OrderByDescending(g => g.Count()).Take(15))
                sb.AppendLine("    " + g.Count() + "  " + g.Key + "  [" + string.Join(", ", g.Select(p => p.Layer).Distinct()) + "]  median height " + Median(g.Select(p => p.Height)).ToString("0.00") + " m");
            Interface.Oxide.DataFileSystem.WriteObject("NavProbe", new { summary = sb.ToString(), problems });
            Puts(sb.ToString());
        }

        private static float Median(IEnumerable<float> xs)
        {
            var a = xs.OrderBy(x => x).ToList();
            return a.Count == 0 ? 0f : a[a.Count / 2];
        }
    }
}

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
    // A lab for comparing the bot's routes with how a real player moves. It doesn't touch AiBot.
    //   /lab route         the route the bot would take from you to the spot you're looking at,
    //                      drawn in your game for 2 minutes (the same navigation-map query AiBot uses)
    //   /lab rec           start recording your movement; /lab stop ends it and reports
    //   /lab problems      draw the map test's problem spots within 150 m (from NavProbe)
    //   /lab clear         forget the route
    // Recordings: carbon\data\MoveLab\<time>.json. Drawing uses the game's admin debug lines.
    [Info("MoveLab", "mojolowjo", "0.1.0")]
    public class MoveLab : RustPlugin
    {
        private const float DrawSeconds = 120f, SampleEvery = 0.05f;
        private static readonly int GroundMask = 1503731969 | LayerMask.GetMask("Terrain");

        private class Sample
        {
            public float T, X, Y, Z, Pitch, Yaw, Speed;
            public bool Ground, Duck, Sprint, Jump;
        }

        private class Recording
        {
            public string Player, Started;
            public List<float[]> Route; // the route shown when recording started, if any
            public List<Sample> Samples = new List<Sample>();
            public List<string> Events = new List<string>();
        }

        private class Session
        {
            public List<Vector3> Route;
            public Recording Rec;
            public float StartTime, LastSample;
            public Vector3 LastPos;
            public bool WasGround = true, JumpHeld;
        }

        private readonly Dictionary<ulong, Session> sessions = new Dictionary<ulong, Session>();
        private readonly RustNavMeshPath path = new RustNavMeshPath();

        private Session Of(BasePlayer p)
        {
            Session s;
            if (!sessions.TryGetValue(p.userID, out s)) sessions[p.userID] = s = new Session();
            return s;
        }

        [ChatCommand("lab")]
        private void Lab(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin) return;
            var verb = args.Length > 0 ? args[0].ToLowerInvariant() : "";
            var s = Of(player);
            switch (verb)
            {
                case "route": SendReply(player, Route(player, s)); return;
                case "rec": SendReply(player, StartRec(player, s)); return;
                case "stop": SendReply(player, StopRec(player, s)); return;
                case "problems": SendReply(player, Problems(player)); return;
                case "clear": s.Route = null; SendReply(player, "Route cleared."); return;
            }
            SendReply(player, "/lab route | rec | stop | problems | clear");
        }

        #region Route

        private string Route(BasePlayer player, Session s)
        {
            RaycastHit aim;
            if (!Physics.Raycast(player.eyes.HeadRay(), out aim, 300f, GroundMask, QueryTriggerInteraction.Ignore))
                return "Look at the ground where the route should end (within 300 m).";
            NavMeshHit from, to;
            if (!RustNavMeshHelpers.SamplePosition(player.transform.position, out from, 3f, RustNavMeshHelpers.AllAreas, false)) return "You're not on the navigation map here.";
            if (!RustNavMeshHelpers.SamplePosition(aim.point, out to, 8f, RustNavMeshHelpers.AllAreas, false)) return "That spot isn't on the navigation map.";
            path.Reset();
            if (!RustNavMeshHelpers.CalculatePath(from.position, to.position, RustNavMeshHelpers.AllAreas, path, false) || path.corners.Count < 2)
                return "No route there.";
            var corners = new List<Vector3>();
            foreach (var c in path.corners) corners.Add(c.Value);
            s.Route = corners;
            var length = 0f;
            for (var i = 1; i < corners.Count; i++) length += Vector3.Distance(corners[i - 1], corners[i]);
            DrawRoute(player, corners);
            return "Route drawn: " + corners.Count + " corners, " + length.ToString("0") + " m" + (path.status == NavMeshPathStatus.PathComplete ? "" : " (partial: the map can't reach that exact spot)")
                + ". Green line, blue corners, for 2 minutes. /lab rec to record yourself walking it.";
        }

        private void DrawRoute(BasePlayer player, List<Vector3> corners)
        {
            var up = Vector3.up * 0.3f;
            for (var i = 1; i < corners.Count; i++) Draw(player, "ddraw.line", Color.green, corners[i - 1] + up, corners[i] + up);
            for (var i = 0; i < corners.Count; i++)
            {
                Draw(player, "ddraw.sphere", Color.blue, corners[i] + up, 0.3f);
                Draw(player, "ddraw.text", Color.white, corners[i] + Vector3.up * 1.2f, i == 0 ? "start" : i == corners.Count - 1 ? "end" : i.ToString());
            }
        }

        // The game's debug drawing only shows for admins.
        private static void Draw(BasePlayer p, string what, Color c, Vector3 a, object b) =>
            p.SendConsoleCommand(what, DrawSeconds, c, a, b);

        #endregion

        #region Recording

        private string StartRec(BasePlayer player, Session s)
        {
            if (s.Rec != null) return "Already recording. /lab stop to finish.";
            s.Rec = new Recording
            {
                Player = player.displayName,
                Started = DateTime.UtcNow.ToString("u"),
                Route = s.Route?.Select(v => new[] { v.x, v.y, v.z }).ToList(),
            };
            s.StartTime = Time.time;
            s.LastSample = 0f;
            s.LastPos = player.transform.position;
            return "Recording" + (s.Route != null ? " against the drawn route" : "") + ". Move normally; /lab stop when done.";
        }

        // Called every time the server gets your input, many times a second.
        private void OnPlayerInput(BasePlayer player, InputState input)
        {
            Session s;
            if (player == null || !sessions.TryGetValue(player.userID, out s) || s.Rec == null) return;
            var now = Time.time - s.StartTime;
            var pos = player.transform.position;
            var ground = player.modelState.onground;
            var jump = input.IsDown(BUTTON.JUMP);
            if (jump && !s.JumpHeld) Event(s, now, "jump", pos, player);
            s.JumpHeld = jump;
            if (s.WasGround && !ground && !jump) Event(s, now, "left the ground (walked off something)", pos, player);
            if (!s.WasGround && ground) Event(s, now, "landed", pos, player);
            s.WasGround = ground;
            if (now - s.LastSample < SampleEvery) return;
            var speed = (pos - s.LastPos).magnitude / Mathf.Max(0.001f, now - s.LastSample);
            s.LastSample = now;
            s.LastPos = pos;
            s.Rec.Samples.Add(new Sample
            {
                T = now, X = pos.x, Y = pos.y, Z = pos.z, Pitch = player.viewAngles.x, Yaw = player.viewAngles.y, Speed = speed,
                Ground = ground, Duck = player.modelState.ducked, Sprint = player.modelState.sprinting, Jump = jump,
            });
            if (s.Rec.Samples.Count > 20 * 60 * 30) StopRec(player, s); // 30 minutes is plenty
        }

        private void Event(Session s, float t, string what, Vector3 pos, BasePlayer player)
        {
            var extra = "";
            if (what == "jump")
            {
                // What was in front: the tallest thing within 1.5 m ahead, measured from the ground.
                var fwd = Quaternion.Euler(0f, player.viewAngles.y, 0f) * Vector3.forward;
                var tallest = 0f;
                for (var d = 0.4f; d <= 1.6f; d += 0.4f)
                {
                    RaycastHit hit;
                    var at = pos + fwd * d;
                    if (Physics.Raycast(at + Vector3.up * 3f, Vector3.down, out hit, 4f, GroundMask, QueryTriggerInteraction.Ignore))
                        tallest = Mathf.Max(tallest, hit.point.y - pos.y);
                }
                extra = ", tallest thing within 1.5 m ahead " + tallest.ToString("0.00") + " m";
            }
            s.Rec.Events.Add(t.ToString("0.0") + " s  " + what + " at " + pos.ToString("F1") + " (" + MapHelper.PositionToString(pos) + ")" + extra);
        }

        private string StopRec(BasePlayer player, Session s)
        {
            var rec = s.Rec;
            if (rec == null) return "Not recording.";
            s.Rec = null;
            var name = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + player.displayName;
            Interface.Oxide.DataFileSystem.WriteObject("MoveLab/" + name, rec);
            var report = Report(rec);
            Puts("Recording " + name + "\n" + report);
            return report + "\nSaved as carbon\\data\\MoveLab\\" + name + ".json";
        }

        // How the walk compares with the route: distance, jumps, and where it left the route.
        private static string Report(Recording rec)
        {
            var sb = new StringBuilder();
            var n = rec.Samples.Count;
            if (n < 2) return "Too short to say anything.";
            var dist = 0f;
            for (var i = 1; i < n; i++) dist += Vector3.Distance(P(rec.Samples[i - 1]), P(rec.Samples[i]));
            var secs = rec.Samples[n - 1].T;
            sb.AppendLine(secs.ToString("0") + " s, " + dist.ToString("0") + " m, " + rec.Events.Count(e => e.Contains(" jump ")) + " jumps, crouched " + (100f * rec.Samples.Count(x => x.Duck) / n).ToString("0") + "% of the time, sprinting " + (100f * rec.Samples.Count(x => x.Sprint) / n).ToString("0") + "%.");
            if (rec.Route != null && rec.Route.Count > 1)
            {
                var route = rec.Route.Select(v => new Vector3(v[0], v[1], v[2])).ToList();
                var off = new List<string>();
                var away = false;
                var worst = 0f;
                foreach (var x in rec.Samples)
                {
                    var d = DistanceToRoute(route, P(x));
                    worst = Mathf.Max(worst, d);
                    if (!away && d > 2f) { away = true; off.Add(x.T.ToString("0.0") + " s  left the route at " + P(x).ToString("F1") + " (" + MapHelper.PositionToString(P(x)) + ")"); }
                    else if (away && d < 1f) { away = false; off.Add(x.T.ToString("0.0") + " s  back on the route at " + P(x).ToString("F1")); }
                }
                sb.AppendLine("Furthest from the route: " + worst.ToString("0.0") + " m. " + (off.Count == 0 ? "Stayed within 2 m the whole way." : "Left it " + off.Count(o => o.Contains("left")) + " times:"));
                foreach (var o in off.Take(12)) sb.AppendLine("  " + o);
            }
            foreach (var e in rec.Events.Where(e => !e.Contains("landed")).Take(15)) sb.AppendLine("  " + e);
            return sb.ToString().TrimEnd();
        }

        private static Vector3 P(Sample x) => new Vector3(x.X, x.Y, x.Z);

        private static float DistanceToRoute(List<Vector3> route, Vector3 p)
        {
            var best = float.MaxValue;
            p.y = 0f;
            for (var i = 1; i < route.Count; i++)
            {
                var a = route[i - 1]; a.y = 0f;
                var b = route[i]; b.y = 0f;
                var ab = b - a;
                var t = ab.sqrMagnitude < 0.0001f ? 0f : Mathf.Clamp01(Vector3.Dot(p - a, ab) / ab.sqrMagnitude);
                best = Mathf.Min(best, Vector3.Distance(p, a + ab * t));
            }
            return best;
        }

        #endregion

        #region Problems

        private class ProbeFile { public List<ProbeProblem> problems; }
        private class ProbeProblem { public string Kind, Object; public float X, Y, Z, Height; }

        private string Problems(BasePlayer player)
        {
            ProbeFile file;
            try { file = Interface.Oxide.DataFileSystem.ReadObject<ProbeFile>("NavProbe"); } catch { file = null; }
            if (file?.problems == null || file.problems.Count == 0) return "No map test results yet (navprobe.run in the console).";
            var me = player.transform.position;
            var near = file.problems.Select(p => new { p, at = new Vector3(p.X, p.Y, p.Z) })
                .Where(x => Vector3.Distance(x.at, me) < 150f).OrderBy(x => Vector3.Distance(x.at, me)).Take(30).ToList();
            foreach (var x in near)
            {
                Draw(player, "ddraw.sphere", Color.red, x.at + Vector3.up * 0.5f, 0.5f);
                Draw(player, "ddraw.text", Color.yellow, x.at + Vector3.up * 1.6f, x.p.Kind + "\n" + x.p.Object + (x.p.Height > 0 ? " " + x.p.Height.ToString("0.00") + " m" : ""));
            }
            if (near.Count == 0) return "No problem spots within 150 m. The nearest is " + file.problems.Min(p => Vector3.Distance(new Vector3(p.X, p.Y, p.Z), me)).ToString("0") + " m away.";
            var n = near[0];
            return near.Count + " problem spots within 150 m drawn in red. Nearest: " + n.p.Kind + " (" + n.p.Object + ") " + Vector3.Distance(n.at, me).ToString("0") + " m away.";
        }

        #endregion
    }
}

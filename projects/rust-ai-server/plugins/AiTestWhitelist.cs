using System.Collections.Generic;
using Oxide.Core;

namespace Oxide.Plugins
{
    // Only Steam IDs on the list can join. An empty list lets nobody in.
    // Manage it from RCON or the server console:
    //   wl.add <steamid64>   wl.remove <steamid64>   wl.list
    [Info("AiTestWhitelist", "mojolowjo", "1.0.0")]
    public class AiTestWhitelist : RustPlugin
    {
        private const string FileName = "AiTestWhitelist";
        private HashSet<string> allowed = new HashSet<string>();

        private void Init()
        {
            allowed = Interface.Oxide.DataFileSystem.ReadObject<HashSet<string>>(FileName) ?? new HashSet<string>();
        }

        private object CanClientLogin(Network.Connection connection)
        {
            if (connection != null && allowed.Contains(connection.userid.ToString())) return null;
            return "You are not on this server's whitelist.";
        }

        private void Save() => Interface.Oxide.DataFileSystem.WriteObject(FileName, allowed);

        private bool Denied(ConsoleSystem.Arg arg) => arg.Connection != null && !arg.IsAdmin;

        private static bool IsSteamId(string id) => id.Length == 17 && id.StartsWith("7656119") && ulong.TryParse(id, out _);

        [ConsoleCommand("wl.add")]
        private void CmdAdd(ConsoleSystem.Arg arg)
        {
            if (Denied(arg)) return;
            var id = arg.GetString(0);
            if (!IsSteamId(id)) { arg.ReplyWith("Usage: wl.add <steamid64>"); return; }
            allowed.Add(id);
            Save();
            arg.ReplyWith("Added " + id);
        }

        [ConsoleCommand("wl.remove")]
        private void CmdRemove(ConsoleSystem.Arg arg)
        {
            if (Denied(arg)) return;
            var id = arg.GetString(0);
            arg.ReplyWith(allowed.Remove(id) ? "Removed " + id : "Not on the list: " + id);
            Save();
        }

        [ConsoleCommand("wl.list")]
        private void CmdList(ConsoleSystem.Arg arg)
        {
            if (Denied(arg)) return;
            arg.ReplyWith(allowed.Count == 0 ? "Whitelist is empty" : string.Join("\n", allowed));
        }
    }
}

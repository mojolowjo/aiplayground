"""Build Modrinth .mrpack files from the Modrinth API (resolves required deps)."""
import json, sys, urllib.request, urllib.parse, zipfile

API = "https://api.modrinth.com/v2"

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "aiplayground-mrpack-builder"})) as r:
        return json.load(r)

def latest(slug, mc, loader):
    q = urllib.parse.urlencode({"game_versions": json.dumps([mc]), "loaders": json.dumps([loader])})
    vs = get(f"{API}/project/{slug}/version?{q}")
    if not vs:
        sys.exit(f"no {loader} build of {slug} for {mc}")
    return vs[0]

def build(name, mc, mods, out):
    loader_ver = get(f"https://meta.fabricmc.net/v2/versions/loader/{mc}")[0]["loader"]["version"]
    files, seen, queue = [], set(), list(mods)
    while queue:
        slug = queue.pop(0)
        v = latest(slug, mc, "fabric")
        if v["project_id"] in seen:
            continue
        seen.add(v["project_id"])
        proj = get(f"{API}/project/{v['project_id']}")
        f = next((f for f in v["files"] if f["primary"]), v["files"][0])
        env = {"client": "required" if proj["client_side"] != "unsupported" else "unsupported",
               "server": "required" if proj["server_side"] != "unsupported" else "unsupported"}
        files.append({"path": f"mods/{f['filename']}", "hashes": f["hashes"], "env": env,
                      "downloads": [f["url"]], "fileSize": f["size"]})
        print(f"  {proj['slug']:28} {v['version_number']}")
        queue += [d["project_id"] for d in v["dependencies"] if d["dependency_type"] == "required" and d.get("project_id")]
    index = {"formatVersion": 1, "game": "minecraft", "versionId": "1.0.0", "name": name,
             "files": files, "dependencies": {"minecraft": mc, "fabric-loader": loader_ver}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("modrinth.index.json", json.dumps(index, indent=2))
    print(f"wrote {out} (fabric-loader {loader_ver}, {len(files)} mods)")

COMMON = ["fabric-api", "distanthorizons", "distant-horizons-seedgen", "sodium", "lithium",
          "ferrite-core", "immediatelyfast", "entityculling", "krypton", "c2me-fabric",
          "terralith", "tectonic", "modmenu", "cloth-config"]

if __name__ == "__main__":
    print("26.3:")
    build("Distant Horizons Pack (26.3)", "26.3", COMMON + ["iris"], "dh-pack-26.3.mrpack")
    print("1.21.1:")
    build("Distant Horizons + Immersive Portals (1.21.1)", "1.21.1",
          COMMON + ["immersiveportals", "noisium"], "dh-portals-1.21.1.mrpack")

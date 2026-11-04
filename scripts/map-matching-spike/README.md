# Map-matching spike (#25)

Compares Valhalla and GraphHopper on real walks saved on the phone. This is throwaway comparison
tooling, not the production setup (#27). The plan and decisions are on issue #25.

The repo is public, so everything that shows a location stays in the gitignored `data/` folder:
the phone database, results and the review map. Only aggregate numbers go in issues and PRs.

## Run it

From this folder, with the phone connected (Node 22.13+ for `node:sqlite`):

```sh
mkdir -p data/custom_files data/graphhopper
curl -L -o data/custom_files/groningen-latest.osm.pbf https://download.geofabrik.de/europe/netherlands/groningen-latest.osm.pbf
docker compose up -d
adb exec-out run-as com.runtracker.app cat databases/runtrackerSQLite.db > data/phone.db
node --env-file=../../.env.local compare.mjs
```

Both engines are ready once `curl localhost:8002/status` and `curl localhost:8989/health` answer.
Tiles and the graph are built on first start only. `docker compose down` stops the engines.

`compare.mjs` prints the numbers and writes two private files to `data/`:

- `review.html`: GPS trace and both matches on a map, per walk. Open it in a browser.
- `results.json`: the matched ways and lines.

## What it measures

- **Way ids:** whether each engine returns an OSM way id for every matched piece.
- **Matched length vs. GPS length:** a big difference suggests skipped streets or added detours.
- **Overlap:** length-weighted share of the same ways, between engines, between full and thinned
  traces (every 3rd point, roughly a run's point spacing), and between walks.

Numbers can't say which match is right when the engines disagree. That takes the review map and
knowing which way was really walked.

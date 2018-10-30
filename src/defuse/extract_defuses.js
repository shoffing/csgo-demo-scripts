const demofile = require("demofile");
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const { fromEvent, forkJoin, of } = require("rxjs");
const rxop = require("rxjs/operators");
const { getFiles } = require("../util/getFiles");

const BATCH_SIZE = 4;
let BATCH_PROCESS_TIMES = [];

const DEMOS_DIR = `../../demos`;
const demoFilter = f =>
  !_.startsWith(_.last(f.split(path.sep)), "._") && _.endsWith(f, ".dem");

const OUTPUT_FILE = "_defuses.json";
const PARSED_DEMOS_LIST_FILE = "_parsed.json";

// The demo file MLGColumbus2016-envyus-vs-clg-cobblestone.dem seems to be corrupted...
process.on("uncaughtException", err => {
  if (err.name === "AssertionError [ERR_ASSERTION]") {
    console.error(`Found assertion error...`);
  } else {
    throw err;
  }
});

// Find demo files to read
getFiles(DEMOS_DIR, demoFilter)
  .catch(e => console.error(e))
  .then(DEMOS => {
    let UNPARSED_DEMOS = DEMOS;
    let PARSED_DEMOS = [];
    if (fs.existsSync(PARSED_DEMOS_LIST_FILE)) {
      PARSED_DEMOS = JSON.parse(fs.readFileSync(PARSED_DEMOS_LIST_FILE));
      UNPARSED_DEMOS = UNPARSED_DEMOS.filter(
        demo => !_.includes(PARSED_DEMOS.map(d => d.demo), demo)
      );
    }

    let startTime;
    of(..._.chunk(UNPARSED_DEMOS, BATCH_SIZE))
      .pipe(
        rxop.concatMap((UNPARSED_DEMOS_BATCH, demoBatchIdx) => {
          startTime = new Date();

          const parsers = UNPARSED_DEMOS_BATCH.map(DEMO_FILE => {
            const demo = new demofile.DemoFile();

            let C4_TIMER;
            const gameStarts$ = fromEvent(demo.gameEvents, "round_start").pipe(
              rxop.first(),
              rxop.tap(() => {
                C4_TIMER = demo.conVars.vars.mp_c4timer
                  ? parseFloat(demo.conVars.vars.mp_c4timer)
                  : 40;
              })
            );
            const gameEnds$ = fromEvent(demo, "end").pipe(rxop.first());

            const plants$ = fromEvent(demo.gameEvents, "bomb_planted").pipe(
              rxop.map(e => ({ ...e, time: demo.currentTime }))
            );
            const defuses$ = fromEvent(demo.gameEvents, "bomb_defused").pipe(
              rxop.map(e => ({ ...e, time: demo.currentTime })),
              rxop.withLatestFrom(plants$),
              rxop.map(defuseAndPlant => {
                const [defused, planted] = defuseAndPlant;

                if (_.isUndefined(C4_TIMER)) {
                  throw Error(`C4 Timer not defined? ${DEMO_FILE}`);
                }

                const defuseTime = defused.time - planted.time;
                const defuseTimeLeft = C4_TIMER - defuseTime;

                const player = demo.entities.getByUserId(defused.userid);

                return {
                  defuseTimeLeft,
                  player: player.name ? player.name : "__unnamed__",
                  round: demo.gameRules.roundsPlayed,
                  event: DEMO_FILE.split(DEMOS_DIR)[1].split(path.sep)[0],
                  demoFile: DEMO_FILE.split(DEMOS_DIR)[1]
                };
              }),
              rxop.tap(console.log)
            );

            console.log(`...parsing ${DEMO_FILE}...`);
            demo.parse(fs.readFileSync(DEMO_FILE));

            return defuses$.pipe(
              rxop.skipUntil(gameStarts$),
              rxop.takeUntil(gameEnds$),
              rxop.reduce((acc, r) => acc.concat(r), []),
              rxop.tap(() => demo.cancel()),
              rxop.catchError(e => console.error(e, "error!"))
            );
          });
          return forkJoin(parsers).pipe(
            rxop.map(results => ({
              results,
              UNPARSED_DEMOS_BATCH,
              demoBatchIdx
            }))
          );
        })
      )
      .subscribe(
        batchResult => {
          const { results, UNPARSED_DEMOS_BATCH, demoBatchIdx } = batchResult;

          let data = [];
          if (fs.existsSync(OUTPUT_FILE)) {
            data = data.concat(JSON.parse(fs.readFileSync(OUTPUT_FILE)));
          }
          data = data.concat(_.flatten(results));
          data = _.sortBy(
            _.uniqBy(data, d => d.round + d.event + d.demoFile),
            "defuseTimeLeft"
          );

          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));

          PARSED_DEMOS = [
            ...PARSED_DEMOS,
            ...UNPARSED_DEMOS_BATCH.map(demo => ({
              date: new Date(),
              demo
            }))
          ];
          fs.writeFileSync(
            PARSED_DEMOS_LIST_FILE,
            JSON.stringify(PARSED_DEMOS, null, 2)
          );

          const execTime = (new Date() - startTime) / 1000.0;

          BATCH_PROCESS_TIMES.push(execTime);
          BATCH_PROCESS_TIMES = _.takeRight(BATCH_PROCESS_TIMES, 10);
          const avgTimePerDemo = _.mean(BATCH_PROCESS_TIMES) / BATCH_SIZE;
          const demosLeft = Math.max(UNPARSED_DEMOS.length - (demoBatchIdx + 1) * BATCH_SIZE, 0);
          const timeLeft = Number.parseFloat(demosLeft * avgTimePerDemo).toFixed(1);
          console.log(`=== Batch [${ UNPARSED_DEMOS_BATCH.length }] completed in ${execTime} seconds ===`);
          console.log(`=== Currently averaging ${avgTimePerDemo} seconds per demo ===`);
          console.log(`=== Estimated time left (${demosLeft} demos): ${timeLeft} seconds ===\n\n`);
        },
        error => console.log(error),
        () => console.log("Done.")
      );
  });

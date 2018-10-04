const demofile = require('demofile');
const fs = require('fs');
const _ = require('lodash');
const { fromEvent, forkJoin } = require('rxjs');
const { skipUntil, takeUntil, tap, groupBy, map, mergeMap, first, count, filter, reduce, catchError } = require('rxjs/operators');
const { getFiles } = require('../util/getFiles');
const { getTeam } = require('../util/demoTools');

const DEMOS_DIR = `../../demos`;
const demoFilter = (f) => _.endsWith(f, '.dem');


let startTime = new Date();

// Find demo files to read
getFiles(DEMOS_DIR, demoFilter)
    .catch(e => console.error(e))
    .then(DEMOS => {
        const parsers = DEMOS.map(DEMO_FILE => {
            const demo = new demofile.DemoFile();

            const gameStarts$ = fromEvent(demo.gameEvents, 'round_start').pipe(
                first(),
                tap(() => console.log(`GAME STARTED ${DEMO_FILE}`)),
            );
            const gameEnds$ = fromEvent(demo, 'end').pipe(
                first(),
                tap(() => console.log(`GAME ENDED ${DEMO_FILE}`)),
            );

            const killWeapons$ = fromEvent(demo.gameEvents, 'player_death').pipe(
                map(e => {
                    if (_.includes(e.weapon, 'knife')) {
                        return 'knife';
                    }
                    return e.weapon;
                }),
            );

            console.log(`...parsing ${DEMO_FILE}...`);
            demo.parse(fs.readFileSync(DEMO_FILE));

            return killWeapons$.pipe(
                skipUntil(gameStarts$),
                takeUntil(gameEnds$),
                groupBy(weapon => weapon),
                mergeMap(weaponGroup$ => {
                    return weaponGroup$.pipe(
                        count(),
                        map(c => ({
                            weapon: weaponGroup$.key,
                            count: c,
                            event: DEMO_FILE.split('/demos/')[1].split('/')[0],
                            demoFile: DEMO_FILE.split('/demos/')[1],
                        })),
                    );
                }),
                reduce((acc,r) => acc.concat(r), []),
                tap(() => demo.cancel()),
                catchError((e) => console.error(e)),
            );
        });

        forkJoin(parsers).subscribe(
            results => {
                let data = _.mapValues(
                    _.groupBy(_.flatten(results), 'weapon'),
                    (weaponGroup) => _.sortBy(
                        weaponGroup.map(match => _.pick(match, ['count', 'event', 'demoFile'])),
                        (m) => -m.count
                    )
                );

                const OUTPUT_FILE = `weapons.json`;
                fs.writeFile(OUTPUT_FILE, JSON.stringify(data), 'utf8', (err) => {
                    if (err) throw err;
                    console.log(`=== Wrote to ${OUTPUT_FILE} ===`);

                    const execTime = (new Date() - startTime) / 1000.0;
                    console.log(`Execution time: ${execTime}s`);
                });
            },
            error => console.log(error),
            () => console.log('Done.'),
        );
    });
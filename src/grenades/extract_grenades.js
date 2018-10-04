const demofile = require('demofile');
const fs = require('fs');
const _ = require('lodash');
const { fromEvent, forkJoin, merge } = require('rxjs');
const { skipUntil, takeUntil, tap, map, first, reduce } = require('rxjs/operators');
const { getFiles } = require('../util/getFiles');
const { getTeam } = require('../util/demoTools');

DEMOS_DIR = '../../demos';
const demoFilter = f => _.endsWith(f, '.dem') && f.indexOf('inferno') > 0;

const GRENADE_SHORT = {
    HE: 'he',
    FLASHBANG: 'fb',
    SMOKE: 'sm',
    MOLOTOV: 'mo',
    DECOY: 'de',
};

// Find demo files to read
getFiles(DEMOS_DIR, demoFilter)
    .catch(e => console.error(e))
    .then(DEMOS => {
        const parsers$ = DEMOS.map(DEMO_FILE => {
            const demo = new demofile.DemoFile();

            const gameStarts$ = fromEvent(demo.gameEvents, 'round_start').pipe(
                tap(() => console.log('GAME STARTED')),
                first(),
            );
            const gameEnds$ = fromEvent(demo, 'end').pipe(
                tap(() => console.log('GAME ENDED')),
                first(),
            );

            const formatGrenade = (type, e) => {
                let result = {
                    type,
                    pos: {x: e.x, y: e.y, z: e.z},
                    round: demo.gameRules.roundsPlayed,
                };
                if (e.userid) {
                    result.team = getTeam(demo, demo.entities.getByUserId(e.userid));
                }
                return result;
            };

            const hes$ = fromEvent(demo.gameEvents, 'hegrenade_detonate')
                .pipe(
                    tap(() => console.log(GRENADE_SHORT.HE)),
                    map(e => formatGrenade(GRENADE_SHORT.HE, e)),
                );

            const flashbangs$ = fromEvent(demo.gameEvents, 'flashbang_detonate')
                .pipe(
                    tap(() => console.log(GRENADE_SHORT.FLASHBANG)),
                    map(e => formatGrenade(GRENADE_SHORT.FLASHBANG, e)),
                );

            const smokes$ = fromEvent(demo.gameEvents, 'smokegrenade_detonate')
                .pipe(
                    tap(() => console.log(GRENADE_SHORT.SMOKE)),
                    map(e => formatGrenade(GRENADE_SHORT.SMOKE, e)),
                );

            const molotovs$ = fromEvent(demo.gameEvents, 'inferno_startburn')
                .pipe(
                    tap(() => console.log(GRENADE_SHORT.MOLOTOV)),
                    map(e => formatGrenade(GRENADE_SHORT.MOLOTOV, e)),
                );

            const decoys$ = fromEvent(demo.gameEvents, 'decoy_detonate')
                .pipe(
                    tap(() => console.log(GRENADE_SHORT.DECOY)),
                    map(e => formatGrenade(GRENADE_SHORT.DECOY, e)),
                );

            const grenades$ = merge(hes$, flashbangs$, smokes$, molotovs$, decoys$);

            demo.parse(fs.readFileSync(DEMO_FILE));

            return grenades$.pipe(
                skipUntil(gameStarts$),
                takeUntil(gameEnds$),
                reduce((acc, v) => acc.concat(v), []),
            );
        });

        forkJoin(parsers$).subscribe(
            results => {
                let allGrenades = results.reduce((acc, r) => acc.concat(r), []);

                let data = _.mapValues(_.groupBy(allGrenades, 'type'), gs => gs.map(g => {
                    return {
                        pos: g.pos,
                        team: g.team,
                        round: g.round,
                    };
                }));

                const OUTPUT_FILE = 'inferno_grenades.json';
                fs.writeFile(OUTPUT_FILE, JSON.stringify(data), 'utf8', (err) => {
                    if (err) throw err;
                    console.log(`=== Wrote to ${OUTPUT_FILE} ===`);
                });
            },
            error => console.log(error),
            () => console.log('Grenades extracted.'),
        );
    });
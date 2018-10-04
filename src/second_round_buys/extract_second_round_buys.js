const demofile = require('demofile');
const fs = require('fs');
const _ = require('lodash');
const { fromEvent, forkJoin, zip } = require('rxjs');
const { skipUntil, take, tap, map, first, skip, filter, reduce, catchError } = require('rxjs/operators');
const { getFiles } = require('../util/getFiles');
const { getTeam } = require('../util/demoTools');

const tourny = 'ELEAGUE Major 2017';
const DEMOS_DIR = `../../demos/${tourny}`;
const demoFilter = (f) => _.endsWith(f, '.dem');

// Find demo files to read
getFiles(DEMOS_DIR, demoFilter)
    .catch(e => console.error(e))
    .then(DEMOS => {
        const parsers$ = DEMOS.map(DEMO_FILE => {
            const demo = new demofile.DemoFile();

            const gameStarts$ = fromEvent(demo.gameEvents, 'round_start').pipe(
                tap(() => console.log(`GAME STARTED IN ${DEMO_FILE}`)),
                first(),
            );

            const lastRoundWinner$ = fromEvent(demo.gameEvents, 'round_end').pipe(
                filter(e => e.winner >= 2),
                map(e => e.winner === 2 ? 'T' : 'CT'),
            );

            const cashSpentAfterFreezeEnd$ = fromEvent(demo.gameEvents, 'round_freeze_end').pipe(
                map(() => {
                    return {
                        'T': _.sum(demo.players.filter(p => p.isAlive && getTeam(demo, p) === 'T').map(p => p.cashSpendThisRound)),
                        'CT': _.sum(demo.players.filter(p => p.isAlive && getTeam(demo, p) === 'CT').map(p => p.cashSpendThisRound)),
                    };
                }),
                skip(1),
            );

            const cashSpentAfterLosingPistols$ = zip(lastRoundWinner$, cashSpentAfterFreezeEnd$).pipe(
                filter( (_, roundNumber) => roundNumber === 0 || roundNumber === 15 ),
                map( (zipped) => {
                    const loser = zipped[0] === 'T' ? 'CT' : 'T';
                    const loserSpent = zipped[1][loser];
                    console.log(`[${DEMO_FILE}] Loser (${loser}) spent $${loserSpent} in round ${demo.gameRules.roundsPlayed}`);
                    return {
                        'team': loser,
                        'spent': loserSpent,
                    }
                } ),
            );

            console.log(`...parsing ${DEMO_FILE}...`);
            demo.parse(fs.readFileSync(DEMO_FILE));

            return cashSpentAfterLosingPistols$.pipe(
                skipUntil(gameStarts$),
                take(1),
                reduce((acc, v) => acc.concat(v), []),
                tap(() => demo.cancel()),
                catchError((e) => console.error(e)),
            );
        });

        forkJoin(parsers$).subscribe(
            results => {
                let data = _.flatten(results);

                const OUTPUT_FILE = `loser_spent_after_pistol_${tourny}.json`;
                fs.writeFile(OUTPUT_FILE, JSON.stringify(data), 'utf8', (err) => {
                    if (err) throw err;
                    console.log(`=== Wrote to ${OUTPUT_FILE} ===`);
                });
            },
            error => console.log(error),
            () => console.log('Pistol round loser spend extracted.'),
        );
    });